/// <reference types="node" />
import { webcrypto } from "node:crypto";
import { TextDecoder, TextEncoder } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { importTraceFiles, MAX_TRACE_FILE_BYTES, MAX_TRACE_FILES, MAX_TRACE_TOTAL_BYTES } from "./traceImport";

beforeEach(() => { vi.stubGlobal("crypto", webcrypto); vi.stubGlobal("TextEncoder", TextEncoder); vi.stubGlobal("TextDecoder", TextDecoder); });
afterEach(() => vi.unstubAllGlobals());
const file = (name: string, rows: unknown[]) => new File([rows.map(row => JSON.stringify(row)).join("\n")], name);

describe("browser-local extraction", () => {
  it("extracts Claude message/tool records with harness and subagent attribution", async () => {
    const result = await importTraceFiles([file("agent-session.jsonl", [
      { type: "user", sessionId: "session-1", message: { content: "Worker brief" } },
      { type: "user", isMeta: true, message: { content: "Injected context" } },
      { type: "assistant", message: { content: [{ type: "tool_use", name: "shell", input: { command: "npm test" } }, { type: "thinking", thinking: "Stored reasoning" }] } },
      { type: "user", message: { content: [{ type: "tool_result", content: "Observed result" }] } },
    ])]);
    expect(result.events.map(event => event.role)).toEqual(["agent", "harness", "assistant", "assistant", "tool"]);
    expect(result.events.map(event => event.kind)).toEqual(["message", "message", "tool_call", "reasoning", "tool_result"]);
    expect(result.events[2].text).toContain("npm test");
    expect(result.events[0].conversationId).not.toContain("session-1");
    expect(result.events[0].origin.line).toBe(1);
  });

  it("uses the first Codex metadata, deduplicates replayed user messages, and keeps full tool output", async () => {
    const output = "complete tool output ".repeat(1000) + "terminal-marker";
    const result = await importTraceFiles([file("rollout.jsonl", [
      { type: "session_meta", payload: { id: "first", source: { subagent: { parent: "p" } } } },
      { type: "session_meta", payload: { id: "fork-parent", source: "cli" } },
      { type: "event_msg", payload: { type: "user_message", message: "Please implement" } },
      { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Please implement" }, { type: "input_text", text: "# AGENTS.md instructions injected" }] } },
      { type: "response_item", payload: { type: "function_call_output", output } },
    ])]);
    expect(result.events).toHaveLength(3);
    expect(result.events.map(event => event.role)).toEqual(["agent", "harness", "tool"]);
    expect(result.events[2].text).toBe(output);
  });

  it("does not label unattributed OMP user projections as authenticated owner requests", async () => {
    const result = await importTraceFiles([file("omp.jsonl", [
      { type: "session", id: "omp-session" },
      { type: "message", message: { role: "user", content: "Unattributed prompt" } },
      { type: "message", message: { role: "user", attribution: "user", content: "Owner prompt" } },
      { type: "message", message: { role: "user", attribution: "agent", content: "Worker prompt" } },
      { type: "message", message: { role: "toolResult", toolName: "test", content: [{ type: "text", text: "1 passed" }] } },
      { type: "compaction", summary: "Compaction summary" },
    ])]);
    expect(result.events.map(event => event.role)).toEqual(["unknown", "user", "agent", "tool", "harness"]);
    expect(result.events[3].toolName).toBe("test");
  });

  it("omits binary attachments and redacts sensitive text before returning review state", async () => {
    const result = await importTraceFiles([file("session.jsonl", [
      { type: "user", sessionId: "c", message: { content: [{ type: "text", text: "API_KEY=do-not-export /Users/alice/project alice@example.com" }, { type: "image", source: { type: "base64", data: "SENSITIVEBINARY" } }] } },
      { type: "assistant", message: { content: [{ type: "tool_use", name: "media", input: { url: "data:audio/wav;base64,QUJDREVGR0g=" } }] } },
    ])]);
    expect(JSON.stringify(result)).not.toMatch(/do-not-export|alice|SENSITIVEBINARY|QUJDREVGR0g=/);
    expect(result.events[1].text).toBe("[attachment omitted]");
    expect(result.files[0].redactions).toBeGreaterThan(0);
    expect(result.files[0].sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("reads normalized records and agent-trace observable events without guessing ownership", async () => {
    const result = await importTraceFiles([
      file("normalized.jsonl", [{ source: "custom-agent", conversation_id: "private-id", events: [{ role: "document", kind: "message", content: "Saved artifact" }] }]),
      file("events.ndjson", [{ event_type: "user_prompt", data: { prompt: "Unattributed trace prompt" } }, { event_type: "tool_result", data: { output: "Observed tool output" } }]),
    ]);
    expect(result.events.map(event => event.source)).toEqual(["custom-agent", "agent-trace", "agent-trace"]);
    expect(result.events.map(event => event.role)).toEqual(["document", "unknown", "tool"]);
  });

  it("rejects a malformed record anywhere in a batch rather than returning a partial import", async () => {
    const valid = file("first.jsonl", [{ type: "user", message: { content: "valid" } }]);
    await expect(importTraceFiles([valid, new File(['{"secret":"NOT-FOR-ERROR"}\n{broken'], "secret-name.jsonl")])).rejects.toThrow(/valid JSON/i);
    await expect(importTraceFiles([new File([new Uint8Array([0xc3, 0x28])], "bad.jsonl")])).rejects.toThrow(/UTF-8/i);
  });

  it("reports unsupported rows and rejects files containing no supported events", async () => {
    const result = await importTraceFiles([file("session.jsonl", [{ type: "progress" }, { type: "user", message: { content: "Reviewable" } }])]);
    expect(result.files[0].skipped).toBe(1);
    expect(result.warnings.length).toBeGreaterThan(0);
    await expect(importTraceFiles([file("unknown.json", [{ not_a_trace: "not-an-event" }])])).rejects.toThrow(/supported trace/i);
    await expect(importTraceFiles([new File(["not interpreted"], "archive.tar")])).rejects.toThrow(/JSON/i);
  });

  it("bounds count and byte allocations before reading files", async () => {
    const oversized = file("large.jsonl", []);
    Object.defineProperty(oversized, "size", { value: MAX_TRACE_FILE_BYTES + 1 });
    const read = vi.spyOn(FileReader.prototype, "readAsArrayBuffer");
    await expect(importTraceFiles([oversized])).rejects.toThrow(/25 MiB/);
    expect(read).not.toHaveBeenCalled();
    await expect(importTraceFiles(Array.from({ length: MAX_TRACE_FILES + 1 }, () => file("a.jsonl", [])))).rejects.toThrow(/100 files/);
    const nearLimit = Array.from({ length: Math.ceil(MAX_TRACE_TOTAL_BYTES / MAX_TRACE_FILE_BYTES) + 1 }, () => {
      const f = file("a.jsonl", []);Object.defineProperty(f, "size", { value: MAX_TRACE_FILE_BYTES });return f;
    });
    await expect(importTraceFiles(nearLimit)).rejects.toThrow(/100 MiB/);
  });
});

it("round-trips portable selected submissions without carrying sale choices into review data", async () => {
  const { buildTracePack } = await import("./tracePack");
  const imported = await importTraceFiles([file("source.jsonl", [
    { type: "user", sessionId: "session", message: { content: "Selected request" } },
    { type: "assistant", message: { content: "Unselected response" } },
  ])]);
  const pack = await buildTracePack(imported, [imported.events[0].id], {}, { intent: "sale_offer", requestedUses: ["evaluation"], note: "Offer draft", reviewConfirmed: true });
  const reopened = await importTraceFiles([new File([JSON.stringify(pack)], "selected.trace-pack.json")]);
  expect(reopened.events.map(event => event.text)).toEqual(["Selected request"]);
  expect(reopened.files[0].sha256).toBe(imported.files[0].sha256);
  expect(reopened.files[0].name).toMatch(/^Pack source /);
  expect(reopened).not.toHaveProperty("offer");
  const changed = structuredClone(pack);changed.events[0].content = "tampered";
  await expect(importTraceFiles([new File([JSON.stringify(changed)], "changed.json")])).rejects.toThrow(/integrity/);
});

it("skips empty native blocks instead of inventing quoted empty messages", async () => {
  const result = await importTraceFiles([file("empty-blocks.jsonl", [
    { type: "user", message: { content: [{ type: "text" }, { type: "text", text: "Actual request" }] } },
  ])]);
  expect(result.events.map(event => event.text)).toEqual(["Actual request"]);
});

it("accepts a schema-tagged normalized conversation rather than mistaking it for a portable pack", async () => {
  const normalized = { schema: "hsm.ai_conversation.v1", source: "codex", conversation_id: "normalized-one", events: [{ role: "assistant", kind: "message", content: "Normalized stored text" }] };
  const result = await importTraceFiles([file("normalized.jsonl", [normalized])]);
  expect(result.events[0].text).toBe("Normalized stored text");
  expect(result.events[0].source).toBe("codex");
});

it("redacts external pack metadata only after validating its original integrity", async () => {
  const { buildTracePack, sha256 } = await import("./tracePack");
  const imported = await importTraceFiles([file("source.jsonl", [{ type: "user", message: { content: "Portable text" } }])]);
  const pack = await buildTracePack(imported, [imported.events[0].id], {}, { intent: "personal_export", requestedUses: [], note: "", reviewConfirmed: true });
  pack.events[0].id = "contact:alice@example.com";
  pack.events[0].conversation_id = "/Users/alice/private-project";
  pack.events[0].timestamp = "password=do-not-review";
  pack.events[0].tool_name = "API_KEY=do-not-review";
  function canonical(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value && typeof value === "object") {
      const row = value as Record<string, unknown>;
      return `{${Object.keys(row).sort().map(key => `${JSON.stringify(key)}:${canonical(row[key])}`).join(",")}}`;
    }
    return JSON.stringify(value);
  }
  const body = { ...pack } as Partial<typeof pack>;delete body.integrity;
  pack.integrity.sha256 = await sha256(canonical(body));
  const reviewed = await importTraceFiles([new File([JSON.stringify(pack)], "external.json")]);
  expect(JSON.stringify(reviewed)).not.toMatch(/alice|do-not-review|private-project/);
  expect(reviewed.events[0].timestamp).toBeNull();
  expect(reviewed.events[0].id).toMatch(/^event_[a-f0-9]+$/);
  expect(reviewed.events[0].conversationId).toMatch(/^conv_[a-f0-9]+$/);
  expect(reviewed.events[0].origin.fileId).toBe(imported.files[0].sha256);
});
