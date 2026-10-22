import { describe, expect, it } from "vitest";
import { buildBlocks } from "../src/slack/blocks";
import { registerMessageTools } from "../src/tools/messages";

type Handler = (args: Record<string, unknown>) => Promise<{ content: Array<{ text: string }>; isError?: boolean }>;

function setup(update: (args: Record<string, unknown>) => Promise<Record<string, unknown>>) {
  const handlers = new Map<string, Handler>();
  const server = { registerTool: (name: string, _config: unknown, cb: Handler) => handlers.set(name, cb) };
  const rt = {
    config: {},
    ready: Promise.resolve({ userId: "BOT", teamId: "T1" }),
    adapter: { webClient: { chat: { update, getPermalink: async () => ({ permalink: "https://x/p1" }) } } },
    directory: { resolveConversation: async (c: string) => ({ channelId: c }) },
  };
  registerMessageTools(server as never, rt as never);
  return handlers.get("edit_message")!;
}

describe("edit_message", () => {
  it("always sends blocks so old Block Kit content is replaced", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const edit = setup(async (args) => {
      calls.push(args);
      return { ok: true, channel: "C1", ts: "1.0" };
    });
    const result = await edit({ channel: "C1", ts: "1.0", text: "fixed **typo**", format: "markdown" });
    expect(result.isError).toBeUndefined();
    expect(calls[0]).toMatchObject({ channel: "C1", ts: "1.0", text: "fixed **typo**" });
    expect(calls[0]!.blocks).toEqual([{ type: "markdown", text: "fixed **typo**" }]);
    expect(JSON.parse(result.content[0]!.text)).toMatchObject({ ok: true, permalink: "https://x/p1" });
  });

  it("explains when the message belongs to someone else", async () => {
    const edit = setup(async () => {
      throw Object.assign(new Error("cant_update_message"), {
        code: "slack_webapi_platform_error",
        data: { error: "cant_update_message" },
      });
    });
    const result = await edit({ channel: "C1", ts: "1.0", text: "x", format: "markdown" });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("only edit messages it posted itself");
  });
});

describe("buildBlocks always", () => {
  it("renders text blocks even without context or custom blocks", () => {
    expect(buildBlocks({ text: "hi", format: "plain", always: true })).toEqual([
      { type: "section", text: { type: "plain_text", text: "hi", emoji: true } },
    ]);
  });
});
