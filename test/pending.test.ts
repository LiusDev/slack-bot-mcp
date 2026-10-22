import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PendingStore } from "../src/slack/pending";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pending-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const question = { channel_id: "D1", ts: "100.000001", target: "@jane", summary: "Which URL?" };

describe("PendingStore", () => {
  it("persists questions across store instances and dedupes by channel and ts", async () => {
    const a = new PendingStore(dir, 7);
    const first = await a.add("T1", question);
    const again = await a.add("T1", { ...question, summary: "other" });
    expect(again.id).toBe(first.id);

    const b = new PendingStore(dir, 7);
    const { questions } = await b.list("T1");
    expect(questions).toHaveLength(1);
    expect(questions[0]?.summary).toBe("Which URL?");
    expect((await b.list("T2")).questions).toHaveLength(0);
  });

  it("removes questions by id", async () => {
    const store = new PendingStore(dir, 7);
    const q = await store.add("T1", question);
    expect(await store.remove("T1", [q.id, "missing"])).toEqual([q.id]);
    expect((await store.list("T1")).questions).toHaveLength(0);
  });

  it("drops and reports questions past the TTL", async () => {
    const store = new PendingStore(dir, 1);
    await store.add("T1", { ...question, asked_at: new Date(Date.now() - 2 * 86_400_000).toISOString() });
    await store.add("T1", { ...question, ts: "200.0" });
    const { questions, expired } = await store.list("T1");
    expect(questions.map((q) => q.ts)).toEqual(["200.0"]);
    expect(expired.map((q) => q.ts)).toEqual(["100.000001"]);
    const file = JSON.parse(await readFile(join(dir, "pending-T1.json"), "utf8"));
    expect(file.questions).toHaveLength(1);
  });

  it("reads a file with no questions", async () => {
    await writeFile(join(dir, "pending-T1.json"), JSON.stringify({ version: 1, questions: [] }));
    expect((await new PendingStore(dir, 7).list("T1")).questions).toEqual([]);
  });
});
