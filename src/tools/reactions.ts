import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import type { SlackRuntime } from "../slack/bot";
import { run } from "./util";

const ReactionInput = z.object({
  channel: z.string().min(1).describe("Channel ID, #channel-name, or user (ID, @handle, email) for a DM"),
  ts: z.string().min(1).describe("Timestamp of the message"),
  emoji: z.string().min(1).describe("Emoji name without colons, e.g. thumbsup, eyes, white_check_mark"),
});

export function registerReactionTools(server: McpServer, rt: SlackRuntime): void {
  server.registerTool(
    "reactions_add",
    {
      title: "Add a Slack reaction",
      description: "Add an emoji reaction to a message as the bot.",
      inputSchema: ReactionInput,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    ({ channel, ts, emoji }) =>
      run(`add the :${emoji}: reaction`, async () => {
        await rt.ready;
        const conv = await rt.directory.resolveConversation(channel);
        await rt.adapter.addReaction(`slack:${conv.channelId}:`, ts, emoji.replace(/:/g, ""));
        return { ok: true, channel_id: conv.channelId, ts, emoji };
      }),
  );

  server.registerTool(
    "reactions_remove",
    {
      title: "Remove a Slack reaction",
      description: "Remove an emoji reaction the bot previously added to a message.",
      inputSchema: ReactionInput,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    ({ channel, ts, emoji }) =>
      run(`remove the :${emoji}: reaction`, async () => {
        await rt.ready;
        const conv = await rt.directory.resolveConversation(channel);
        await rt.adapter.removeReaction(`slack:${conv.channelId}:`, ts, emoji.replace(/:/g, ""));
        return { ok: true, channel_id: conv.channelId, ts, emoji };
      }),
  );
}
