import { useId } from "react";
import type { SubmissionDetail } from "./marketApi";
import { TimelineZepa, type TimelineZepaItem } from "./ui/TimelineZepa";
import "./SubmissionProgress.css";

function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function progressItems(submission: SubmissionDetail): TimelineZepaItem[] {
  const received: TimelineZepaItem = { id: "received", title: "Received", timestamp: dateLabel(submission.created_at), status: "completed", description: "Your selected activity is saved with this receipt." };
  if (submission.status === "withdrawn") return [received, {
    id: "withdrawn", title: "Activity withdrawn", status: "default", current: true,
    description: "Your submitted activity has been removed. Your receipt and offer history remain.",
  }];
  if (submission.status === "declined") return [received, submission.current_offer?.status === "declined" ? {
    id: "offer-declined", title: "Offer declined", status: "default", current: true,
    description: "You declined the proposed offer. No agreement was made.",
  } : {
    id: "review-closed", title: "No offer this time", status: "default", current: true,
    description: "Agent-Me has declined this submission.",
  }];
  const offered = submission.status === "offered" || submission.status === "accepted_pending_agreement";
  const accepted = submission.status === "accepted_pending_agreement";
  const offerDate = submission.current_offer ? dateLabel(submission.current_offer.created_at) : undefined;
  return [received, {
    id: "review", title: submission.status === "submitted" ? "Awaiting review" : offered ? "Review complete" : "Under review",
    status: offered ? "completed" : "active", current: !offered,
    description: submission.status === "submitted" ? "Your activity is received. Agent-Me has not started its review yet." : offered ? "Agent-Me has proposed an offer for your activity." : "Agent-Me is reviewing your activity and use preferences.",
  }, {
    id: "offer", title: accepted ? "Offer accepted" : offered ? "Offer available" : "Offer decision",
    status: accepted ? "completed" : offered ? "active" : "pending", current: offered && !accepted,
    timestamp: offered && offerDate ? `Proposed ${offerDate}` : undefined,
    description: accepted ? "You accepted the proposal. A final agreement is still needed." : offered ? "Review the amount and proposed uses. You choose whether to accept." : "If there is a fit, an offer will appear in your receipt.",
  }, {
    id: "agreement", title: accepted ? "Agreement pending" : "Final agreement",
    status: accepted ? "active" : "pending", current: accepted,
    description: accepted ? "Payment has not started. No license or rights have transferred." : "A separate agreement and payment follow an accepted offer.",
  }];
}

export function SubmissionProgress({ submission }: { submission: SubmissionDetail }) {
  const headingId = useId();
  return <section className="submission-progress" aria-labelledby={headingId}>
    <div className="submission-progress-heading"><h3 id={headingId}>Submission progress</h3><span>Every step, on your terms</span></div>
    <TimelineZepa items={progressItems(submission)} orientation="horizontal" variant="bare" theme="light" density="compact" accent="#087f5b" timestampPosition="bottom" />
  </section>;
}
