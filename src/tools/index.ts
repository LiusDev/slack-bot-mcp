import type { McpServer } from "@modelcontextprotocol/server";
import type { SlackRuntime } from "../slack/bot";
import { registerChannelTools } from "./channels";
import { registerInboxTools } from "./inbox";
import { registerMessageTools } from "./messages";
import { registerReactionTools } from "./reactions";
import { registerUserTools } from "./users";
import { registerWhoamiTool } from "./whoami";

export function registerAllTools(server: McpServer, rt: SlackRuntime): void {
  registerWhoamiTool(server, rt);
  registerUserTools(server, rt);
  registerChannelTools(server, rt);
  registerMessageTools(server, rt);
  registerReactionTools(server, rt);
  registerInboxTools(server, rt);
}
