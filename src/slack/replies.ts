import type { WebClient } from "@slack/web-api";
import type { RawSlackMessage } from "../tools/messages";
import { ACTIVITY_SUBTYPES } from "../tools/messages";

/** Subtypes that are not a person replying. file_share and thread_broadcast are real replies. */
const NON_REPLY_SUBTYPES = new Set([...ACTIVITY_SUBTYPES, "bot_message", "message_changed", "message_deleted"]);

export interface ReplyFilter {
  sinceTs: string;
  botUserId?: string;
  fromUserId?: string;
}

/** Keep messages a person posted after `sinceTs`, oldest first, without duplicates. */
export function selectReplies(messages: RawSlackMessage[], filter: ReplyFilter): RawSlackMessage[] {
  const seen = new Set<string>();
  return messages
    .filter((m) => {
      if (!m.ts || seen.has(m.ts)) return false;
      seen.add(m.ts);
      return (
        Number(m.ts) > Number(filter.sinceTs) &&
        m.user !== undefined &&
        m.user !== filter.botUserId &&
        !m.bot_id &&
        !NON_REPLY_SUBTYPES.has(m.subtype ?? "") &&
        (!filter.fromUserId || m.user === filter.fromUserId)
      );
    })
    .sort((a, b) => Number(a.ts) - Number(b.ts));
}

/**
 * Fetch replies posted after `sinceTs`. With `threadTs`, only that thread is
 * read. Otherwise both new top-level messages and replies in the thread
 * started by the `sinceTs` message are read, because people answer either way.
 */
export async function fetchRepliesSince(
  client: WebClient,
  channelId: string,
  filter: ReplyFilter & { threadTs?: string },
): Promise<RawSlackMessage[]> {
  const { sinceTs, threadTs } = filter;
  if (threadTs) {
    const res = await client.conversations.replies({ channel: channelId, ts: threadTs, oldest: sinceTs, limit: 200 });
    return selectReplies((res.messages ?? []) as RawSlackMessage[], filter);
  }
  const [history, thread] = await Promise.all([
    client.conversations.history({ channel: channelId, oldest: sinceTs, limit: 200 }),
    // `sinceTs` may not be a message (e.g. "now"); Slack then answers thread_not_found.
    client.conversations
      .replies({ channel: channelId, ts: sinceTs, oldest: sinceTs, limit: 200 })
      .catch((err: { data?: { error?: string } }) => {
        if (err.data?.error === "thread_not_found" || err.data?.error === "message_not_found") return { messages: [] };
        throw err;
      }),
  ]);
  return selectReplies([...((history.messages ?? []) as RawSlackMessage[]), ...((thread.messages ?? []) as RawSlackMessage[])], filter);
}
