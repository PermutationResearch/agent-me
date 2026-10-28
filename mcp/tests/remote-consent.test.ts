import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../src/storage";
import { Optimizer } from "../src/optimization";
import { extractTraces, reviewRecords, prepareExport } from "../src/traces";

test("remote optimization rejects missing consent, a changed checksum and paid model before creating a job", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-me-remote-consent-"));
  const store = new Store(join(root, "state"));
  const source = join(root, "trace.jsonl");
  const optimizer = new Optimizer(store, { python: process.env.AGENT_ME_OPTIMIZATION_PYTHON ?? "python3", provider: "openrouter" });
  try {
    await writeFile(source, JSON.stringify({ type: "user", message: { content: "Fictional selected request" } }));
    const extracted = await extractTraces(store, [source]);
    const reviewed = await reviewRecords(store, { extraction_id: extracted.extraction_id });
    const exported = await prepareExport(store, { extraction_id: extracted.extraction_id, event_ids: [reviewed.records[0].id], intent: "personal_export", confirm_review: true });
    const input = { export_id: exported.export_id, seed: "Be helpful.", objective: "Stay grounded.", model: "fixture/model:free" };
    await assert.rejects(() => optimizer.start(input), /Confirm sending/);
    await assert.rejects(() => optimizer.start({ ...input, confirm_remote_processing: true, expected_sha256: "0".repeat(64) }), /exact expected_sha256/);
    await assert.rejects(() => optimizer.start({ ...input, model: "fixture/paid", confirm_remote_processing: true, expected_sha256: exported.sha256 }), /free models only/);
    assert.equal((await readdir(store.root)).includes("optimization-requests"), false);
    assert.equal((await readdir(store.root)).includes("optimization-results"), false);
  } finally { await optimizer.close(); await rm(root, { recursive: true, force: true }); }
});
