import { describe, expect, it } from "vitest";
import { selectReplies } from "../src/slack/replies";

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
