import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { OptimizationPanel } from "./OptimizationPanel";

const ready = { available: true, dependency_available: true, archive_verified: true, archive_sources: ["codex", "omp"], archive_events: 1320000, provider: "ollama", model: "qwen2.5:7b", reason: null };
const dataset = { id: "dataset-one", query: "release verification", archive_sha256: "a".repeat(64), source_counts: { codex: 4, omp: 2 }, total_examples: 6, splits: { train: [{ id: "one", conversation_id: "c1", source: "codex", question: "Verify the release", question_origin: "owner", context: [] }, { id: "two" }, { id: "three" }, { id: "four" }], validation: [{ id: "five" }], test: [{ id: "six" }] } };
const complete = { id: "run-one", status: "completed", name: "Release checker", artifact_type: "skill", objective: "Check evidence before claims", seed: "Check releases.", created_at: "2026-10-25T00:00:00Z", updated_at: "2026-10-25T00:01:00Z", progress: { evaluations: 8, model_calls: 20 }, result: { best_artifact: "Check releases with recorded evidence.", baseline_test_score: 0.4, candidate_test_score: 0.8, validation_score: 0.7, improved: true, scoring: "model_judge", recommendation: "Review candidate before applying.", model_calls: 20, metric_calls: 8 } };

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function fillForm() {
  fireEvent.change(screen.getByLabelText("Run name"), { target: { value: "Release checker" } });
  fireEvent.change(screen.getByLabelText("Artifact type"), { target: { value: "skill" } });
  fireEvent.change(screen.getByLabelText("Original prompt or skill"), { target: { value: "Check releases." } });
  fireEvent.change(screen.getByLabelText("Improvement objective"), { target: { value: "Check evidence before claims" } });
  fireEvent.change(screen.getByLabelText("Find archive examples"), { target: { value: "release verification" } });
  fireEvent.change(screen.getByLabelText("Example limit"), { target: { value: "6" } });
  fireEvent.change(screen.getByLabelText("Evaluation budget"), { target: { value: "8" } });
}

it("prepares archive splits and starts an explicit GEPA run with the edited artifact", async () => {
  const request = vi.fn(async (path: string) => path.endsWith("/status") ? ready : path.endsWith("/datasets") ? dataset : path === "/optimization/runs" && request.mock.calls.length > 2 ? complete : []);
  render(<OptimizationPanel request={request} />);
  await screen.findByText(/qwen2.5:7b/);
  expect(request.mock.calls).toEqual([["/optimization/status"], ["/optimization/runs"]]);
  fillForm();
  fireEvent.click(screen.getByRole("button", { name: "Prepare examples" }));
  await screen.findByText(/4 training/);
  expect(request).toHaveBeenCalledWith("/optimization/datasets", { query: "release verification", example_limit: 6 });
  expect(screen.getByText(/1 validation/)).toBeInTheDocument();
  expect(screen.getByText(/1 held-out test/)).toBeInTheDocument();
  expect(screen.getByText(/untrusted historical evidence/i)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Run GEPA" }));
  await screen.findByText("Check releases with recorded evidence.");
  expect(request).toHaveBeenCalledWith("/optimization/runs", { dataset_id: "dataset-one", name: "Release checker", artifact_type: "skill", seed: "Check releases.", objective: "Check evidence before claims", max_metric_calls: 8 });
  expect(screen.getByText(/Baseline: 0.400/)).toBeInTheDocument();
  expect(screen.getByText(/Candidate: 0.800/)).toBeInTheDocument();
  expect(screen.getByText(/Model-judged scores/)).toBeInTheDocument();
});

it("blocks preparation while the complete archive is not ready", async () => {
  const request = vi.fn(async (path: string) => path.endsWith("/status") ? { ...ready, available: false, archive_verified: false, reason: "The verified work archive is not connected yet." } : []);
  render(<OptimizationPanel request={request} />);
  expect(await screen.findByText("The verified work archive is not connected yet.")).toBeInTheDocument();
  fillForm();
  expect(screen.getByRole("button", { name: "Prepare examples" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Run GEPA" })).toBeDisabled();
  expect(request).toHaveBeenCalledTimes(2);
});

it("invalidates prepared examples when their query changes", async () => {
  const request = vi.fn(async (path: string) => path.endsWith("/status") ? ready : path.endsWith("/datasets") ? dataset : []);
  render(<OptimizationPanel request={request} />);
  await screen.findByText(/qwen2.5:7b/);
  fillForm();
  fireEvent.click(screen.getByRole("button", { name: "Prepare examples" }));
  await screen.findByText(/4 training/);
  expect(screen.getByRole("button", { name: "Run GEPA" })).toBeEnabled();
  fireEvent.change(screen.getByLabelText("Find archive examples"), { target: { value: "other work" } });
  expect(screen.getByRole("button", { name: "Run GEPA" })).toBeDisabled();
  expect(screen.queryByText(/4 training/)).not.toBeInTheDocument();
});

it("exports the candidate and run receipt without applying files", async () => {
  const blobs: Blob[] = [];
  vi.stubGlobal("URL", { createObjectURL: vi.fn((blob: Blob) => { blobs.push(blob); return "blob:local"; }), revokeObjectURL: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  const request = vi.fn(async (path: string) => path.endsWith("/status") ? ready : [complete]);
  render(<OptimizationPanel request={request} />);
  await screen.findByText("Check releases with recorded evidence.");
  fireEvent.click(screen.getByRole("button", { name: "Download candidate" }));
  fireEvent.click(screen.getByRole("button", { name: "Download receipt" }));
  expect(blobs).toHaveLength(2);
  expect(blobs[0].type).toBe("text/markdown;charset=utf-8");
  expect(blobs[1].type).toBe("application/json");
  const contents = await Promise.all(blobs.map(blob => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsText(blob);
  })));
  expect(contents[0]).toBe(complete.result.best_artifact);
  expect(JSON.parse(contents[1]).id).toBe(complete.id);
  expect(request).toHaveBeenCalledTimes(2);
  expect(screen.getByText(/Original files stay unchanged/)).toBeInTheDocument();
});

it("shows authentication errors without discarding the artifact draft", async () => {
  const request = vi.fn(async (path: string) => {
    if (path.endsWith("/status")) return ready;
    if (path.endsWith("/datasets")) throw new Error("Private workspace token required");
    return [];
  });
  render(<OptimizationPanel request={request} />);
  await screen.findByText(/qwen2.5:7b/);
  fillForm();
  fireEvent.click(screen.getByRole("button", { name: "Prepare examples" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Private workspace token required");
  expect(screen.getByLabelText("Original prompt or skill")).toHaveValue("Check releases.");
});

it("stops polling when the private panel is unmounted", async () => {
  vi.useFakeTimers();
  const running = { ...complete, status: "running", result: undefined };
  const request = vi.fn(async (path: string) => path.endsWith("/status") ? ready : path === "/optimization/runs" ? [running] : running);
  const { unmount } = render(<OptimizationPanel request={request} />);
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(request).toHaveBeenCalledWith("/optimization/runs/run-one");
  unmount();
  const count = request.mock.calls.length;
  await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
  expect(request).toHaveBeenCalledTimes(count);
});

it("raises the budget to the prepared split minimum and blocks a lower edited value", async () => {
  const request = vi.fn(async (path: string) => path.endsWith("/status") ? ready : path.endsWith("/datasets") ? { ...dataset, minimum_metric_calls: 30 } : []);
  render(<OptimizationPanel request={request} />);
  await screen.findByText(/qwen2.5:7b/);
  fillForm();
  expect(screen.getByLabelText("Evaluation budget")).toHaveValue(8);
  fireEvent.click(screen.getByRole("button", { name: "Prepare examples" }));
  await screen.findByText(/4 training/);
  expect(screen.getByLabelText("Evaluation budget")).toHaveValue(30);
  expect(screen.getByLabelText("Evaluation budget")).toHaveAttribute("min", "30");
  expect(screen.getByText("Minimum for these splits: 30 evaluations.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Run GEPA" })).toBeEnabled();
  fireEvent.change(screen.getByLabelText("Evaluation budget"), { target: { value: "8" } });
  expect(screen.getByRole("button", { name: "Run GEPA" })).toBeDisabled();
});


it("labels legacy seed-only results as original retained instead of a copied candidate comparison", async () => {
  const retained = { ...complete, result: { ...complete.result, best_artifact: complete.seed, baseline_test_score: 0.75, candidate_test_score: 0.75, improved: false } };
  const request = vi.fn(async (path: string) => path.endsWith("/status") ? ready : [retained]);
  render(<OptimizationPanel request={request} />);
  expect(await screen.findByText("Original retained")).toBeInTheDocument();
  expect(screen.getByText("Baseline: 0.750")).toBeInTheDocument();
  expect(screen.queryByText("Candidate: 0.750")).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Candidate for review" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Download candidate" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Download retained artifact" })).toBeInTheDocument();
});

it("shows proposal decisions and limited held-out evidence for a retained original", async () => {
  const retained = { ...complete, result: { ...complete.result, best_artifact: complete.seed, baseline_test_score: 0.75, candidate_test_score: null, comparison_status: "original_retained", improved: false, search_summary: { proposal_budget: 3, proposal_attempts: 3, proposals_generated: 2, accepted: 0, rejected: 2, skipped: 1, retained_candidates: 1 }, evaluation_summary: { train_examples: 3, validation_examples: 2, test_examples: 1, model_calls: 30, actual_search_evaluations: 12 } } };
  const request = vi.fn(async (path: string) => path.endsWith("/status") ? ready : [retained]);
  render(<OptimizationPanel request={request} />);
  expect(await screen.findByText("Original retained")).toBeInTheDocument();
  expect(screen.getByText(/Search: 3 attempts · 2 proposals · 0 accepted rewrites · 2 rejected · 1 skipped/)).toBeInTheDocument();
  expect(screen.getByText(/Proposal budget: 3/)).toBeInTheDocument();
  expect(screen.getByText(/Evaluation set: 3 training · 2 validation · 1 held-out task/)).toBeInTheDocument();
  expect(screen.getByText(/Only 1 held-out task was evaluated/)).toBeInTheDocument();
  expect(screen.queryByText(/Candidate: /)).not.toBeInTheDocument();
});

it("keeps a measured distinct candidate visible when its held-out score ties the baseline", async () => {
  const tied = { ...complete, result: { ...complete.result, baseline_test_score: 0.75, candidate_test_score: 0.75, comparison_status: "distinct_candidate_tested", improved: false } };
  const request = vi.fn(async (path: string) => path.endsWith("/status") ? ready : [tied]);
  render(<OptimizationPanel request={request} />);
  expect(await screen.findByText("Candidate: 0.750")).toBeInTheDocument();
  expect(screen.getByText("Baseline: 0.750")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Candidate for review" })).toBeInTheDocument();
  expect(screen.queryByText("Original retained")).not.toBeInTheDocument();
});

it("renders an unevaluated distinct candidate without formatting a null score", async () => {
  const unmeasured = { ...complete, result: { ...complete.result, candidate_test_score: null, comparison_status: "distinct_candidate_tested", improved: false } };
  const request = vi.fn(async (path: string) => path.endsWith("/status") ? ready : [unmeasured]);
  render(<OptimizationPanel request={request} />);
  expect(await screen.findByText("Candidate not evaluated")).toBeInTheDocument();
  expect(screen.getByText("Baseline: 0.400")).toBeInTheDocument();
  expect(screen.queryByText(/Candidate: /)).not.toBeInTheDocument();
});
