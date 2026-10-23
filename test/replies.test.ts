import { describe, expect, it } from "vitest";
import { fetchRepliesSince, selectReplies } from "../src/slack/replies";

describe("selectReplies", () => {
  const since = "100.0";
  it("keeps human messages after since_ts, oldest first, without duplicates", () => {
    const result = selectReplies(
      [
        { ts: "103.0", user: "U1", text: "later" },
        { ts: "101.0", user: "U1", text: "first" },
        { ts: "101.0", user: "U1", text: "first (dup from thread)" },
        { ts: "100.0", user: "BOT", text: "the question" },
        { ts: "99.0", user: "U1", text: "before" },
      ],
      { sinceTs: since, botUserId: "BOT" },
    );
    expect(result.map((m) => m.ts)).toEqual(["101.0", "103.0"]);
  });

  it("ignores bots, activity and edits but keeps files and thread broadcasts", () => {
    const result = selectReplies(
      [
        { ts: "101.0", user: "BOT", text: "self" },
        { ts: "102.0", user: "U2", bot_id: "B1", text: "other bot" },
        { ts: "103.0", user: "U1", subtype: "channel_join" },
        { ts: "104.0", user: "U1", subtype: "message_changed" },
        { ts: "105.0", user: "U1", subtype: "file_share", text: "screenshot" },
        { ts: "106.0", user: "U1", subtype: "thread_broadcast", text: "answer" },
      ],
      { sinceTs: since, botUserId: "BOT" },
    );
    expect(result.map((m) => m.ts)).toEqual(["105.0", "106.0"]);
  });

  it("filters by author when from_user is set", () => {
    const result = selectReplies(
      [
        { ts: "101.0", user: "U1" },
        { ts: "102.0", user: "U2" },
      ],
      { sinceTs: since, fromUserId: "U2" },
    );
    expect(result.map((m) => m.user)).toEqual(["U2"]);
  });
});

describe("fetchRepliesSince", () => {
  const message = (ts: string, user = "U1") => ({ ts, user, text: ts });
  const client = (history: unknown[], thread: unknown[]) => {
    const calls = { history: 0, replies: [] as string[] };
    const c = {
      conversations: {
        history: async () => ((calls.history += 1), { messages: history }),
        replies: async ({ ts }: { ts: string }) => (calls.replies.push(ts), { messages: thread }),
      },
    };
    return { c: c as never, calls };
  };

  it("with thread_ts, returns thread replies and new top-level messages", async () => {
    const { c, calls } = client([message("105.0")], [message("101.0"), message("105.0")]);
    const result = await fetchRepliesSince(c, "D1", { sinceTs: "100.0", threadTs: "90.0", botUserId: "BOT" });
    expect(result.map((m) => m.ts)).toEqual(["101.0", "105.0"]);
    expect(calls.history).toBe(1);
    expect(calls.replies).toEqual(["90.0"]);
  });

  it("without thread_ts, reads the thread of the since_ts message", async () => {
    const { c, calls } = client([], [message("101.0")]);
    await fetchRepliesSince(c, "C1", { sinceTs: "100.0" });
    expect(calls.replies).toEqual(["100.0"]);
  });
});
