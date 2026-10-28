import { webcrypto } from "node:crypto";
import { TextDecoder, TextEncoder } from "node:util";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TraceStudio } from "./TraceStudio";
import { importTraceFiles } from "./traceImport";
import type { TracePack } from "./traceTypes";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("extracts actual local files, reviews a subset, and reopens the offered pack without network access", async () => {
  vi.stubGlobal("crypto", webcrypto); vi.stubGlobal("TextEncoder", TextEncoder); vi.stubGlobal("TextDecoder", TextDecoder);
  const fetch = vi.fn(() => { throw new Error("Trace flow must stay browser-local"); });vi.stubGlobal("fetch", fetch);
  const blobs: Blob[] = [];
  vi.stubGlobal("URL", { createObjectURL: vi.fn((blob: Blob) => { blobs.push(blob);return "blob:local"; }), revokeObjectURL: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  render(<TraceStudio />);
  const rows = [
    { type: "user", sessionId: "session-fixture", message: { content: "Keep this owner request" } },
    { type: "assistant", message: { content: "EXCLUDE-THIS-RESPONSE" } },
  ];
  const hidden = [{ type: "session", id: "omp-fixture" }, { type: "message", message: { role: "user", content: "HIDDEN-OMP-REQUEST" } }];
  const jsonl = (items: unknown[]) => items.map(row => JSON.stringify(row)).join("\n");
  fireEvent.change(screen.getByLabelText("Open activity files"), { target: { files: [
    new File([jsonl(rows)], "private-claude.jsonl"), new File([jsonl(hidden)], "private-omp.jsonl"),
  ] } });
  await screen.findByText("0 selected of 3 records");
  fireEvent.click(screen.getByLabelText("Select record 1"));
  fireEvent.click(screen.getByRole("button", { name: "Review record 1" }));
  fireEvent.change(screen.getByLabelText("Reviewed record text"), { target: { value: "Reviewed owner task" } });
  fireEvent.click(screen.getByRole("button", { name: "Save reviewed text" }));
  fireEvent.click(screen.getByLabelText("Offer selected activity to Agent-Me"));
  fireEvent.click(screen.getByLabelText("Evaluation and benchmarking"));
  fireEvent.click(screen.getByLabelText("I reviewed the selected records"));
  fireEvent.click(screen.getByRole("button", { name: "Download submission draft" }));
  await screen.findByText(/Downloaded 1 record/);
  expect(blobs).toHaveLength(1);
  const packedText = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();reader.onload = () => resolve(String(reader.result));reader.onerror = reject;reader.readAsText(blobs[0]);
  });
  const pack = JSON.parse(packedText) as TracePack;
  expect(pack.selection).toEqual({ events: 1, conversations: 1, sources: { "claude-code": 1 } });
  expect(pack.events[0].content).toBe("Reviewed owner task");
  expect(pack.events[0].edited).toBe(true);
  expect(pack.offer?.submitted).toBe(false);
  expect(pack.offer?.requested_uses).toEqual(["evaluation"]);
  expect(pack.files).toHaveLength(1);
  expect(packedText).not.toMatch(/EXCLUDE-THIS|HIDDEN-OMP|private-claude|private-omp|Keep this owner/);
  const reopened = await importTraceFiles([new File([packedText], "offered.trace-pack.json")]);
  expect(reopened.events.map(event => event.text)).toEqual(["Reviewed owner task"]);
  expect(fetch).not.toHaveBeenCalled();
});
