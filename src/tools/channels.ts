import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import type { SlackRuntime } from "../slack/bot";
import { toSlackChannel } from "../slack/directory";
import { run } from "./util";

const CHANNEL_TYPES = ["public_channel", "private_channel", "im", "mpim"] as const;

export function registerChannelTools(server: McpServer, rt: SlackRuntime): void {
  server.registerTool(
    "channels_list",
    {
      title: "List Slack channels",
      description:
        "List channels the bot can see, optionally filtered by name. Private channels and DMs appear only if the bot is a member. `is_member: false` means the bot must be invited before it can post there (unless it has chat:write.public).",
      inputSchema: z.object({
        types: z
          .array(z.enum(CHANNEL_TYPES))
          .min(1)
          .default(["public_channel", "private_channel"])
          .describe("Conversation types to include"),
        query: z.string().optional().describe("Case-insensitive filter on channel name, topic or purpose"),
        member_only: z.boolean().default(false).describe("Only channels the bot is a member of"),
        limit: z.number().int().min(1).max(1000).default(100).describe("Maximum number of channels to return"),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ types, query, member_only, limit }) =>
      run("list Slack channels", async () => {
        await rt.ready;
        const q = query?.trim().replace(/^#/, "").toLowerCase();
        const results: Array<Record<string, unknown>> = [];
        let cursor: string | undefined;
        let scanned = 0;
        do {
          const res = await rt.adapter.webClient.conversations.list({
            types: types.join(","),
            exclude_archived: true,
            limit: 200,
            cursor,
          });
          for (const c of res.channels ?? []) {
            scanned++;
            if (c.is_im) {
              if (q && !(await rt.directory.userName(c.user))?.toLowerCase().includes(q)) continue;
              results.push({ id: c.id, type: "im", user_id: c.user, user_name: await rt.directory.userName(c.user) });
              continue;
            }
            const channel = toSlackChannel(c);
            if (member_only && !channel.is_member) continue;
            const haystack = [channel.name, channel.topic ?? "", channel.purpose ?? ""].join(" ").toLowerCase();
            if (q && !haystack.includes(q)) continue;
            results.push({ ...channel, type: c.is_mpim ? "mpim" : channel.is_private ? "private_channel" : "public_channel" });
          }
          cursor = res.response_metadata?.next_cursor || undefined;
        } while (cursor && results.length < limit && scanned < 10_000);
        return { channels: results.slice(0, limit), truncated: results.length > limit || Boolean(cursor) };
      }),
  );
}
