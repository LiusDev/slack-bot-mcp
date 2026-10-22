import { describe, expect, it } from "vitest";
import { describeError, MissingScopeError, ToolError, toToolError } from "../src/errors";

const platformError = (error: string, extra: Record<string, string> = {}) =>
  Object.assign(new Error(`An API error occurred: ${error}`), {
    code: "slack_webapi_platform_error",
    data: { ok: false, error, ...extra },
  });

describe("toToolError", () => {
  it("names the missing scope and how to fix it", () => {
    const result = toToolError(
      platformError("missing_scope", { needed: "reactions:write", provided: "chat:write,users:read" }),
      "add a reaction",
    );
    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("`reactions:write`");
    expect(text).toContain("chat:write,users:read");
    expect(text).toContain("reinstall");
  });

  it("explains not_in_channel with the invite hint", () => {
    const text = describeError(platformError("not_in_channel"), "send a message");
    expect(text).toContain("`not_in_channel`");
    expect(text).toContain("/invite");
  });

  it("reports rate limits with the retry delay", () => {
    const err = Object.assign(new Error("rate limited"), { code: "slack_webapi_rate_limited_error", retryAfter: 30 });
    expect(describeError(err, "list users")).toContain("Retry after 30 seconds");
    const chatErr = Object.assign(new Error("rate limited"), { code: "RATE_LIMITED", retryAfterMs: 1500 });
    expect(describeError(chatErr, "post")).toContain("Retry after 2 seconds");
  });

  it("passes ToolError messages through unchanged", () => {
    expect(describeError(new ToolError("custom message"), "x")).toBe("custom message");
    expect(describeError(new MissingScopeError(["users:read.email"], ["users:read"], "look up users by email"), "x")).toContain(
      "`users:read.email`",
    );
  });

  it("falls back to the original message", () => {
    expect(describeError(new Error("boom"), "do something")).toBe("Failed to do something: boom");
    expect(describeError(platformError("some_new_error"), "do something")).toContain("`some_new_error`");
  });
});
