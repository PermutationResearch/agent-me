import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BuyerReview } from "./BuyerReview";
import { parseOfferAmount } from "./buyerOffer";
import * as api from "./marketApi";
import type { BuyerDetail, InboxPage } from "./marketApi";

vi.mock("./marketApi", () => ({
  MarketError: class extends Error { constructor(public status: number, message: string) { super(message); } },
  buyerInbox: vi.fn(), buyerSubmission: vi.fn(), buyerEvents: vi.fn(), markReview: vi.fn(), makeOffer: vi.fn(),
}));
const token = "fictional-buyer-key-that-is-long-enough";
const detail: BuyerDetail = {
  id: "submission-fiction", title: "Reviewed coding sessions", contributor_alias: "Ada",
  status: "submitted", created_at: "2026-10-25T18:00:00Z", updated_at: "2026-10-25T18:00:00Z",
  pack_sha256: "a".repeat(64), event_count: 2, conversation_count: 1, sources: { codex: 2 },
  requested_uses: ["evaluation"], current_offer: null, payment_status: "not_started", offers: [],
  contributor_note: "Please evaluate the selected records only.", review_notes: [],
};
const inbox: InboxPage = { submissions: [detail], total: 1, counts: { submitted: 1, under_review: 0, offered: 0, accepted_pending_agreement: 0, declined: 0, withdrawn: 0 } };
beforeEach(() => {
  vi.mocked(api.buyerInbox).mockResolvedValue(inbox);
  vi.mocked(api.buyerSubmission).mockResolvedValue(detail);
  vi.mocked(api.buyerEvents).mockResolvedValue({ events: [{ id: "event-one", source: "codex", conversation_id: "conversation-one", kind: "message", role: "user", timestamp: null, tool_name: null, content: "Fictional selected trace content", origin: { file_sha256: "b".repeat(64), line: 1, item: 0 }, content_sha256: "c".repeat(64), edited: true, trust: "untrusted_trace", instruction_authority: "none" }], total: 1, offset: 0, limit: 25 });
  vi.mocked(api.markReview).mockResolvedValue({ ...detail, status: "under_review", review_notes: [{ id: "note-one", note: "Private buyer assessment", created_at: detail.created_at }] });
  vi.mocked(api.makeOffer).mockResolvedValue({ ...detail, status: "offered" });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });
async function signIn() {
  fireEvent.change(screen.getByLabelText("Buyer access key"), { target: { value: token } });
  fireEvent.click(screen.getByRole("button", { name: "Open review workspace" }));
  await screen.findByRole("button", { name: /Reviewed coding sessions/ });
}
async function openPack() {
  await signIn();
  fireEvent.click(screen.getByRole("button", { name: /Reviewed coding sessions/ }));
  await screen.findByText("Fictional selected trace content");
}
it("parses exact positive currency minor units without rounding", () => {
  expect(parseOfferAmount("0.01")).toBe(1);
  expect(parseOfferAmount("1234.5")).toBe(123450);
  expect(parseOfferAmount("10000000.00")).toBe(1_000_000_000);
  for (const invalid of ["", "0", "-5", "1.234", "2e3", "1,000", "10000000.01"]) expect(parseOfferAmount(invalid)).toBeNull();
});
it("keeps the buyer inbox closed until a key is submitted, then shows actual selected records", async () => {
  render(<BuyerReview />);
  expect(api.buyerInbox).not.toHaveBeenCalled();
  await openPack();
  expect(api.buyerInbox).toHaveBeenCalledWith(token, expect.objectContaining({ limit: 30 }), expect.any(AbortSignal));
  expect(screen.getByText("Please evaluate the selected records only.")).toBeInTheDocument();
  expect(screen.queryByLabelText("Small model training")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Offer amount")).toHaveValue("");
});
it("publishes only an explicitly priced proposal and contributor-approved uses", async () => {
  render(<BuyerReview />); await openPack();
  fireEvent.change(screen.getByLabelText("Offer amount"), { target: { value: "123.45" } });
  fireEvent.click(screen.getByLabelText("Evaluation and benchmarking"));
  fireEvent.change(screen.getByLabelText("Message to contributor"), { target: { value: "A proposed evaluation license." } });
  fireEvent.click(screen.getByRole("button", { name: "Publish offer" }));
  await waitFor(() => expect(api.makeOffer).toHaveBeenCalledWith(token, detail.id, { amount_minor: 12345, currency: "CAD", proposed_uses: ["evaluation"], message: "A proposed evaluation license." }));
  expect(screen.getByText(/Offer published/)).toBeInTheDocument();
});
it("blocks amounts with excess precision without making an offer", async () => {
  render(<BuyerReview />); await openPack();
  fireEvent.change(screen.getByLabelText("Offer amount"), { target: { value: "12.345" } });
  fireEvent.click(screen.getByLabelText("Evaluation and benchmarking"));
  fireEvent.click(screen.getByRole("button", { name: "Publish offer" }));
  expect(await screen.findByText(/Enter an amount/)).toBeInTheDocument();
  expect(api.makeOffer).not.toHaveBeenCalled();
});
it("keeps review notes separate from the public offer message", async () => {
  render(<BuyerReview />); await openPack();
  fireEvent.change(screen.getByLabelText("Private review note"), { target: { value: "Private buyer assessment" } });
  fireEvent.click(screen.getByRole("button", { name: "Save review" }));
  await waitFor(() => expect(api.markReview).toHaveBeenCalledWith(token, detail.id, { status: "under_review", note: "Private buyer assessment" }));
  expect(screen.getByLabelText("Message to contributor")).toHaveValue("");
  expect(await screen.findByText("Private buyer assessment")).toBeInTheDocument();
});
it("filters records with explicit search and sends pagination parameters", async () => {
  render(<BuyerReview />); await openPack();
  fireEvent.change(screen.getByLabelText("Search selected records"), { target: { value: "verify" } });
  fireEvent.click(screen.getByRole("button", { name: "Search records" }));
  await waitFor(() => expect(api.buyerEvents).toHaveBeenLastCalledWith(token, detail.id, { query: "verify", offset: 0, limit: 25 }, expect.any(AbortSignal)));
});
it("clears private data on logout and ignores a late detail response", async () => {
  let resolveDetail!: (value: BuyerDetail) => void;
  vi.mocked(api.buyerSubmission).mockReturnValue(new Promise(resolve => { resolveDetail = resolve; }));
  render(<BuyerReview />); await signIn();
  fireEvent.click(screen.getByRole("button", { name: /Reviewed coding sessions/ }));
  fireEvent.click(screen.getByRole("button", { name: "Lock workspace" }));
  resolveDetail(detail);
  await screen.findByRole("button", { name: "Open review workspace" });
  expect(screen.queryByText("Please evaluate the selected records only.")).not.toBeInTheDocument();
  expect(screen.queryByText("Fictional selected trace content")).not.toBeInTheDocument();
  expect(localStorage.getItem("buyer-key")).toBeNull();
});
it("locks the workspace when the buyer key is rejected", async () => {
  vi.mocked(api.buyerInbox).mockRejectedValue(new api.MarketError(401, "Buyer key was not accepted."));
  render(<BuyerReview />);
  fireEvent.change(screen.getByLabelText("Buyer access key"), { target: { value: token } });
  fireEvent.click(screen.getByRole("button", { name: "Open review workspace" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Buyer key was not accepted.");
  expect(screen.getByRole("button", { name: "Open review workspace" })).toBeInTheDocument();
});

it("removes withdrawn content and disables offer creation", async () => {
  vi.mocked(api.buyerSubmission).mockResolvedValue({ ...detail, status: "withdrawn" });
  vi.mocked(api.buyerEvents).mockRejectedValue(new api.MarketError(410, "Withdrawn"));
  render(<BuyerReview />); await signIn();
  fireEvent.click(screen.getByRole("button", { name: /Reviewed coding sessions/ }));
  expect(await screen.findByText(/The contributor withdrew this submission/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Publish offer" })).not.toBeInTheDocument();
  expect(screen.queryByText("Fictional selected trace content")).not.toBeInTheDocument();
});
it("labels accepted proposals as pending agreement and payment", async () => {
  vi.mocked(api.buyerSubmission).mockResolvedValue({ ...detail, status: "accepted_pending_agreement" });
  render(<BuyerReview />); await openPack();
  expect(screen.getByText(/A final agreement and payment are still required/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Publish offer" })).not.toBeInTheDocument();
});
it("refreshes an open submission so contributor responses become visible", async () => {
  render(<BuyerReview />); await openPack();
  vi.mocked(api.buyerSubmission).mockResolvedValue({ ...detail, status: "accepted_pending_agreement" });
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  expect(await screen.findByText(/A final agreement and payment are still required/)).toBeInTheDocument();
});
it("keeps selected record content readable when its imported timestamp is invalid", async () => {
  vi.mocked(api.buyerEvents).mockResolvedValue({ events: [{ id: "event-bad-time", source: "codex", conversation_id: "conversation-one", kind: "message", role: "user", timestamp: "not-a-date", tool_name: null, content: "Fictional selected trace content", origin: { file_sha256: "b".repeat(64), line: 1, item: 0 }, content_sha256: "c".repeat(64), edited: false, trust: "untrusted_trace", instruction_authority: "none" }], total: 1, offset: 0, limit: 25 });
  render(<BuyerReview />); await openPack();
  expect(screen.getByText("Date unavailable")).toBeInTheDocument();
  expect(screen.getByText("Fictional selected trace content")).toBeInTheDocument();
});
