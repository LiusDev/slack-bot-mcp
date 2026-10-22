import * as z from "zod";

const ConfigSchema = z
  .object({
    SLACK_BOT_TOKEN: z
      .string({ error: "SLACK_BOT_TOKEN is required (bot token, starts with xoxb-)" })
      .startsWith("xoxb-", "SLACK_BOT_TOKEN must be a bot token starting with xoxb-"),
    SLACK_APP_TOKEN: z.string().startsWith("xapp-", "SLACK_APP_TOKEN must be an app-level token starting with xapp-").optional(),
    SLACK_MODE: z.enum(["socket", "webhook"]).default("socket"),
    SLACK_SIGNING_SECRET: z.string().optional(),
    SLACK_MCP_HTTP_PORT: z.coerce.number().int().positive().default(3000),
    SLACK_MCP_HTTP_PATH: z.string().startsWith("/").default("/slack/events"),
    SLACK_MCP_ALLOWED_CHANNELS: z.string().optional(),
    SLACK_MCP_LOG_LEVEL: z.enum(["debug", "info", "warn", "error", "silent"]).default("info"),
  })
  .superRefine((env, ctx) => {
    if (env.SLACK_MODE === "socket" && !env.SLACK_APP_TOKEN) {
      ctx.addIssue({
        code: "custom",
        path: ["SLACK_APP_TOKEN"],
        message: "SLACK_APP_TOKEN is required in socket mode (app-level token with connections:write, starts with xapp-)",
      });
    }
    if (env.SLACK_MODE === "webhook" && !env.SLACK_SIGNING_SECRET) {
      ctx.addIssue({
        code: "custom",
        path: ["SLACK_SIGNING_SECRET"],
        message: "SLACK_SIGNING_SECRET is required in webhook mode",
      });
    }
  });

export interface Config {
  botToken: string;
  appToken?: string;
  mode: "socket" | "webhook";
  signingSecret?: string;
  httpPort: number;
  httpPath: string;
  /** Channel IDs, user IDs or #names the bot may post to. Undefined means no restriction. */
  allowedTargets?: string[];
  logLevel: "debug" | "info" | "warn" | "error" | "silent";
}

export class ConfigError extends Error {}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((issue) => `  - ${issue.message}`);
    throw new ConfigError(`Invalid configuration:\n${lines.join("\n")}`);
  }
  const e = parsed.data;
  const allowed = e.SLACK_MCP_ALLOWED_CHANNELS?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    botToken: e.SLACK_BOT_TOKEN,
    appToken: e.SLACK_APP_TOKEN,
    mode: e.SLACK_MODE,
    signingSecret: e.SLACK_SIGNING_SECRET,
    httpPort: e.SLACK_MCP_HTTP_PORT,
    httpPath: e.SLACK_MCP_HTTP_PATH,
    allowedTargets: allowed && allowed.length > 0 ? allowed : undefined,
    logLevel: e.SLACK_MCP_LOG_LEVEL,
  };
}
