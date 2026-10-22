import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import type { SlackRuntime } from "../slack/bot";
import { describeError, ToolError } from "../errors";
import { fetchRepliesSince } from "../slack/replies";
import { formatMessages } from "./messages";
import { run, toSlackTs } from "./util";

/** After this many timed-out waits for the same question, tell the agent to stop polling. */
const MAX_WAITS_BEFORE_STOP = 2;

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

  // Timed-out waits per question, to stop agents from polling for hours.
  const timeouts = new Map<string, number>();

  server.registerTool(
    "wait_for_reply",
    {
      title: "Wait for a Slack reply",
      description:
        "Block for a short time until someone other than the bot replies in a channel, DM or thread, then return the new messages. Use it only when an answer is likely within a minute or two; every call costs a model turn. Pass `since_ts` = the ts of your question (from send_message). Replies both as new messages and inside the question's thread are found. On `replied: false`, follow the returned `next_step`: after a couple of timeouts, stop waiting, tell the user, and collect the answer later with check_replies. Keep `timeout_seconds` below your MCP client's tool-call timeout (often 60 seconds; Claude Code users can raise it with MCP_TOOL_TIMEOUT).",
      inputSchema: z.object({
        channel: z.string().min(1).describe("Channel ID, #channel-name, or user (ID, @handle, email) for their DM"),
        since_ts: z.string().optional().describe("ts of your question; only later messages count (default: now)"),
        thread_ts: z.string().optional().describe("Only look inside this thread"),
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
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    ({ channel, thread_ts, since_ts, from_user, timeout_seconds, poll_interval_seconds }) =>
      run(`wait for a reply in ${channel}`, async () => {
        const id = await rt.ready;
        const conv = await rt.directory.resolveConversation(channel);
        const fromUserId = from_user ? (await rt.directory.resolveUser(from_user)).id : undefined;
        const since = toSlackTs(since_ts) ?? (Date.now() / 1000).toFixed(6);
        const deadline = Date.now() + timeout_seconds * 1000;
        const key = `${conv.channelId}:${thread_ts ?? ""}:${since}`;

        while (true) {
          const replies = await fetchRepliesSince(rt.adapter.webClient, conv.channelId, {
            sinceTs: since,
            threadTs: thread_ts,
            botUserId: id.userId,
            fromUserId,
          });
          if (replies.length > 0) {
            timeouts.delete(key);
            const saved = (await rt.pending.list(id.teamId ?? "default")).questions.filter(
              (q) => q.channel_id === conv.channelId && q.ts === since,
            );
            await rt.pending.remove(id.teamId ?? "default", saved.map((q) => q.id));
            return { replied: true, channel_id: conv.channelId, messages: await formatMessages(rt, replies) };
          }
          const remaining = deadline - Date.now();
          if (remaining <= 0) break;
          // An inbox event for this channel wakes the loop early; otherwise poll on the interval.
          await rt.inbox.nextFor(conv.channelId, Math.min(poll_interval_seconds * 1000, remaining));
        }

        const count = (timeouts.get(key) ?? 0) + 1;
        timeouts.set(key, count);
        // Save the question so a later session can collect the answer.
        const pending = await rt.pending.add(id.teamId ?? "default", {
          channel_id: conv.channelId,
          ts: since,
          thread_ts,
          recipient_user_id: conv.user?.id ?? fromUserId,
          recipient_name: conv.user ? conv.user.real_name || conv.user.display_name : undefined,
          target: channel,
          summary: "(saved by wait_for_reply)",
        });
        const stop = count >= MAX_WAITS_BEFORE_STOP;
        return {
          replied: false,
          channel_id: conv.channelId,
          since_ts: since,
          pending_question_id: pending.id,
          waits_so_far: count,
          next_step: stop
            ? "Stop waiting now; do not call wait_for_reply again for this question. Tell the user there is no reply yet and that the question is saved. Collect the answer later by calling check_replies with no arguments, for example from a scheduled or looped run (such as `/loop 30m check Slack replies` in Claude Code) or when the user asks."
            : `No reply within ${timeout_seconds} seconds. If an answer is likely within the next minute, call wait_for_reply once more with since_ts=${since}. Otherwise stop, tell the user, and use check_replies later.`,
        };
      }),
  );

  server.registerTool(
    "check_replies",
    {
      title: "Check for Slack replies",
      description:
        "Check once, without waiting, whether people answered the bot. With no arguments, checks every pending question (saved by send_message with expect_reply, or by wait_for_reply on timeout), including ones from earlier sessions; answered questions are removed from the pending list. With `channel` and `since_ts`, checks one conversation instead. Cheap to call, so use it for long waits: end your turn, then call it later from a scheduled or looped run.",
      inputSchema: z.object({
        channel: z
          .string()
          .optional()
          .describe("Check only this conversation (ID, #name, or user). Requires since_ts. Omit to check all pending questions."),
        since_ts: z.string().optional().describe("With channel: only messages after this ts"),
        thread_ts: z.string().optional().describe("With channel: only look inside this thread"),
        dismiss: z
          .array(z.string())
          .default([])
          .describe("Pending question IDs to drop without an answer (e.g. no longer needed)"),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    ({ channel, since_ts, thread_ts, dismiss }) =>
      run("check for Slack replies", async () => {
        const id = await rt.ready;
        const team = id.teamId ?? "default";
        const client = rt.adapter.webClient;

        if (channel) {
          const since = toSlackTs(since_ts);
          if (!since) throw new ToolError("Pass since_ts together with channel, e.g. the ts of your question.");
          const conv = await rt.directory.resolveConversation(channel);
          const replies = await fetchRepliesSince(client, conv.channelId, { sinceTs: since, threadTs: thread_ts, botUserId: id.userId });
          return {
            channel_id: conv.channelId,
            replied: replies.length > 0,
            messages: await formatMessages(rt, replies),
            next_since_ts: replies.at(-1)?.ts ?? since,
          };
        }

        const dismissed = await rt.pending.remove(team, dismiss);
        const { questions, expired } = await rt.pending.list(team);
        if (questions.length === 0) {
          return {
            pending: 0,
            dismissed: dismissed.length > 0 ? dismissed : undefined,
            expired: expired.length > 0 ? expired.map((q) => ({ id: q.id, target: q.target, summary: q.summary })) : undefined,
            note: "No pending questions.",
          };
        }

        const results = await Promise.all(
          questions.map(async (q) => {
            try {
              const replies = await fetchRepliesSince(client, q.channel_id, {
                sinceTs: q.ts,
                threadTs: q.thread_ts,
                botUserId: id.userId,
              });
              return { q, replies, error: undefined };
            } catch (err) {
              return { q, replies: [], error: describeError(err, `check replies in ${q.channel_id}`) };
            }
          }),
        );
        const answered = results.filter((r) => r.replies.length > 0).map((r) => r.q.id);
        await rt.pending.remove(team, answered);

        return {
          answered: await Promise.all(
            results
              .filter((r) => r.replies.length > 0)
              .map(async ({ q, replies }) => ({
                id: q.id,
                target: q.target,
                channel_id: q.channel_id,
                question_ts: q.ts,
                question: q.summary,
                asked_at: q.asked_at,
                replies: await formatMessages(rt, replies),
              })),
          ),
          still_waiting: results
            .filter((r) => r.replies.length === 0)
            .map(({ q, error }) => ({
              id: q.id,
              target: q.target,
              question: q.summary,
              asked_at: q.asked_at,
              error,
            })),
          dismissed: dismissed.length > 0 ? dismissed : undefined,
          expired: expired.length > 0 ? expired.map((q) => ({ id: q.id, target: q.target, summary: q.summary })) : undefined,
        };
      }),
  );
}
