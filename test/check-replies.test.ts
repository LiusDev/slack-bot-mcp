import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Inbox } from "../src/slack/inbox";
import { PendingStore } from "../src/slack/pending";
import { registerInboxTools } from "../src/tools/inbox";

type Handler = (args: Record<string, unknown>) => Promise<{ content: Array<{ text: string }>; isError?: boolean }>;

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "check-replies-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Minimal runtime with a fake Slack client: D1 has a reply in the question's thread, D2 has none. */
function setup() {
  const handlers = new Map<string, Handler>();
  const server = { registerTool: (name: string, _config: unknown, cb: Handler) => handlers.set(name, cb) };
  const threads: Record<string, Array<Record<string, string>>> = {
    "D1:100.0": [
      { ts: "100.0", user: "BOT", text: "question" },
      { ts: "150.0", user: "U1", text: "use https://example.com" },
    ],
  };
  const webClient = {
    conversations: {
      history: async () => ({ messages: [] }),
      replies: async ({ channel, ts }: { channel: string; ts: string }) => {
        const messages = threads[`${channel}:${ts}`];
        if (!messages) throw Object.assign(new Error("thread_not_found"), { data: { error: "thread_not_found" } });
        return { messages };
      },
    },
  };
  const pending = new PendingStore(dir, 7);
  const rt = {
    ready: Promise.resolve({ userId: "BOT", teamId: "T1" }),
    adapter: { webClient },
    directory: {
      userName: async (id?: string) => (id === "U1" ? "Jane" : undefined),
      resolveConversation: async (c: string) => ({ channelId: c }),
    },
    inbox: new Inbox(),
    pending,
  };
  registerInboxTools(server as never, rt as never);
  return { handlers, pending };
}

describe("check_replies", () => {
  it("returns answers for pending questions and removes them", async () => {
    const { handlers, pending } = setup();
    await pending.add("T1", { channel_id: "D1", ts: "100.0", target: "@jane", summary: "Which URL?" });
    await pending.add("T1", { channel_id: "D2", ts: "200.0", target: "@bob", summary: "Ping?" });

    const result = await handlers.get("check_replies")!({ dismiss: [] });
    expect(result.isError).toBeUndefined();
    const body = JSON.parse(result.content[0]!.text);
    expect(body.answered).toHaveLength(1);
    expect(body.answered[0].question).toBe("Which URL?");
    expect(body.answered[0].replies[0]).toMatchObject({ ts: "150.0", user_name: "Jane" });
    expect(body.still_waiting.map((q: { target: string }) => q.target)).toEqual(["@bob"]);

    const left = await pending.list("T1");
    expect(left.questions.map((q) => q.channel_id)).toEqual(["D2"]);
  });

  it("dismisses questions on request", async () => {
    const { handlers, pending } = setup();
    const q = await pending.add("T1", { channel_id: "D2", ts: "200.0", target: "@bob", summary: "Ping?" });
    const body = JSON.parse((await handlers.get("check_replies")!({ dismiss: [q.id] })).content[0]!.text);
    expect(body.dismissed).toEqual([q.id]);
    expect(body.pending).toBe(0);
  });

  it("wait_for_reply tells the agent to stop after repeated timeouts and saves the question", async () => {
    const { handlers, pending } = setup();
    const args = { channel: "D2", since_ts: "200.0", timeout_seconds: 5, poll_interval_seconds: 2 };
    const first = JSON.parse((await handlers.get("wait_for_reply")!(args)).content[0]!.text);
    expect(first.replied).toBe(false);
    expect(first.next_step).toMatch(/once more/);
    const second = JSON.parse((await handlers.get("wait_for_reply")!(args)).content[0]!.text);
    expect(second.next_step).toMatch(/Stop waiting now/);
    expect((await pending.list("T1")).questions).toHaveLength(1);
  }, 20_000);
});
