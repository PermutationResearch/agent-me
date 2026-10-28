import { useEffect, useRef, useState } from "react";
import { getSubmission, getSubmissionPack, respondToOffer, withdrawSubmission, type SubmissionDetail, type SubmissionStatus, type TraceReceipt } from "./marketApi";
import type { RequestedUse } from "./traceTypes";
import { SubmissionProgress } from "./SubmissionProgress";
import "./submission.css";

const statuses: Record<SubmissionStatus, string> = { submitted: "Submitted", under_review: "Under review", offered: "Offer received", accepted_pending_agreement: "Accepted · agreement pending", declined: "Declined", withdrawn: "Withdrawn" };
const useLabels: Record<RequestedUse, string> = { stack_optimization: "Prompt & stack optimization", evaluation: "Evaluation", small_model_training: "Small model training" };
function downloadJson(value: unknown, filename: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = filename; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
function readableDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date unavailable" : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function SubmissionReceipt({ submission, receiptCode, onChange }: { submission: SubmissionDetail; receiptCode: string; onChange?: (submission: SubmissionDetail) => void }) {
  const [detail, setDetail] = useState(submission);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmWithdrawal, setConfirmWithdrawal] = useState(false);
  const [notice, setNotice] = useState("");
  const [showCode, setShowCode] = useState(false);
  const request = useRef<AbortController | null>(null);
  const working = useRef(false);
  useEffect(() => () => { request.current?.abort(); }, []);

  async function run(operation: (signal: AbortSignal) => Promise<SubmissionDetail>, message: string) {
    if (working.current) return;
    working.current = true; setBusy(true); setError(""); setNotice("");
    const controller = new AbortController(); request.current = controller;
    try {
      const result = await operation(controller.signal);
      if (!controller.signal.aborted) { setDetail(result); setConfirmWithdrawal(false); setNotice(message); onChange?.(result); }
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not update your submission. Refresh and try again.");
    } finally {
      working.current = false;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  async function downloadPack() {
    if (working.current) return;
    working.current = true; setBusy(true); setError("");
    const controller = new AbortController(); request.current = controller;
    try { const pack = await getSubmissionPack(detail.id, receiptCode, controller.signal); if (!controller.signal.aborted) downloadJson(pack, `agent-me-submitted-pack-${detail.id}.json`); }
    catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not download the submitted activity."); }
    finally { working.current = false; if (!controller.signal.aborted) setBusy(false); }
  }
  function saveReceipt() {
    try {
      const receipt: TraceReceipt = { schema: "agent-me.submission-receipt.v1", submission_id: detail.id, access_token: receiptCode };
      downloadJson(receipt, `agent-me-private-receipt-${detail.id}.json`);
      setNotice("Private receipt downloaded. Keep it somewhere safe.");
    } catch { setError("Could not download your receipt. Save the submission ID and private code shown here before leaving."); }
  }
  const offer = detail.current_offer;
  return <section className="submission-receipt" aria-labelledby="submission-receipt-heading" aria-busy={busy}>
    <header className="submission-receipt-header"><span className="submission-checkmark" aria-hidden="true">✓</span><div><p className="market-kicker">Your private receipt</p><h2 id="submission-receipt-heading">Submission received</h2><p className="market-muted">Return here to see the review and any offer.</p></div><span className={`market-status submission-status-${detail.status}`}>{statuses[detail.status]}</span></header>
    <SubmissionProgress submission={detail} />
    <div className="submission-receipt-grid"><section className="market-card submission-receipt-access" aria-labelledby="receipt-access-heading"><p className="market-kicker">Keep this private</p><h3 id="receipt-access-heading">Your way back in</h3><p className="market-muted">Anyone with this receipt can view your submission and respond to offers. It is not saved in your browser.</p><label className="market-label" htmlFor="receipt-id">Submission ID<input id="receipt-id" value={detail.id} readOnly /></label><label className="market-label" htmlFor="receipt-code">Private receipt code<input id="receipt-code" type={showCode ? "text" : "password"} value={receiptCode} readOnly autoComplete="off" spellCheck={false} /></label><button className="trace-text-button" type="button" aria-pressed={showCode} onClick={() => setShowCode(visible => !visible)}>{showCode ? "Hide private code" : "Show private code"}</button><button className="trace-button" type="button" onClick={saveReceipt}>Save private receipt <span aria-hidden="true">↓</span></button><p className="submission-fineprint">Next time, open <a href="/submissions">My submission</a> and load this receipt. Keep a copy before closing this page.</p></section>
    <section className="market-card submission-receipt-detail" aria-labelledby="receipt-pack-heading"><div className="submission-section-top"><h3 id="receipt-pack-heading">{detail.title}</h3><button className="trace-text-button" type="button" disabled={busy} onClick={() => run(signal => getSubmission(detail.id, receiptCode, signal), "Submission refreshed.")}>Refresh status <span aria-hidden="true">↻</span></button></div><dl className="submission-facts"><div><dt>Records</dt><dd>{detail.event_count.toLocaleString()}</dd></div><div><dt>Conversations</dt><dd>{detail.conversation_count.toLocaleString()}</dd></div><div><dt>Submitted</dt><dd>{readableDate(detail.created_at)}</dd></div>{detail.contributor_alias && <div><dt>Submitted as</dt><dd>{detail.contributor_alias}</dd></div>}</dl><div className="submission-use-preview"><span className="submission-small-label">Your use preferences</span><div>{detail.requested_uses.map(use => <span className="market-pill" key={use}>{useLabels[use]}</span>)}</div></div>{detail.contributor_note && <div className="submission-note"><span className="submission-small-label">Your note</span><p>{detail.contributor_note}</p></div>}<p className="submission-hash">Submitted fingerprint <code>{detail.pack_sha256}</code></p>{detail.status !== "withdrawn" && <button type="button" className="trace-text-button" onClick={downloadPack} disabled={busy}>Download submitted activity ↓</button>}</section></div>
    <section className="market-card submission-proposal" aria-labelledby="submission-proposal-heading"><div className="submission-section-top"><div><p className="market-kicker">From Agent-Me</p><h3 id="submission-proposal-heading">{offer ? "Your offer" : "What happens next"}</h3></div>{offer && <span className="market-pill">{offer.status}</span>}</div>
      {offer ? <><p className="submission-offer-amount">{new Intl.NumberFormat(undefined, { style: "currency", currency: offer.currency, currencyDisplay: "code" }).format(offer.amount_minor / 100)}</p><p className="market-muted">Proposed amount · {readableDate(offer.created_at)}</p><div className="submission-use-preview"><span className="submission-small-label">Proposed uses</span><div>{offer.proposed_uses.map(use => <span className="market-pill" key={use}>{useLabels[use]}</span>)}</div></div>{offer.message && <p className="submission-offer-message">{offer.message}</p>}{offer.status === "open" && detail.status === "offered" && <div className="submission-action-row"><button type="button" className="trace-button" disabled={busy} onClick={() => run(signal => respondToOffer(detail.id, receiptCode, { offer_id: offer.id, decision: "accept" }, signal), "Offer accepted. Agreement and payment are still pending.")}>Accept offer</button><button type="button" className="trace-text-button" disabled={busy} onClick={() => run(signal => respondToOffer(detail.id, receiptCode, { offer_id: offer.id, decision: "decline" }, signal), "Offer declined.")}>Decline offer</button></div>}<p className="submission-fineprint">Accepting records your interest in this offer. A final agreement and payment are separate steps. No payment or license transfer has taken place.</p></> : detail.status === "withdrawn" ? <p className="market-muted">The submitted activity has been removed. This receipt keeps the submission history.</p> : detail.status === "declined" ? <p className="market-muted">Agent-Me has declined this submission. You can keep your receipt or withdraw your submission.</p> : <><p className="market-muted">Agent-Me will review your selected records and use preferences. If there is a fit, an offer will appear here with an amount, intended uses, and a message.</p><p className="submission-fineprint">There is no guaranteed offer or review time. Refresh this receipt to check for updates.</p></>}
    </section>
    {detail.offers.length > 1 && <details className="market-card submission-offer-history"><summary>Previous offers ({detail.offers.length - 1})</summary>{detail.offers.filter(previous => previous.id !== offer?.id).map(previous => <div key={previous.id}><span>{new Intl.NumberFormat(undefined, { style: "currency", currency: previous.currency, currencyDisplay: "code" }).format(previous.amount_minor / 100)}</span><span>{previous.status} · {readableDate(previous.created_at)}</span></div>)}</details>}
    {error && <p className="market-error" role="alert">{error}</p>}{notice && <p className="submission-notice" role="status">{notice}</p>}
    {detail.status !== "withdrawn" && <div className="submission-withdraw">{confirmWithdrawal ? <><p>Withdraw this submission? Agent-Me will lose access to its content. Your receipt and offer history will remain.</p><div className="submission-action-row"><button className="submission-danger-button" type="button" disabled={busy} onClick={() => run(signal => withdrawSubmission(detail.id, receiptCode, signal), "Your submission has been withdrawn.")}>Confirm withdrawal</button><button className="trace-text-button" type="button" disabled={busy} onClick={() => setConfirmWithdrawal(false)}>Keep submission</button></div></> : <><p>You remain in control of your submitted content.</p><button className="trace-text-button" type="button" disabled={busy} onClick={() => setConfirmWithdrawal(true)}>Withdraw submission</button></>}</div>}
  </section>;
}
