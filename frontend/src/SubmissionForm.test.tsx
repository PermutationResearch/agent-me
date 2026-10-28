import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SubmissionForm } from "./SubmissionForm";
import { SubmissionReceipt } from "./SubmissionReceipt";
import type { SubmissionDetail } from "./marketApi";
import type { TracePack } from "./traceTypes";

const api = vi.hoisted(() => ({
  marketStatus: vi.fn(), submitPack: vi.fn(), createReceiptCode: vi.fn(), getSubmission: vi.fn(),
  respondToOffer: vi.fn(), withdrawSubmission: vi.fn(), getSubmissionPack: vi.fn(),
}));
vi.mock("./marketApi", () => api);
const pack: TracePack = {
  schema: "agent-me.trace-pack.v1", id: "pack-1", created_at: "2026-10-25T12:00:00Z", intent: "sale_offer",
  selection: { events: 1, conversations: 1, sources: { codex: 1 } },
  offer: { recipient: "Agent-Me", status: "draft", submitted: false, requested_uses: ["evaluation"], note: "My reviewed examples" },
  privacy: { automatic_redaction: true, manual_review_confirmed: true, attachments_included: false },
  files: [{ sha256: "f".repeat(64), format: "codex", selected_events: 1 }],
  integrity: { algorithm: "sha256", sha256: "a".repeat(64) },
  events: [{ id: "selected-1", content: "Only this selected record", source: "codex", conversation_id: "c1", role: "user", kind: "message", timestamp: null, tool_name: null,
    origin: { file_sha256: "f".repeat(64), line: 1, item: 0 }, content_sha256: "d".repeat(64), edited: false, trust: "untrusted_trace", instruction_authority: "none" }],
};
const detail = { id: "submission-1", title: "My selected examples", contributor_alias: "", status: "submitted", created_at: "2026-10-25T12:00:00Z", updated_at: "2026-10-25T12:00:00Z", pack_sha256: "a".repeat(64), event_count: 1, conversation_count: 1, sources: { codex: 1 }, requested_uses: ["evaluation"], offers: [], current_offer: null, payment_status: "not_started", contributor_note: "My reviewed examples" } as SubmissionDetail;
const code = "private-receipt-code-that-is-at-least-43-characters";
beforeEach(() => {
  vi.clearAllMocks();
  api.marketStatus.mockResolvedValue({ enabled: true, max_pack_bytes: 26214400, max_events: 50000, receipt_schema: "agent-me.submission-receipt.v1", reason: null });
  api.createReceiptCode.mockReturnValue(code);
  api.submitPack.mockResolvedValue({ submission: detail, receipt_schema: "agent-me.submission-receipt.v1" });
  api.getSubmission.mockResolvedValue(detail);
});
afterEach(() => cleanup());

it("does not upload on open and requires an explicit final send confirmation", async () => {
  render(<SubmissionForm pack={pack} />);
  await screen.findByText("Ready to receive submissions");
  expect(api.submitPack).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Submission title"), { target: { value: "My selected examples" } });
  expect(screen.getByRole("button", { name: "Submit selected activity" })).toBeDisabled();
  fireEvent.click(screen.getByLabelText("Submit these selected records to Agent-Me for review"));
  fireEvent.click(screen.getByRole("button", { name: "Submit selected activity" }));
  await screen.findByRole("heading", { name: "Submission received" });
  expect(api.submitPack).toHaveBeenCalledWith({ pack, title: "My selected examples", contributor_alias: "", confirm_submission: true }, code, expect.any(AbortSignal));
  expect(screen.getByLabelText("Private receipt code")).toHaveValue(code);
  expect(window.location.search).not.toContain(code);
  expect(window.localStorage.getItem("agent-me-receipt")).toBeNull();
});

it("retains the same receipt code and exact payload when retrying an uncertain send", async () => {
  api.submitPack.mockRejectedValueOnce(new Error("Connection interrupted. Retry with the same receipt."));
  render(<SubmissionForm pack={pack} />);
  await screen.findByText("Ready to receive submissions");
  fireEvent.change(screen.getByLabelText("Submission title"), { target: { value: "My selected examples" } });
  fireEvent.click(screen.getByLabelText("Submit these selected records to Agent-Me for review"));
  fireEvent.click(screen.getByRole("button", { name: "Submit selected activity" }));
  await screen.findByRole("alert");
  expect(screen.getByLabelText("Submission title")).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Retry submission" }));
  await screen.findByRole("heading", { name: "Submission received" });
  expect(api.submitPack).toHaveBeenCalledTimes(2);
  expect(api.submitPack.mock.calls[0].slice(0, 2)).toEqual(api.submitPack.mock.calls[1].slice(0, 2));
  expect(api.createReceiptCode).toHaveBeenCalledTimes(1);
});

it("shows a disabled service without uploading or creating a receipt", async () => {
  api.marketStatus.mockResolvedValue({ enabled: false, reason: "Submissions are not available yet." });
  render(<SubmissionForm pack={pack} />);
  await screen.findByText("Submissions are not available yet.");
  expect(screen.getByRole("button", { name: "Submit selected activity" })).toBeDisabled();
  expect(api.submitPack).not.toHaveBeenCalled();
  expect(api.createReceiptCode).not.toHaveBeenCalled();
});

it("shows an offered price and records acceptance as pending agreement without claiming payment", async () => {
  const offered = { ...detail, status: "offered", current_offer: { id: "offer-1", amount_minor: 12500, currency: "CAD", proposed_uses: ["evaluation"], message: "Useful evaluation traces", created_at: detail.created_at, status: "open" }, offers: [] } as SubmissionDetail;
  api.respondToOffer.mockResolvedValue({ ...offered, status: "accepted_pending_agreement", current_offer: { ...offered.current_offer, status: "accepted" } });
  render(<SubmissionReceipt submission={offered} receiptCode={code} />);
  expect(screen.getByText(/125\.00/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Accept offer" }));
  await screen.findByText("Accepted · agreement pending");
  expect(api.respondToOffer).toHaveBeenCalledWith(detail.id, code, { offer_id: "offer-1", decision: "accept" }, expect.any(AbortSignal));
  expect(screen.getByText(/No payment or license transfer has taken place/)).toBeInTheDocument();
});

it("withdraws only after confirmation and updates the receipt", async () => {
  api.withdrawSubmission.mockResolvedValue({ ...detail, status: "withdrawn" });
  render(<SubmissionReceipt submission={detail} receiptCode={code} />);
  fireEvent.click(screen.getByRole("button", { name: "Withdraw submission" }));
  expect(api.withdrawSubmission).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Confirm withdrawal" }));
  await waitFor(() => expect(screen.getByText("Withdrawn")).toBeInTheDocument());
  expect(api.withdrawSubmission).toHaveBeenCalledWith(detail.id, code, expect.any(AbortSignal));
  expect(screen.getByText(/The submitted activity has been removed/)).toBeInTheDocument();
});

it("respects the hosted service limit before sending selected activity", async () => {
  api.marketStatus.mockResolvedValue({ enabled: true, max_pack_bytes: 16, max_events: 50000, receipt_schema: "agent-me.submission-receipt.v1", reason: null });
  render(<SubmissionForm pack={pack} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("This service accepts up to 16 bytes per submission");
  fireEvent.change(screen.getByLabelText("Submission title"), { target: { value: "My selected examples" } });
  fireEvent.click(screen.getByLabelText("Submit these selected records to Agent-Me for review"));
  const send = screen.getByRole("button", { name: "Submit selected activity" });
  expect(send).toBeDisabled();
  fireEvent.submit(send.closest("form")!);
  expect(api.submitPack).not.toHaveBeenCalled();
});
