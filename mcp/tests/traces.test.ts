import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, readFile, stat, rm, truncate, mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/storage";
import { discoverSources, extractTraces, prepareExport, reviewRecords } from "../src/traces";
import { parseTracePack } from "../../frontend/src/tracePack";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "agent-me-mcp-traces-"));
  const store = new Store(join(root, "private"));
  const source = join(root, "source.jsonl");
  const text = [
    { type: "user", sessionId: "fixture-only", message: { content: "Selected request: API_KEY=private-test-value alice@example.com" } },
    { type: "assistant", message: { content: "Unselected assistant response" } },
    { type: "user", message: { content: "Long selected record " + "fictional ".repeat(140) } },
  ].map(row => JSON.stringify(row)).join("\n");
  await writeFile(source, text);
  return { root, store, source, text, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test("extract, review, edit and export preserve the selected-only website contract", async () => {
  const f = await fixture();
  try {
    const extracted = await extractTraces(f.store, [f.source]);
    assert.equal(extracted.events, 3);
    assert.equal(extracted.shared, false);
    assert.ok(extracted.redactions > 0);
    const reviewed = await reviewRecords(f.store, { extraction_id: extracted.extraction_id });
    assert.equal(reviewed.total, 3);
    assert.doesNotMatch(JSON.stringify(reviewed), /private-test-value|alice@example/);
    assert.equal(reviewed.records[2].truncated, true);
    const full = await reviewRecords(f.store, { extraction_id: extracted.extraction_id, event_ids: [reviewed.records[2].id] });
    assert.equal(full.records[0].truncated, false);
    assert.ok(full.records[0].text.length > 1000);
    const chunks = await reviewRecords(f.store, { extraction_id: extracted.extraction_id, event_ids: [reviewed.records[2].id], text_offset: 0, text_limit: 100 });
    assert.equal(chunks.records[0].text.length, 100);
    assert.equal(chunks.records[0].next_text_offset, 100);
    assert.equal(chunks.records[0].truncated, true);
    const continued = await reviewRecords(f.store, { extraction_id: extracted.extraction_id, event_ids: [reviewed.records[2].id], text_offset: 100, text_limit: 20000 });
    assert.equal(chunks.records[0].text + continued.records[0].text, full.records[0].text);
    assert.equal(continued.records[0].next_text_offset, null);
    const selected = [reviewed.records[0].id, reviewed.records[2].id];
    const exported = await prepareExport(f.store, { extraction_id: extracted.extraction_id, event_ids: selected, edits: { [selected[0]]: "Reviewed change: password=private-edit" }, intent: "sale_offer", requested_uses: ["evaluation"], confirm_review: true });
    const pack = await parseTracePack(JSON.parse(await readFile(exported.path, "utf8")));
    assert.equal(pack.events.length, 2);
    assert.equal(exported.sha256, pack.integrity.sha256);
    assert.deepEqual(pack.offer?.requested_uses, ["evaluation"]);
    assert.equal(pack.events[0].edited, true);
    assert.match(pack.events[0].content, /Reviewed change/);
    assert.doesNotMatch(JSON.stringify(pack), /Unselected assistant|private-edit|private-test-value/);
    assert.equal(await readFile(f.source, "utf8"), f.text, "source history remains byte-for-byte unchanged");
    assert.equal((await stat(exported.path)).mode & 0o777, 0o600);
    assert.equal((await stat(f.store.root)).mode & 0o777, 0o700);
  } finally { await f.cleanup(); }
});

test("review and export require explicit valid selections and confirmation", async () => {
  const f = await fixture();
  try {
    const extracted = await extractTraces(f.store, [f.source]);
    const review = await reviewRecords(f.store, { extraction_id: extracted.extraction_id });
    const input = { extraction_id: extracted.extraction_id, event_ids: [review.records[0].id], intent: "sale_offer" as const, requested_uses: ["evaluation" as const], confirm_review: false };
    await assert.rejects(() => prepareExport(f.store, input), /reviewed/);
    await assert.rejects(() => prepareExport(f.store, { ...input, confirm_review: true, event_ids: [] }), /Select/);
    await assert.rejects(() => prepareExport(f.store, { ...input, confirm_review: true, event_ids: ["missing"] }), /unavailable/);
    await assert.rejects(() => prepareExport(f.store, { ...input, confirm_review: true, edits: { missing: "text" } }), /selected/);
    await assert.rejects(() => reviewRecords(f.store, { extraction_id: extracted.extraction_id, limit: 21 }), /1–20/);
    await assert.rejects(() => reviewRecords(f.store, { extraction_id: extracted.extraction_id, text_limit: 20001 }), /20,000/);
    await assert.rejects(() => reviewRecords(f.store, { extraction_id: extracted.extraction_id, event_ids: ["missing"] }), /unavailable/);
    await assert.rejects(() => f.store.read("exports", "../../source"), /identifier/);
  } finally { await f.cleanup(); }
});

test("native Codex and OMP histories use the existing shared extractors", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-me-mcp-adapters-"));
  try {
    const codex = join(root, "codex.jsonl");
    const omp = join(root, "omp.ndjson");
    await writeFile(codex, [
      { type: "session_meta", payload: { id: "fixture", source: "cli" } },
      { type: "event_msg", payload: { type: "user_message", message: "Fictional codex request" } },
      { type: "response_item", payload: { type: "function_call_output", output: "Fictional test passed" } },
    ].map(row => JSON.stringify(row)).join("\n"));
    await writeFile(omp, [
      { type: "session", id: "fixture" },
      { type: "message", message: { role: "user", attribution: "user", content: "Fictional omp request" } },
      { type: "message", message: { role: "toolResult", toolName: "test", content: [{ type: "text", text: "Fictional result" }] } },
    ].map(row => JSON.stringify(row)).join("\n"));
    const store = new Store(join(root, "private"));
    const extracted = await extractTraces(store, [codex, omp]);
    const review = await reviewRecords(store, { extraction_id: extracted.extraction_id });
    assert.equal(review.total, 4);
    assert.deepEqual(review.records.map(record => record.role), ["user", "tool", "user", "tool"]);
    assert.equal(extracted.sources.length, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("source discovery reads metadata only and bounds file discovery", async () => {
  const f = await fixture();
  try {
    const discovered = await discoverSources([f.root, join(f.root, "missing")]);
    assert.equal(discovered.content_read, false);
    assert.equal(discovered.sources[0].files[0].path, f.source);
    assert.equal(discovered.sources[1].available, false);
    assert.doesNotMatch(JSON.stringify(discovered), /private-test-value|Selected request/);
    const external = join(f.root, "external");
    const scan = join(f.root, "scan");
    await mkdir(external); await mkdir(scan);
    await writeFile(join(external, "private.jsonl"), "not a trace");
    await symlink(external, join(scan, "external-link"));
    for (let i = 0; i < 101; i++) await writeFile(join(scan, `${i}.json`), "unread malformed content");
    const bounded = await discoverSources([scan]);
    assert.equal(bounded.sources[0].files.length, 100);
    assert.equal(bounded.sources[0].truncated, true);
    assert.ok(bounded.sources[0].files.every(file => !file.path.includes("private.jsonl")));
    await assert.rejects(() => discoverSources(["relative"]), /absolute/);
  } finally { await f.cleanup(); }
});

test("malformed, oversized and invalid input batches never leave partial extractions", async () => {
  const f = await fixture();
  try {
    const malformed = join(f.root, "malformed.jsonl");
    await writeFile(malformed, '{"type":"user","message":{"content":"valid"}}\n{invalid secret-text');
    await assert.rejects(() => extractTraces(f.store, [f.source, malformed]), /valid JSON/);
    const large = join(f.root, "large.jsonl");
    await writeFile(large, ""); await truncate(large, 25 * 1024 * 1024 + 1);
    await assert.rejects(() => extractTraces(f.store, [large]), /25 MiB/);
    await assert.rejects(() => extractTraces(f.store, []), /1–100/);
    await assert.rejects(() => extractTraces(f.store, [f.source, f.source]), /once/);
    await assert.rejects(() => extractTraces(f.store, [f.root]), /JSON/);
    await assert.rejects(() => stat(f.store.path("extractions", "not-created")), /ENOENT/);
  } finally { await f.cleanup(); }
});
