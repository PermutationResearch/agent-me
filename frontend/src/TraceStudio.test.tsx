import { webcrypto } from "node:crypto";
import { TextEncoder } from "node:util";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TraceStudio } from "./TraceStudio";
import { App } from "./App";
import * as packExport from "./tracePack";
import type { TracePack, TraceImportResult } from "./traceTypes";

const { importFiles } = vi.hoisted(() => ({ importFiles: vi.fn() }));
vi.mock("./traceImport", () => ({ importTraceFiles: importFiles, MAX_TRACE_FILE_BYTES: 25 * 1024 * 1024, MAX_TRACE_TOTAL_BYTES: 100 * 1024 * 1024, MAX_TRACE_FILES: 100 }));

vi.mock("./SubmissionForm", () => ({ SubmissionForm: ({ pack }: { pack: TracePack }) => <section aria-label="Selected activity submission preview">{pack.events.map(event => <p key={event.id}>{event.content}</p>)}</section> }));

const a = "a".repeat(64), b = "b".repeat(64);
const example: TraceImportResult = {
  files: [
    { id: a, sha256: a, name: "claude.jsonl", bytes: 200, format: "claude-code", events: 2, skipped: 1, redactions: 1, warnings: ["One attachment was omitted."] },
    { id: b, sha256: b, name: "codex.jsonl", bytes: 200, format: "codex", events: 1, skipped: 0, redactions: 0, warnings: [] },
  ],
  events: [
    { id: "e1", source: "claude-code", conversationId: "c1", role: "user", kind: "message", text: "Keep this release question.", timestamp: null, toolName: null, origin: { fileId: a, line: 1, item: 0 }, redactions: 0, edited: false },
    { id: "e2", source: "claude-code", conversationId: "c1", role: "assistant", kind: "message", text: "Exclude this private answer.", timestamp: null, toolName: null, origin: { fileId: a, line: 2, item: 0 }, redactions: 0, edited: false },
    { id: "e3", source: "codex", conversationId: "c2", role: "tool", kind: "tool_result", text: "Exclude other source contents.", timestamp: null, toolName: "shell", origin: { fileId: b, line: 1, item: 0 }, redactions: 0, edited: false },
  ], warnings: [],
};
let blobs: Blob[];
let network: ReturnType<typeof vi.fn>;
beforeEach(() => {
  window.history.replaceState(null, "", "/");
  importFiles.mockReset(); importFiles.mockResolvedValue(example);
  vi.stubGlobal("crypto", webcrypto); vi.stubGlobal("TextEncoder", TextEncoder);
  blobs = [];
  vi.stubGlobal("URL", { createObjectURL: vi.fn((blob: Blob) => { blobs.push(blob); return "blob:local"; }), revokeObjectURL: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  network = vi.fn(() => { throw new Error("Trace review must stay local"); });
  vi.stubGlobal("fetch", network);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); window.history.replaceState(null, "", "/"); });

async function open() {
  fireEvent.change(screen.getByLabelText("Open activity files"), { target: { files: [new File(["fixture"], "trace.jsonl")] } });
  await screen.findByText("0 selected of 3 records");
}
async function decoded(blob: Blob) {
  return JSON.parse(await new Promise<string>((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsText(blob);
  }));
}

it("opens a local trace review flow with no account or mounted archive", () => {
  render(<TraceStudio />);
  expect(screen.getByRole("heading", { name: "Your activity" })).toBeInTheDocument();
  expect(screen.getByLabelText("Open activity files")).toHaveAttribute("multiple");
  expect(screen.getByText("Processed in this browser. Your files stay here.")).toBeInTheDocument();
  expect(network).not.toHaveBeenCalled();
});

it("exports only an edited selected subset as a draft offer without transmitting traces", async () => {
  render(<TraceStudio />); await open();
  expect(screen.getByRole("button", { name: "Download personal export" })).toBeDisabled();
  fireEvent.click(screen.getByLabelText("Select record 1"));
  fireEvent.click(screen.getByRole("button", { name: "Review record 1" }));
  fireEvent.change(screen.getByLabelText("Reviewed record text"), { target: { value: "Reviewed release question." } });
  expect(screen.getByLabelText("I reviewed the selected records")).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Save reviewed text" }));
  fireEvent.click(screen.getByLabelText("Offer selected activity to Agent-Me"));
  fireEvent.click(screen.getByLabelText("Prompt and stack optimization"));
  fireEvent.click(screen.getByText("Add note for review"));
  fireEvent.change(screen.getByLabelText("Note for review (optional)"), { target: { value: "Release examples only." } });
  fireEvent.click(screen.getByLabelText("I reviewed the selected records"));
  fireEvent.click(screen.getByRole("button", { name: "Download submission draft" }));
  await screen.findByText(/Downloaded 1 record as an offer draft/);
  expect(blobs).toHaveLength(1);
  const pack = await decoded(blobs[0]);
  expect(pack.events.map((event: { content: string }) => event.content)).toEqual(["Reviewed release question."]);
  expect(pack.events[0].edited).toBe(true);
  expect(pack.files).toEqual([{ sha256: a, format: "claude-code", selected_events: 1 }]);
  expect(pack.offer).toMatchObject({ status: "draft", submitted: false, requested_uses: ["stack_optimization"], note: "Release examples only." });
  expect(JSON.stringify(pack)).not.toContain("private answer");
  expect(JSON.stringify(pack)).not.toContain("other source contents");
  expect(network).not.toHaveBeenCalled();
});

it("keeps a personal export separate from an offer and invalidates review when selection changes", async () => {
  render(<TraceStudio />); await open();
  fireEvent.click(screen.getByLabelText("Select record 1"));
  fireEvent.click(screen.getByLabelText("I reviewed the selected records"));
  fireEvent.click(screen.getByLabelText("Select record 2"));
  expect(screen.getByLabelText("I reviewed the selected records")).not.toBeChecked();
  fireEvent.click(screen.getByLabelText("Select record 2"));
  fireEvent.click(screen.getByLabelText("I reviewed the selected records"));
  fireEvent.click(screen.getByRole("button", { name: "Download personal export" }));
  await screen.findByText(/Downloaded 1 record as a personal copy/);
  expect((await decoded(blobs[0])).offer).toBeNull();
});

it("selects only the visible filtered page and resets all review data on clear", async () => {
  render(<TraceStudio />); await open();
  fireEvent.change(screen.getByLabelText("Source"), { target: { value: "codex" } });
  fireEvent.click(screen.getByRole("button", { name: "Select this page" }));
  expect(screen.getByText("1 selected of 3 records")).toBeInTheDocument();
  expect(screen.getByLabelText("Select record 3")).toBeChecked();
  fireEvent.change(screen.getByLabelText("Source"), { target: { value: "" } });
  expect(screen.getByLabelText("Select record 1")).not.toBeChecked();
  expect(screen.getByLabelText("Select record 2")).not.toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "Clear reviewed activity" }));
  expect(screen.queryByLabelText("Select record 3")).not.toBeInTheDocument();
  expect(screen.queryByText(/Exclude other source contents/)).not.toBeInTheDocument();
  await open();
  expect(screen.getByLabelText("Personal export")).toBeChecked();
  expect(screen.getByLabelText("Select record 3")).not.toBeChecked();
});

it("preserves the current review when a new import fails", async () => {
  render(<TraceStudio />); await open();
  fireEvent.click(screen.getByLabelText("Select record 1"));
  importFiles.mockRejectedValueOnce(new Error("Malformed JSON line; no files were imported."));
  fireEvent.change(screen.getByLabelText("Open activity files"), { target: { files: [new File(["bad"], "new.jsonl")] } });
  expect(await screen.findByRole("alert")).toHaveTextContent("Malformed JSON line");
  expect(screen.getByText("1 selected of 3 records")).toBeInTheDocument();
  expect(screen.getByLabelText("Select record 1")).toBeChecked();
});

it("does not restore imported content after clear cancels a pending read", async () => {
  let finish!: (data: TraceImportResult) => void;
  importFiles.mockReturnValueOnce(new Promise<TraceImportResult>(resolve => { finish = resolve; }));
  render(<TraceStudio />);
  fireEvent.change(screen.getByLabelText("Open activity files"), { target: { files: [new File(["fixture"], "trace.jsonl")] } });
  expect(screen.getByRole("status")).toHaveTextContent("Reading and redacting");
  fireEvent.click(screen.getByRole("button", { name: "Clear reviewed activity" }));
  await act(async () => { finish(example); });
  expect(screen.queryByText("0 selected of 3 records")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Select record 1")).not.toBeInTheDocument();
});

it("serves the public trace route without loading profile or private APIs", async () => {
  window.history.replaceState(null, "", "/traces");
  render(<App />);
  expect(screen.getByRole("heading", { name: "Your activity" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Reviewer access ↗" })).toHaveAttribute("href", "/buyer");
  await waitFor(() => expect(network).not.toHaveBeenCalled());
});


it("does not download private content when the page closes during pack creation", async () => {
  const completed = await packExport.buildTracePack(example, ["e1"], {}, {
    intent: "personal_export", requestedUses: [], note: "", reviewConfirmed: true,
  });
  let finish!: (pack: typeof completed) => void;
  vi.spyOn(packExport, "buildTracePack").mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const { unmount } = render(<TraceStudio />); await open();
  fireEvent.click(screen.getByLabelText("Select record 1"));
  fireEvent.click(screen.getByLabelText("I reviewed the selected records"));
  fireEvent.click(screen.getByRole("button", { name: "Download personal export" }));
  expect(screen.getByRole("button", { name: "Preparing your export…" })).toBeDisabled();
  unmount();
  await act(async () => { finish(completed); });
  expect(URL.createObjectURL).not.toHaveBeenCalled();
  expect(blobs).toHaveLength(0);
});


it("lets people inspect selected and excluded records before export", async () => {
  render(<TraceStudio />); await open();
  fireEvent.click(screen.getByLabelText("Select record 1"));
  fireEvent.change(screen.getByLabelText("Record visibility"), { target: { value: "selected" } });
  expect(screen.getByLabelText("Select record 1")).toBeInTheDocument();
  expect(screen.queryByLabelText("Select record 2")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Record visibility"), { target: { value: "excluded" } });
  expect(screen.queryByLabelText("Select record 1")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Select record 2")).toBeInTheDocument();
  expect(screen.getByLabelText("Select record 3")).toBeInTheDocument();
});

it("loads a clearly marked fictional sample through the same local importer", async () => {
  render(<TraceStudio />);
  fireEvent.click(screen.getByRole("button", { name: "Try sample data" }));
  await screen.findByText("0 selected of 3 records");
  expect(screen.getByText("Sample data")).toBeInTheDocument();
  expect(screen.getByLabelText("Select record 1")).not.toBeChecked();
  expect(importFiles).toHaveBeenCalledTimes(1);
  const files = importFiles.mock.calls[0][0] as File[];
  expect(files[0].name).toBe("agent-me-fictional-sample.jsonl");
  const text = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsText(files[0]);
  });
  expect(text).toContain("Fictional example");
  expect(network).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Clear reviewed activity" }));
  expect(screen.queryByText("Sample data")).not.toBeInTheDocument();
});

it("sets a trace-specific document title and restores the surrounding page on unmount", () => {
  document.title = "Previous page";
  const { unmount } = render(<TraceStudio />);
  expect(document.title).toBe("Activity review | Agent-Me");
  expect(document.body).toHaveClass("trace-studio-page");
  expect(screen.getByRole("link", { name: "Skip to activity review" })).toHaveAttribute("href", "#trace-main");
  unmount();
  expect(document.title).toBe("Previous page");
  expect(document.body).not.toHaveClass("trace-studio-page");
});

it("opens a selected-only submission preview after review without sending data", async () => {
  render(<TraceStudio />); await open();
  fireEvent.click(screen.getByLabelText("Offer selected activity to Agent-Me"));
  expect(screen.getByRole("button", { name: "Continue to submission" })).toBeDisabled();
  fireEvent.click(screen.getByLabelText("Select record 1"));
  fireEvent.click(screen.getByLabelText("Evaluation and benchmarking"));
  fireEvent.click(screen.getByLabelText("I reviewed the selected records"));
  fireEvent.click(screen.getByRole("button", { name: "Continue to submission" }));
  const preview = await screen.findByRole("region", { name: "Selected activity submission preview" });
  expect(preview).toHaveTextContent("Keep this release question.");
  expect(preview).not.toHaveTextContent("Exclude this private answer.");
  expect(network).not.toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText("Select record 2"));
  expect(screen.queryByRole("region", { name: "Selected activity submission preview" })).not.toBeInTheDocument();
});
