import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import type { RequestListener } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { Store } from "../src/storage";
import { extractTraces, prepareExport, reviewRecords } from "../src/traces";
import { submitExport, submissionStatus } from "../src/market";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "agent-me-mcp-market-"));
  const store = new Store(join(root, "private"));
  const source = join(root, "source.jsonl");
  await writeFile(source, [
    { type: "user", message: { content: "Selected fictional request" } },
    { type: "assistant", message: { content: "UNSELECTED FICTIONAL CONTENT" } },
  ].map(row => JSON.stringify(row)).join("\n"));
  const extracted = await extractTraces(store, [source]);
  const reviewed = await reviewRecords(store, { extraction_id: extracted.extraction_id });
  const exported = await prepareExport(store, { extraction_id: extracted.extraction_id, event_ids: [reviewed.records[0].id], intent: "sale_offer", requested_uses: ["evaluation"], confirm_review: true });
  return { root, store, exported, cleanup: () => rm(root, { recursive: true, force: true }) };
}
async function listen(handler: RequestListener) {
  const server = createServer(handler);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}

test("submission sends only reviewed selected records and saves a private website-compatible receipt", async () => {
  const f = await fixture();
  let observed = "";
  let token = "";
  const service = await listen(async (request, response) => {
    token = request.headers.authorization ?? "";
    if (request.method === "POST") {
      for await (const chunk of request) observed += chunk.toString();
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ submission: { id: "sub_fixture", status: "submitted", event_count: 1 } }));
    } else response.end(JSON.stringify({ id: "sub_fixture", status: "offered", current_offer: { amount_minor: 100, currency: "USD", proposed_uses: ["evaluation"] }, review_notes: [{ note: "private buyer note" }] }));
  });
  try {
    const input = { export_id: f.exported.export_id, expected_sha256: f.exported.sha256, title: "Fictional local MCP test", confirm_submission: true };
    const submitted = await submitExport(f.store, input, service.url);
    assert.equal(submitted.submission_id, "sub_fixture");
    assert.equal(submitted.status, "submitted");
    assert.match(observed, /Selected fictional request/);
    assert.doesNotMatch(observed, /UNSELECTED FICTIONAL CONTENT/);
    assert.equal(JSON.parse(observed).pack.events.length, 1);
    const receipt = JSON.parse(await readFile(submitted.path, "utf8"));
    assert.deepEqual(Object.keys(receipt).sort(), ["access_token", "schema", "submission_id"]);
    assert.equal(receipt.schema, "agent-me.submission-receipt.v1");
    assert.equal(token, `Bearer ${receipt.access_token}`);
    assert.doesNotMatch(JSON.stringify(submitted), new RegExp(receipt.access_token));
    const status = await submissionStatus(f.store, submitted.receipt_id, service.url);
    assert.equal(status.status, "offered");
    assert.doesNotMatch(JSON.stringify(status), /private buyer note|access_token/);
    await assert.rejects(() => submissionStatus(f.store, submitted.receipt_id, "http://localhost:8001"), /different review service/);
  } finally { await service.close(); await f.cleanup(); }
});

test("ambiguous delivery persists its receipt before the request and retries with the same token", async () => {
  const f = await fixture();
  const tokens: string[] = [];
  let count = 0;
  let savedBeforeRequest = false;
  const service = await listen(async (request, response) => {
    tokens.push(request.headers.authorization ?? "");
    for await (const _chunk of request) { /* consume request */ }
    const { readdir } = await import("node:fs/promises");
    const files = await readdir(join(f.store.root, "receipts"));
    savedBeforeRequest = files.length === 1;
    if (++count === 1) { response.destroy(); return; }
    response.end(JSON.stringify({ submission: { id: "sub_retry", status: "submitted" } }));
  });
  try {
    const input = { export_id: f.exported.export_id, expected_sha256: f.exported.sha256, title: "Fictional retry", confirm_submission: true };
    const first = await submitExport(f.store, input, service.url);
    assert.equal(first.status, "not_confirmed");
    assert.ok(savedBeforeRequest, "receipt exists before any network delivery");
    const pending = await submissionStatus(f.store, first.receipt_id, service.url);
    assert.equal(pending.status, "not_confirmed");
    const retried = await submitExport(f.store, { ...input, receipt_id: first.receipt_id }, service.url);
    assert.equal(retried.submission_id, "sub_retry");
    assert.equal(tokens.length, 2);
    assert.equal(tokens[0], tokens[1]);
    await assert.rejects(() => submitExport(f.store, { ...input, title: "Changed title", receipt_id: first.receipt_id }, service.url), /original submission/);
  } finally { await service.close(); await f.cleanup(); }
});

test("unconfirmed, changed, or personal exports cannot initiate a network submission", async () => {
  const f = await fixture();
  let requests = 0;
  const service = await listen((_request, response) => { requests++; response.end("{}"); });
  try {
    const input = { export_id: f.exported.export_id, expected_sha256: f.exported.sha256, title: "Fictional", confirm_submission: true };
    await assert.rejects(() => submitExport(f.store, { ...input, confirm_submission: false }, service.url), /confirm/);
    await assert.rejects(() => submitExport(f.store, { ...input, expected_sha256: "0".repeat(64) }, service.url), /checksum/);
    await assert.rejects(() => submitExport(f.store, { ...input, title: "x".repeat(121) }, service.url), /120/);
    await assert.rejects(() => submitExport(f.store, input, "http://example.com"), /HTTPS/);
    const imported = await extractTraces(f.store, [join(f.root, "source.jsonl")]);
    const reviewed = await reviewRecords(f.store, { extraction_id: imported.extraction_id });
    const personal = await prepareExport(f.store, { extraction_id: imported.extraction_id, event_ids: [reviewed.records[0].id], intent: "personal_export", confirm_review: true });
    await assert.rejects(() => submitExport(f.store, { ...input, export_id: personal.export_id, expected_sha256: personal.sha256 }, service.url), /sale-offer/);
    const pack = JSON.parse(await readFile(f.exported.path, "utf8"));
    pack.events[0].content = "Changed without integrity";
    await f.store.save("exports", f.exported.export_id, pack);
    await assert.rejects(() => submitExport(f.store, input, service.url), /integrity/);
    assert.equal(requests, 0);
  } finally { await service.close(); await f.cleanup(); }
});

test("disabled intake returns an actionable saved receipt without falsely claiming delivery", async () => {
  const f = await fixture();
  const service = await listen((_request, response) => { response.statusCode = 503; response.end("Server private text must not echo"); });
  try {
    const submitted = await submitExport(f.store, { export_id: f.exported.export_id, expected_sha256: f.exported.sha256, title: "Fictional", confirm_submission: true }, service.url);
    assert.equal(submitted.status, "not_confirmed");
    assert.ok("http_status" in submitted);
    assert.equal(submitted.http_status, 503);
    assert.match(submitted.message ?? "", /disabled/);
    assert.doesNotMatch(JSON.stringify(submitted), /Server private text/);
  } finally { await service.close(); await f.cleanup(); }
});
