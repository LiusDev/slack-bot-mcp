import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";
import { ToolError } from "../src/errors";
import { toSlackTs } from "../src/tools/util";

describe("toSlackTs", () => {
  it("accepts Slack ts, ISO dates and relative durations", () => {
    expect(toSlackTs("1712345678.123456")).toBe("1712345678.123456");
    expect(toSlackTs("2024-01-01T00:00:00Z")).toBe("1704067200");
    const twoHoursAgo = Math.floor(Date.now() / 1000) - 7200;
    expect(Math.abs(Number(toSlackTs("2h")) - twoHoursAgo)).toBeLessThanOrEqual(1);
    expect(toSlackTs(undefined)).toBeUndefined();
  });

  it("rejects unparseable input with guidance", () => {
    expect(() => toSlackTs("last tuesday-ish")).toThrow(ToolError);
  });
});

describe("loadConfig", () => {
  it("requires the app token in socket mode", () => {
    expect(() => loadConfig({ SLACK_BOT_TOKEN: "xoxb-1" })).toThrow(/SLACK_APP_TOKEN is required/);
  });

  it("requires the signing secret in webhook mode", () => {
    expect(() => loadConfig({ SLACK_BOT_TOKEN: "xoxb-1", SLACK_MODE: "webhook" })).toThrow(/SLACK_SIGNING_SECRET/);
  });

  it("parses the allowlist", () => {
    const config = loadConfig({
      SLACK_BOT_TOKEN: "xoxb-1",
      SLACK_APP_TOKEN: "xapp-1",
      SLACK_MCP_ALLOWED_CHANNELS: "C123, #general ,",
    });
    expect(config.mode).toBe("socket");
    expect(config.allowedTargets).toEqual(["C123", "#general"]);
  });
});
