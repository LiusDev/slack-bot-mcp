import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import type { SlackRuntime } from "../slack/bot";
import { ACTIVITY_SUBTYPES, formatMessages, type RawSlackMessage } from "./messages";
import { run, toSlackTs } from "./util";

/** Subtypes that are not a person replying. file_share and thread_broadcast are real replies. */
const NON_REPLY_SUBTYPES = new Set([...ACTIVITY_SUBTYPES, "bot_message", "message_changed", "message_deleted"]);

export function registerInboxTools(server: McpServer, rt: SlackRuntime): void {
  server.registerTool(
    "get_inbox",
    {
      title: "Get messages sent to the bot",
      description:
        "Return direct messages and @mentions the bot received while this MCP server was running. Only covers events delivered to this process: messages sent before it started, or delivered to another running instance of the same Slack app, are not here. To reliably fetch replies in a known channel or thread, use wait_for_reply or conversations_history.",
      inputSchema: z.object({
        unread_only: z.boolean().default(true).describe("Only messages not returned by a previous get_inbox call"),
        channel: z.string().optional().describe("Only messages from this channel or DM (ID, #name, or user)"),
        since: z.string().optional().describe("Only messages after this time: Slack ts, ISO date, or relative (30m, 2h)"),
        limit: z.number().int().min(1).max(200).default(50).describe("Maximum number of messages (most recent kept)"),
        mark_read: z.boolean().default(true).describe("Mark returned messages as read"),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    ({ unread_only, channel, since, limit, mark_read }) =>
      run("read the bot's inbox", async () => {
        await rt.ready;
        await rt.events;
        const channelId = channel ? (await rt.directory.resolveConversation(channel)).channelId : undefined;
        const messages = rt.inbox.list({ channelId, sinceTs: toSlackTs(since), unreadOnly: unread_only, limit });
        if (mark_read) rt.inbox.markRead(messages);
        return {
          messages: messages.map(({ read, ...m }) => m),
          note: messages.length === 0 ? "No new messages to the bot." : undefined,
        };
      }),
  );

  server.registerTool(
    "wait_for_reply",
    {
      title: "Wait for a Slack reply",
      description:
        "Wait until someone other than the bot posts in a channel, DM or thread, then return the new messages. Typical use: send_message, then wait_for_reply with the same target and `since_ts` set to the sent message's ts (and `thread_ts` to wait inside its thread). Without `thread_ts`, only top-level messages count. Returns `replied: false` on timeout; that is not an error, so call it again with the returned `since_ts` to keep waiting. Keep `timeout_seconds` below your MCP client's tool-call timeout (often 60 seconds).",
      inputSchema: z.object({
        channel: z.string().min(1).describe("Channel ID, #channel-name, or user (ID, @handle, email) for their DM"),
        thread_ts: z.string().optional().describe("Wait for replies inside this thread"),
        since_ts: z.string().optional().describe("Only count messages after this ts (default: now)"),
        from_user: z.string().optional().describe("Only count messages from this user (ID, @handle, or email)"),
        timeout_seconds: z
          .number()
          .int()
          .min(5)
          .max(300)
          .default(45)
          .describe("How long to wait; keep it below the MCP client's tool-call timeout"),
        poll_interval_seconds: z.number().int().min(2).max(60).default(5).describe("How often to check Slack"),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ channel, thread_ts, since_ts, from_user, timeout_seconds, poll_interval_seconds }) =>
      run(`wait for a reply in ${channel}`, async () => {
        const id = await rt.ready;
        const conv = await rt.directory.resolveConversation(channel);
        const fromUserId = from_user ? (await rt.directory.resolveUser(from_user)).id : undefined;
        const since = toSlackTs(since_ts) ?? (Date.now() / 1000).toFixed(6);
        const deadline = Date.now() + timeout_seconds * 1000;
        const client = rt.adapter.webClient;

        while (true) {
          const res = thread_ts
            ? await client.conversations.replies({ channel: conv.channelId, ts: thread_ts, oldest: since, limit: 100 })
            : await client.conversations.history({ channel: conv.channelId, oldest: since, limit: 100 });
          const replies = ((res.messages ?? []) as RawSlackMessage[])
            .filter(
              (m) =>
                Number(m.ts) > Number(since) &&
                m.user !== id.userId &&
                !m.bot_id &&
                !NON_REPLY_SUBTYPES.has(m.subtype ?? "") &&
                (!fromUserId || m.user === fromUserId),
            )
            .sort((a, b) => Number(a.ts) - Number(b.ts));
          if (replies.length > 0) {
            return { replied: true, channel_id: conv.channelId, thread_ts, messages: await formatMessages(rt, replies) };
          }
          const remaining = deadline - Date.now();
          if (remaining <= 0) {
            return {
              replied: false,
              channel_id: conv.channelId,
              since_ts: since,
              note: `No reply within ${timeout_seconds} seconds. Call wait_for_reply again with since_ts=${since} to keep waiting.`,
            };
          }
          // An inbox event for this channel wakes the loop early; otherwise poll on the interval.
          await rt.inbox.nextFor(conv.channelId, Math.min(poll_interval_seconds * 1000, remaining));
        }
      }),
  );
}
