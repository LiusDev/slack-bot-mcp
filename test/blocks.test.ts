import { describe, expect, it } from "vitest";
import { ToolError } from "../src/errors";
import { buildBlocks, renderContextLine } from "../src/slack/blocks";

describe("buildBlocks", () => {
  it("returns undefined for plain messages so Chat SDK posts them", () => {
    expect(buildBlocks({ text: "hi", format: "markdown" })).toBeUndefined();
    expect(buildBlocks({ text: "hi", format: "markdown", context: [] })).toBeUndefined();
  });

  it("renders markdown text, a divider and a context line", () => {
    const blocks = buildBlocks({
      text: "Is **VEC-123** ready?",
      format: "markdown",
      context: [
        { label: "Jira", value: "VEC-123", url: "https://jira.example.com/browse/VEC-123" },
        { label: "Asked by", value: "<agent>" },
        "_sent by the deploy agent_",
      ],
    });
    expect(blocks).toEqual([
      { type: "markdown", text: "Is **VEC-123** ready?" },
      { type: "divider" },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: "*Jira:* <https://jira.example.com/browse/VEC-123|VEC-123>  ·  *Asked by:* &lt;agent&gt;  ·  _sent by the deploy agent_",
          },
        ],
      },
    ]);
  });

  it("splits long plain text into sections", () => {
    const blocks = buildBlocks({ text: "x".repeat(6500), format: "plain", context: ["ctx"] })!;
    expect(blocks.filter((b) => b.type === "section")).toHaveLength(3);
  });

  it("uses custom blocks instead of the text and still appends context", () => {
    const header = { type: "header", text: { type: "plain_text", text: "Deploy" } };
    const blocks = buildBlocks({ text: "fallback", format: "markdown", blocks: [header], context: ["ctx"] })!;
    expect(blocks[0]).toEqual(header);
    expect(blocks.map((b) => b.type)).toEqual(["header", "divider", "context"]);
  });

  it("rejects payloads over Slack's limits", () => {
    expect(() => buildBlocks({ text: "x".repeat(12_001), format: "markdown", context: ["c"] })).toThrow(ToolError);
    expect(() => renderContextLine(["y".repeat(3_001)])).toThrow(ToolError);
    const many = Array.from({ length: 49 }, () => ({ type: "divider" }));
    expect(() => buildBlocks({ text: "t", format: "markdown", blocks: many, context: ["c"] })).toThrow(/allows 50/);
  });
});
