import { webcrypto } from "node:crypto";
import { TextEncoder } from "node:util";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { buildTracePack, parseTracePack, sha256 } from "./tracePack";
import type { TraceImportResult, TracePackOptions } from "./traceTypes";

beforeEach(() => { vi.stubGlobal("crypto", webcrypto); vi.stubGlobal("TextEncoder", TextEncoder); });
afterEach(() => { vi.unstubAllGlobals(); });
const first = "a".repeat(64), second = "b".repeat(64);
const options: TracePackOptions = { intent: "personal_export", requestedUses: [], note: "", reviewConfirmed: true };
function imported(): TraceImportResult {
  return {
    files: [first, second].map((sha256, i) => ({ id: sha256, name: `private-source-${i}.jsonl`, sha256, bytes: 100,
      format: "codex", events: 1, skipped: 0, redactions: 0, warnings: [] })),
    events: [first, second].map((fileId, i) => ({ id: `evt_${i}`, source: "codex", conversationId: `conv_${i}`,
      kind: "message", role: "user", timestamp: null, toolName: null, text: i ? "UNSELECTED-PRIVATE-CONTENT" : "Selected trace text",
      origin: { fileId, line: i + 1, item: 0 }, redactions: 0, edited: false })), warnings: [],
  };
}

it("exports only selected content and the selected sources without filenames", async () => {
  const pack = await buildTracePack(imported(), ["evt_0"], {}, options);
  expect(pack.schema).toBe("agent-me.trace-pack.v1");
  expect(pack.selection.events).toBe(1);
  expect(pack.events.map(e => e.content)).toEqual(["Selected trace text"]);
  expect(pack.files).toEqual([{ sha256: first, format: "codex", selected_events: 1 }]);
  expect(JSON.stringify(pack)).not.toMatch(/UNSELECTED|private-source|bbbbbbbb/);
  expect(pack.events[0].trust).toBe("untrusted_trace");
  expect(pack.events[0].instruction_authority).toBe("none");
  expect(pack.offer).toBeNull();
});

it("exports reviewed edits with fresh redaction and hashes without altering the import", async () => {
  const data = imported();
  const credential = ["sk", "x".repeat(28)].join("-");
  const pack = await buildTracePack(data, ["evt_0"], { evt_0: `Reviewed version ${credential}` }, options);
  expect(pack.events[0].content).toContain("Reviewed version");
  expect(pack.events[0].content).not.toContain(credential);
  expect(pack.events[0].content_sha256).toBe(await sha256(pack.events[0].content));
  expect(pack.events[0].edited).toBe(true);
  expect(data.events[0].text).toBe("Selected trace text");
});

it("records a draft offer with use preferences rather than a submitted or completed sale", async () => {
  const pack = await buildTracePack(imported(), ["evt_0"], {}, { ...options, intent: "sale_offer",
    requestedUses: ["stack_optimization", "evaluation"], note: "Offer note" });
  expect(pack.offer).toEqual({ recipient: "Agent-Me", status: "draft", submitted: false,
    requested_uses: ["stack_optimization", "evaluation"], note: "Offer note" });
});

it("requires selected records and completed review before exporting", async () => {
  await expect(buildTracePack(imported(), [], {}, options)).rejects.toThrow(/select/i);
  await expect(buildTracePack(imported(), ["evt_0"], {}, { ...options, reviewConfirmed: false })).rejects.toThrow(/review/i);
  await expect(buildTracePack(imported(), ["unknown"], {}, options)).rejects.toThrow(/selection/i);
  await expect(buildTracePack(imported(), ["evt_0"], {}, { ...options, intent: "sale_offer" })).rejects.toThrow(/use/i);
});

it("rejects blank edits and mismatched provenance instead of silently changing the pack", async () => {
  await expect(buildTracePack(imported(), ["evt_0"], { evt_0: " " }, options)).rejects.toThrow(/empty/i);
  const data = imported();data.files = [];
  await expect(buildTracePack(data, ["evt_0"], {}, options)).rejects.toThrow(/source/i);
});

it("round-trips a portable pack while detecting tampered content or intent", async () => {
  const pack = await buildTracePack(imported(), ["evt_0"], {}, options);
  expect(await parseTracePack(JSON.parse(JSON.stringify(pack)))).toEqual(pack);
  const changed = JSON.parse(JSON.stringify(pack));changed.events[0].content = "Changed after review";
  await expect(parseTracePack(changed)).rejects.toThrow(/integrity|hash/i);
  const changedIntent = JSON.parse(JSON.stringify(pack));changedIntent.intent = "sale_offer";
  await expect(parseTracePack(changedIntent)).rejects.toThrow();
});

it("rejects unsupported versions and hidden fields rather than importing unchecked metadata", async () => {
  await expect(parseTracePack({ schema: "unrecognized" })).rejects.toThrow(/export|version/i);
  const pack = await buildTracePack(imported(), ["evt_0"], {}, options);
  await expect(parseTracePack({ ...pack, private_originals: "HIDDEN" })).rejects.toThrow(/field|pack/i);
});

it("keeps exported packs within the per-file reimport limit", async () => {
  const data = imported();
  const content = "x".repeat(1_900_000);
  data.events = Array.from({ length: 14 }, (_, index) => ({ ...data.events[0], id: `large-${index}`, text: content,
    origin: { ...data.events[0].origin, line: index + 1 } }));
  let rejectedForSize = false;
  try { await buildTracePack(data, data.events.map(event => event.id), {}, options); }
  catch (error) { rejectedForSize = error instanceof Error && error.message.includes("25 MiB"); }
  expect(rejectedForSize, "Oversized exports must remain reopenable within the file limit").toBe(true);
});
