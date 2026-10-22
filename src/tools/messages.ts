import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { ToolError } from "../errors";
import type { SlackRuntime } from "../slack/bot";
import type { ResolvedConversation } from "../slack/directory";
import { run, toSlackTs, tsToIso } from "./util";

export const ACTIVITY_SUBTYPES = new Set([
  "channel_join",
  "channel_leave",
  "channel_topic",
  "channel_purpose",
  "channel_name",
  "group_join",
  "group_leave",
  "bot_add",
  "bot_remove",
]);

export interface RawSlackMessage {
  ts?: string;
  user?: string;
  bot_id?: string;
  username?: string;
  text?: string;
  thread_ts?: string;
  reply_count?: number;
  subtype?: string;
  files?: Array<{ name?: string; title?: string }>;
  reactions?: Array<{ name?: string; count?: number }>;
}

export async function formatMessages(rt: SlackRuntime, messages: RawSlackMessage[]) {
  return Promise.all(
    messages.map(async (m) => ({
      ts: m.ts,
      time: tsToIso(m.ts),
      user_id: m.user,
      user_name: (await rt.directory.userName(m.user)) ?? m.username,
      bot_id: m.bot_id,
      text: m.text,
      thread_ts: m.thread_ts,
      reply_count: m.reply_count,
      subtype: m.subtype,
      files: m.files?.map((f) => f.name ?? f.title),
      reactions: m.reactions?.map((r) => `${r.name}×${r.count}`),
    })),
  );
}

export function registerMessageTools(server: McpServer, rt: SlackRuntime): void {
  server.registerTool(
    "send_message",
    {
      title: "Send a Slack message",
      description:
        "Post a message as the bot to a channel, a thread, or a user's DM. `target` accepts a channel ID (C…), #channel-name, user ID (U…), @handle, email, or a person's name; users get a direct message. Returns the message `ts`, which you can pass to wait_for_reply or use as `thread_ts` to reply in a thread.",
      inputSchema: z.object({
        target: z.string().min(1).describe("Channel ID, #channel-name, user ID, @handle, email, or name"),
        text: z.string().min(1).describe("Message content"),
        format: z
          .enum(["markdown", "plain"])
          .default("markdown")
          .describe("markdown: standard Markdown rendered by Slack. plain: sent as-is"),
        thread_ts: z.string().optional().describe("Timestamp of the parent message, to reply inside that thread"),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    ({ target, text, format, thread_ts }) =>
      run(`send a Slack message to ${target}`, async () => {
        await rt.ready;
        const conv = await rt.directory.resolveConversation(target);
        await assertAllowed(rt, conv, target);

        const postable = thread_ts
          ? rt.bot.thread(`slack:${conv.channelId}:${thread_ts}`)
          : rt.bot.channel(`slack:${conv.channelId}`);
        const sent = await postable.post(format === "markdown" ? { markdown: text } : text);

        const permalink = await rt.adapter.webClient.chat
          .getPermalink({ channel: conv.channelId, message_ts: sent.id })
          .then((r) => r.permalink)
          .catch(() => undefined);
        return {
          ok: true,
          channel_id: conv.channelId,
          ts: sent.id,
          thread_ts: thread_ts ?? sent.id,
          recipient: conv.user
            ? { user_id: conv.user.id, name: conv.user.real_name || conv.user.display_name, dm: true }
            : { channel: conv.channelName ? `#${conv.channelName}` : conv.channelId },
          permalink,
        };
      }),
  );

  server.registerTool(
    "conversations_history",
    {
      title: "Read Slack channel history",
      description:
        "Read recent messages from a channel or DM, newest first. `channel` accepts a channel ID, #channel-name, or a user (ID, @handle, email) for the bot's DM with them. Use `cursor` from the previous response to page further back. Thread replies are not included; use conversations_replies for those.",
      inputSchema: z.object({
        channel: z.string().min(1).describe("Channel ID, #channel-name, or user (ID, @handle, email) for a DM"),
        limit: z.number().int().min(1).max(200).default(20).describe("Number of messages to return"),
        oldest: z
          .string()
          .optional()
          .describe("Only messages after this time: Slack ts, ISO date, or relative (30m, 6h, 2d, 1w)"),
        latest: z.string().optional().describe("Only messages before this time (same formats as oldest)"),
        cursor: z.string().optional().describe("Pagination cursor from a previous call"),
        include_activity: z.boolean().default(false).describe("Include join/leave/topic change messages"),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ channel, limit, oldest, latest, cursor, include_activity }) =>
      run(`read messages from ${channel}`, async () => {
        await rt.ready;
        const conv = await rt.directory.resolveConversation(channel);
        const res = await rt.adapter.webClient.conversations.history({
          channel: conv.channelId,
          limit,
          oldest: toSlackTs(oldest),
          latest: toSlackTs(latest),
          cursor,
        });
        const messages = ((res.messages ?? []) as RawSlackMessage[]).filter(
          (m) => include_activity || !ACTIVITY_SUBTYPES.has(m.subtype ?? ""),
        );
        return {
          channel_id: conv.channelId,
          messages: await formatMessages(rt, messages),
          next_cursor: res.response_metadata?.next_cursor || undefined,
        };
      }),
  );

  server.registerTool(
    "conversations_replies",
    {
      title: "Read a Slack thread",
      description:
        "Read the replies in a thread, oldest first, including the parent message. `thread_ts` is the ts of the parent message (or of any message in the thread).",
      inputSchema: z.object({
        channel: z.string().min(1).describe("Channel ID, #channel-name, or user (ID, @handle, email) for a DM"),
        thread_ts: z.string().min(1).describe("Timestamp of the thread's parent message"),
        limit: z.number().int().min(1).max(200).default(50).describe("Number of messages to return"),
        cursor: z.string().optional().describe("Pagination cursor from a previous call"),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ channel, thread_ts, limit, cursor }) =>
      run(`read the thread ${thread_ts} in ${channel}`, async () => {
        await rt.ready;
        const conv = await rt.directory.resolveConversation(channel);
        const res = await rt.adapter.webClient.conversations.replies({
          channel: conv.channelId,
          ts: thread_ts,
          limit,
          cursor,
        });
        return {
          channel_id: conv.channelId,
          thread_ts,
          messages: await formatMessages(rt, (res.messages ?? []) as RawSlackMessage[]),
          next_cursor: res.response_metadata?.next_cursor || undefined,
        };
      }),
  );
}

/** Enforce SLACK_MCP_ALLOWED_CHANNELS after the target has been resolved to an ID. */
async function assertAllowed(rt: SlackRuntime, conv: ResolvedConversation, target: string): Promise<void> {
  const allowed = rt.config.allowedTargets;
  if (!allowed) return;
  let channelName = conv.channelName;
  if (!channelName && !conv.user && allowed.some((a) => a.startsWith("#"))) {
    channelName = (await rt.directory.listChannels().catch(() => [])).find((c) => c.id === conv.channelId)?.name;
  }
  const keys = [conv.channelId, conv.user?.id, conv.user?.email, channelName && `#${channelName}`].filter(
    (k): k is string => Boolean(k),
  );
  if (allowed.some((a) => keys.some((k) => k.toLowerCase() === a.toLowerCase()))) return;
  throw new ToolError(
    `Posting to ${target} (${conv.channelId}) is blocked: it is not in SLACK_MCP_ALLOWED_CHANNELS. Allowed targets: ${allowed.join(", ")}. Tell the user; an admin must add it to the MCP server configuration.`,
  );
}
