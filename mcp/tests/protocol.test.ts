import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// Exercises every public MCP tool across a real stdio transport. Model and review
// services are local fixtures; the Python subprocess uses the actual GEPA library.
test("MCP workflow extracts a selection, estimates it, runs GEPA and saves a submission receipt", { timeout: 60000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-me-protocol-"));
  const messages: string[] = [];
  let uploaded: Record<string, any> | undefined;
  const getUploaded = () => uploaded;
  const http = createServer(async (req, res) => {
    let text = ""; for await (const part of req) text += part.toString();
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/api/chat") {
      const prompt = JSON.parse(text).messages.at(-1).content as string;
      messages.push(prompt);
      let content = "```\nCite evidence and state uncertainty.\n```";
      if (prompt.startsWith("TASK_RESPONSE\n")) content = JSON.parse(prompt.split("\n").slice(1).join("\n")).artifact.includes("Cite evidence") ? "grounded response" : "unsupported response";
      if (prompt.startsWith("JUDGE_RESPONSE\n")) content = JSON.stringify({ score: JSON.parse(prompt.split("\n").slice(1).join("\n")).answer === "grounded response" ? 0.9 : 0.2, feedback: "Cite evidence to ground the response." });
      res.end(JSON.stringify({ message: { content } }));
    } else if (req.method === "POST" && req.url === "/api/v1/trace-submissions") {
      uploaded = JSON.parse(text);
      res.end(JSON.stringify({ submission: { id: "sub_protocol", status: "submitted", event_count: uploaded?.pack.events.length } }));
    } else res.end(JSON.stringify({ id: "sub_protocol", status: "offered", current_offer: { amount_minor: 1250, currency: "CAD", proposed_uses: ["evaluation"] }, review_notes: ["PRIVATE BUYER NOTE"] }));
  });
  await new Promise<void>(resolve => http.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  const client = new Client({ name: "agent-me-protocol-test", version: "1.0.0" });
  const transport = new StdioClientTransport({ command: process.execPath, args: ["dist/server.js"], cwd: process.cwd(), stderr: "pipe", env: { ...process.env as Record<string, string>, AGENT_ME_MCP_DATA_DIR: join(root, "private"), AGENT_ME_REVIEW_URL: origin, AGENT_ME_OLLAMA_URL: origin, AGENT_ME_OPTIMIZATION_PYTHON: process.env.AGENT_ME_OPTIMIZATION_PYTHON ?? "python3" } });
  let stderr = ""; transport.stderr?.on("data", chunk => { stderr += chunk.toString(); });
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const response = await client.callTool({ name, arguments: args });
    assert.notEqual(response.isError, true, `${name}: ${JSON.stringify(response.content)}`);
    return response.structuredContent as Record<string, any>;
  };
  try {
    const source = join(root, "fixture.jsonl");
    const rows: unknown[] = [];
    for (let c = 0; c < 3; c++) rows.push({ source: "fixture", conversation_id: `conv-${c}`, events: Array.from({ length: 2 }, (_, t) => [
      { role: "user", text: `Fictional task ${c}-${t}: verify the release.` },
      { role: "tool", text: `Fictional result ${c}-${t}: passing checks.`, tool_name: "fixture_check" },
      { role: "assistant", text: `Fictional answer ${c}-${t}.` },
    ]).flat() });
    rows.push({ source: "fixture", conversation_id: "excluded", events: [{ role: "user", text: "UNSELECTED_PROTOCOL_MARKER" }] });
    await writeFile(source, rows.map(row => JSON.stringify(row)).join("\n"));
    await client.connect(transport);
    assert.equal((await client.listTools()).tools.length, 10);
    const status = await call("get_agent_me_status");
    assert.equal(status.optimization.available, true, "Protocol integration requires backend[optimize] and AGENT_ME_OPTIMIZATION_PYTHON.");
    const discovery = await call("discover_trace_sources", { roots: [root] });
    assert.equal(discovery.content_read, false);
    const extraction = await call("extract_traces", { paths: [source] });
    assert.equal(extraction.events, 19);
    const review = await call("review_trace_records", { extraction_id: extraction.extraction_id });
    const ids = review.records.filter((record: any) => !record.text.includes("UNSELECTED_PROTOCOL_MARKER")).map((record: any) => record.id);
    await call("review_trace_records", { extraction_id: extraction.extraction_id, event_ids: ids, text_limit: 20000 });
    const noConsent = await client.callTool({ name: "prepare_trace_export", arguments: { extraction_id: extraction.extraction_id, event_ids: ids, intent: "sale_offer", requested_uses: ["evaluation"], confirm_review: false } });
    assert.equal(noConsent.isError, true);
    const exported = await call("prepare_trace_export", { extraction_id: extraction.extraction_id, event_ids: ids, intent: "sale_offer", requested_uses: ["evaluation"], confirm_review: true });
    assert.equal(exported.selection.events, 18);
    const value = await call("estimate_trace_value", { export_id: exported.export_id });
    assert.equal(value.counts.eligible_unique_conversations, 3);
    assert.deepEqual(value.conditional_contributor_estimate_minor, { min: 75, max: 600 });
    assert.equal(value.not_an_offer, true);
    const startArgs = { export_id: exported.export_id, seed: "Be helpful.", objective: "Ground answers in selected evidence.", model: "fixture-model", max_metric_calls: 12 };
    const concurrent = await Promise.all([client.callTool({ name: "start_optimization", arguments: startArgs }), client.callTool({ name: "start_optimization", arguments: startArgs })]);
    assert.equal(concurrent.filter(response => response.isError).length, 1, "Parallel tool calls must not start competing local-model jobs.");
    const job = concurrent.find(response => !response.isError)!.structuredContent as Record<string, any>;
    let completed: Record<string, any> = {};
    for (let attempt = 0; attempt < 3; attempt++) { completed = await call("get_optimization", { job_id: job.job_id, wait_seconds: 20 }); if (completed.status !== "running") break; }
    assert.equal(completed.status, "completed", JSON.stringify(completed));
    assert.equal(completed.result.best_artifact, "Cite evidence and state uncertainty.");
    assert.equal(completed.promotion_performed, false);
    assert.ok(messages.length > 0);
    assert.ok(messages.every(prompt => !prompt.includes("UNSELECTED_PROTOCOL_MARKER")));
    const noUpload = await client.callTool({ name: "submit_trace_export", arguments: { export_id: exported.export_id, expected_sha256: exported.sha256, title: "Fictional MCP test", confirm_submission: false } });
    assert.equal(noUpload.isError, true);
    assert.equal(uploaded, undefined);
    const submitted = await call("submit_trace_export", { export_id: exported.export_id, expected_sha256: exported.sha256, title: "Fictional MCP test", confirm_submission: true });
    assert.equal(submitted.status, "submitted");
    assert.equal(getUploaded()?.pack.events.length, 18);
    assert.doesNotMatch(JSON.stringify(uploaded), /UNSELECTED_PROTOCOL_MARKER/);
    const receipt = JSON.parse(await readFile(submitted.path, "utf8"));
    assert.equal(receipt.schema, "agent-me.submission-receipt.v1");
    assert.doesNotMatch(JSON.stringify(submitted), new RegExp(receipt.access_token));
    const offer = await call("get_submission_status", { receipt_id: submitted.receipt_id });
    assert.equal(offer.submission.current_offer.amount_minor, 1250);
    assert.doesNotMatch(JSON.stringify(offer), /PRIVATE BUYER NOTE|access_token/);
    const workflow = await client.readResource({ uri: "agent-me://workflow" });
    assert.ok(workflow.contents.length);
    assert.equal(await readFile(source, "utf8"), rows.map(row => JSON.stringify(row)).join("\n"));
  } finally {
    await client.close();
    await new Promise<void>((resolve, reject) => http.close(error => error ? reject(error) : resolve()));
    await rm(root, { recursive: true, force: true });
  }
  assert.equal(stderr, "", "MCP subprocess should not leak history or library output.");
});
