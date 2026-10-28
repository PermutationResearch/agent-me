import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SubmissionReceipt } from "./SubmissionReceipt";
import type { Offer, SubmissionDetail } from "./marketApi";

const detail: SubmissionDetail = {
  id: "progress-123", title: "Selected activity", contributor_alias: "", status: "submitted",
  created_at: "2026-10-25T12:00:00Z", updated_at: "2026-10-27T14:00:00Z", pack_sha256: "a".repeat(64),
  event_count: 8, conversation_count: 2, sources: { codex: 8 }, requested_uses: ["evaluation"],
  offers: [], current_offer: null, payment_status: "not_started", contributor_note: "",
};
const offer: Offer = {
  id: "offer-1", amount_minor: 5000, currency: "CAD", proposed_uses: ["evaluation"], message: "",
  created_at: "2026-10-26T12:00:00Z", status: "open",
};
function progress(submission: SubmissionDetail) {
  render(<SubmissionReceipt submission={submission} receiptCode={"c".repeat(43)} />);
  return within(screen.getByRole("region", { name: "Submission progress" }));
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("shows receipt progress even when IntersectionObserver is unavailable, without inventing review dates", () => {
  vi.stubGlobal("IntersectionObserver", undefined);
  const view = progress(detail);
  expect(view.getByRole("heading", { name: "Awaiting review" })).toBeVisible();
  expect(view.getByText("Your activity is received. Agent-Me has not started its review yet.")).toBeVisible();
  expect(view.getAllByRole("listitem")).toHaveLength(4);
  expect(view.getByRole("listitem", { current: "step" })).toHaveTextContent("Awaiting review");
  expect(view.getByRole("list").querySelectorAll("time")).toHaveLength(1);
});

it("shows an active review without treating the last update as a review-start timestamp", () => {
  const view = progress({ ...detail, status: "under_review" });
  expect(view.getByRole("listitem", { current: "step" })).toHaveTextContent("Under review");
  expect(view.getByRole("list").querySelectorAll("time")).toHaveLength(1);
});

it("shows a real offer date and leaves the response with the contributor", () => {
  const view = progress({ ...detail, status: "offered", current_offer: offer, offers: [offer] });
  expect(view.getByRole("listitem", { current: "step" })).toHaveTextContent("Offer available");
  expect(view.getByRole("list").querySelectorAll("time")).toHaveLength(2);
  expect(view.getByText(`Proposed ${new Date(offer.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`)).toBeVisible();
  expect(screen.getByRole("button", { name: "Accept offer" })).toBeEnabled();
});

it("keeps an accepted proposal at agreement pending with payment and rights unchanged", () => {
  const accepted = { ...offer, status: "accepted" as const };
  const view = progress({ ...detail, status: "accepted_pending_agreement", current_offer: accepted, offers: [accepted] });
  expect(view.getByRole("listitem", { current: "step" })).toHaveTextContent("Agreement pending");
  expect(view.getByText("Payment has not started. No license or rights have transferred.")).toBeVisible();
  expect(view.queryByText("Paid", { exact: true })).not.toBeInTheDocument();
});

it("distinguishes Agent-Me declining a submission from the contributor declining an offer", () => {
  const view = progress({ ...detail, status: "declined" });
  expect(view.getByRole("listitem", { current: "step" })).toHaveTextContent("No offer this time");
  expect(view.getByText("Agent-Me has declined this submission.")).toBeVisible();
  cleanup();
  const declined = { ...offer, status: "declined" as const };
  const second = progress({ ...detail, status: "declined", current_offer: declined, offers: [declined] });
  expect(second.getByRole("listitem", { current: "step" })).toHaveTextContent("Offer declined");
  expect(second.getByText("You declined the proposed offer. No agreement was made.")).toBeVisible();
});

it("shows withdrawal without inventing a completed review or offer", () => {
  const view = progress({ ...detail, status: "withdrawn" });
  expect(view.getAllByRole("listitem")).toHaveLength(2);
  expect(view.getByRole("listitem", { current: "step" })).toHaveTextContent("Activity withdrawn");
  expect(view.queryByRole("heading", { name: /review/i })).not.toBeInTheDocument();
  expect(view.getByRole("list").querySelectorAll("time")).toHaveLength(1);
});
