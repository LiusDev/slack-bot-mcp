import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface PendingQuestion {
  id: string;
  channel_id: string;
  /** Timestamp of the question message; replies are messages after it. */
  ts: string;
  /** Thread the question was posted in, if any. */
  thread_ts?: string;
  /** Who is expected to answer, when known (the DM recipient). */
  recipient_user_id?: string;
  recipient_name?: string;
  /** Where the question went, as the agent named it. */
  target: string;
  /** First part of the question text, so a later session knows what was asked. */
  summary: string;
  asked_at: string;
}

interface PendingFile {
  version: 1;
  questions: PendingQuestion[];
}

/**
 * Questions the bot is waiting on, stored in a JSON file so they survive the
 * MCP process and agent session. One file per Slack workspace. The file is
 * re-read on every operation, so several server processes see the same list.
 */
export class PendingStore {
  constructor(
    private readonly dir: string,
    private readonly ttlDays: number,
  ) {}

  private file(teamId: string): string {
    return join(this.dir, `pending-${teamId.replace(/[^A-Za-z0-9_-]/g, "_")}.json`);
  }

  /** All pending questions, oldest first. Expired ones are dropped and returned separately. */
  async list(teamId: string): Promise<{ questions: PendingQuestion[]; expired: PendingQuestion[] }> {
    const all = await this.read(teamId);
    const cutoff = Date.now() - this.ttlDays * 86_400_000;
    const expired = all.filter((q) => Date.parse(q.asked_at) < cutoff);
    if (expired.length > 0) await this.write(teamId, all.filter((q) => !expired.includes(q)));
    return { questions: all.filter((q) => !expired.includes(q)), expired };
  }

  /** Add a question unless one already exists for the same channel and ts. */
  async add(teamId: string, question: Omit<PendingQuestion, "id" | "asked_at"> & { asked_at?: string }): Promise<PendingQuestion> {
    const all = await this.read(teamId);
    const existing = all.find((q) => q.channel_id === question.channel_id && q.ts === question.ts);
    if (existing) return existing;
    const entry: PendingQuestion = { id: randomUUID().slice(0, 8), asked_at: new Date().toISOString(), ...question };
    await this.write(teamId, [...all, entry]);
    return entry;
  }

  async remove(teamId: string, ids: string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const all = await this.read(teamId);
    const removed = all.filter((q) => ids.includes(q.id)).map((q) => q.id);
    if (removed.length > 0) await this.write(teamId, all.filter((q) => !ids.includes(q.id)));
    return removed;
  }

  private async read(teamId: string): Promise<PendingQuestion[]> {
    try {
      const data = JSON.parse(await readFile(this.file(teamId), "utf8")) as PendingFile;
      return Array.isArray(data.questions) ? data.questions : [];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
  }

  private async write(teamId: string, questions: PendingQuestion[]): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const file = this.file(teamId);
    const tmp = `${file}.${process.pid}.tmp`;
    const data: PendingFile = { version: 1, questions };
    await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    await rename(tmp, file);
  }
}
