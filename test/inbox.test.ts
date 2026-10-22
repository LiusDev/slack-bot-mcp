import { describe, expect, it } from "vitest";
import { Inbox } from "../src/slack/inbox";

const msg = (ts: string, channel_id = "D1") => ({
  channel_id,
  thread_ts: ts,
  ts,
  user_id: "U1",
  user_name: "Jane",
  text: `hello ${ts}`,
  is_dm: true,
  is_mention: false,
});

describe("Inbox", () => {
  it("dedupes, filters and marks messages read", () => {
    const inbox = new Inbox();
    inbox.push(msg("1.0"));
    inbox.push(msg("1.0"));
    inbox.push(msg("2.0", "C1"));
    expect(inbox.list()).toHaveLength(2);
    expect(inbox.list({ channelId: "C1" })).toHaveLength(1);
    expect(inbox.list({ sinceTs: "1.5" }).map((m) => m.ts)).toEqual(["2.0"]);
    inbox.markRead(inbox.list({ channelId: "D1" }));
    expect(inbox.list({ unreadOnly: true }).map((m) => m.ts)).toEqual(["2.0"]);
  });

  it("drops the oldest message beyond capacity", () => {
    const inbox = new Inbox(2);
    for (const ts of ["1", "2", "3"]) inbox.push(msg(ts));
    expect(inbox.list().map((m) => m.ts)).toEqual(["2", "3"]);
  });

  it("nextFor wakes on a matching message and times out otherwise", async () => {
    const inbox = new Inbox();
    const start = Date.now();
    const waiting = inbox.nextFor("D1", 5000);
    setTimeout(() => inbox.push(msg("9.0")), 20);
    await waiting;
    expect(Date.now() - start).toBeLessThan(1000);

    const t0 = Date.now();
    await inbox.nextFor("D1", 50);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(45);
  });
});
