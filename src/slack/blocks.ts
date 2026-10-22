import { ToolError } from "../errors";

export type ContextItem = string | { label?: string; value: string; url?: string };
export type Block = Record<string, unknown>;

const MAX_BLOCKS = 50;
const MARKDOWN_BLOCK_LIMIT = 12_000;
const SECTION_TEXT_LIMIT = 3_000;
const CONTEXT_TEXT_LIMIT = 3_000;

/** Escape the characters Slack mrkdwn treats as control characters. */
export function escapeMrkdwn(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Render context items as one mrkdwn line: `*label:* value · *label:* <url|value>`. */
export function renderContextLine(items: ContextItem[]): string {
  const line = items
    .map((item) => {
      if (typeof item === "string") return item;
      const value = item.url ? `<${item.url}|${escapeMrkdwn(item.value)}>` : escapeMrkdwn(item.value);
      return item.label ? `*${escapeMrkdwn(item.label)}:* ${value}` : value;
    })
    .join("  ·  ");
  if (line.length > CONTEXT_TEXT_LIMIT) {
    throw new ToolError(`The context line is ${line.length} characters; Slack allows ${CONTEXT_TEXT_LIMIT}. Shorten or drop some items.`);
  }
  return line;
}

function textBlocks(text: string, format: "markdown" | "plain"): Block[] {
  if (format === "markdown") {
    if (text.length > MARKDOWN_BLOCK_LIMIT) {
      throw new ToolError(`The message is ${text.length} characters; a Slack markdown block allows ${MARKDOWN_BLOCK_LIMIT}. Split it into several messages.`);
    }
    return [{ type: "markdown", text }];
  }
  const blocks: Block[] = [];
  for (let i = 0; i < text.length; i += SECTION_TEXT_LIMIT) {
    blocks.push({ type: "section", text: { type: "plain_text", text: text.slice(i, i + SECTION_TEXT_LIMIT), emoji: true } });
  }
  return blocks;
}

/**
 * Build the Block Kit payload for a message, or undefined when plain text is
 * enough. Custom `blocks` replace the rendered text (which then only serves
 * as the notification fallback); `context` adds a divider and a small
 * context line at the bottom.
 */
export function buildBlocks(opts: {
  text: string;
  format: "markdown" | "plain";
  blocks?: Block[];
  context?: ContextItem[];
}): Block[] | undefined {
  const hasContext = Boolean(opts.context && opts.context.length > 0);
  if (!opts.blocks && !hasContext) return undefined;
  const result = opts.blocks ? [...opts.blocks] : textBlocks(opts.text, opts.format);
  if (hasContext) {
    result.push({ type: "divider" }, { type: "context", elements: [{ type: "mrkdwn", text: renderContextLine(opts.context!) }] });
  }
  if (result.length > MAX_BLOCKS) {
    throw new ToolError(`The message has ${result.length} blocks; Slack allows ${MAX_BLOCKS}. Split it into several messages.`);
  }
  return result;
}
