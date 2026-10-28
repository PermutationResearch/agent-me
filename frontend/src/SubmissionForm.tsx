import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { createReceiptCode, marketStatus, submitPack, type MarketStatus, type SubmissionDetail, type SubmissionPayload } from "./marketApi";
import { SubmissionReceipt } from "./SubmissionReceipt";
import type { RequestedUse, TracePack } from "./traceTypes";
import "./submission.css";

const useLabels: Record<RequestedUse, string> = { stack_optimization: "Prompt & stack optimization", evaluation: "Evaluation", small_model_training: "Small model training" };

export function SubmissionForm({ pack, onCancel }: { pack: TracePack; onCancel?: () => void }) {
  const [title, setTitle] = useState("");
  const [alias, setAlias] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [service, setService] = useState<MarketStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [checkingService, setCheckingService] = useState(true);
  const [attempted, setAttempted] = useState(false);
  const [submitted, setSubmitted] = useState<{ submission: SubmissionDetail; code: string } | null>(null);
  const attempt = useRef<{ payload: SubmissionPayload; code: string } | null>(null);
  const sending = useRef(false);
  const request = useRef<AbortController | null>(null);
  const validPack = pack.intent === "sale_offer" && pack.offer !== null;
  const selectedBytes = useMemo(() => new TextEncoder().encode(JSON.stringify(pack, null, 2)).byteLength, [pack]);
  const exceedsServiceLimit = service !== null && selectedBytes > service.max_pack_bytes;

  useEffect(() => {
    const controller = new AbortController();
    marketStatus(controller.signal).then(status => { if (!controller.signal.aborted) setService(status); }).catch(() => {
      if (!controller.signal.aborted) setError("Could not check submission availability. Your selection is still here. Reload this page when the service is available.");
    }).finally(() => { if (!controller.signal.aborted) setCheckingService(false); });
    return () => { controller.abort(); request.current?.abort(); };
  }, []);

  async function recheckService() {
    const controller = new AbortController(); request.current = controller;
    setCheckingService(true); setError("");
    try { const status = await marketStatus(controller.signal); if (!controller.signal.aborted) setService(status); }
    catch { if (!controller.signal.aborted) setError("Could not reach the submission service. Your selected activity is still here."); }
    finally { if (!controller.signal.aborted) setCheckingService(false); }
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    if (sending.current || !validPack || !service?.enabled || exceedsServiceLimit || !confirmed || !title.trim()) return;
    sending.current = true; setBusy(true); setError("");
    const controller = new AbortController(); request.current = controller;
    try {
      if (!attempt.current) attempt.current = { payload: { pack, title: title.trim(), contributor_alias: alias.trim(), confirm_submission: true }, code: createReceiptCode() };
      setAttempted(true);
      const result = await submitPack(attempt.current.payload, attempt.current.code, controller.signal);
      if (!controller.signal.aborted) setSubmitted({ submission: result.submission, code: attempt.current.code });
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "The submission was not confirmed. Retry to check the same submission.");
    } finally {
      sending.current = false;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  if (submitted) return <SubmissionReceipt submission={submitted.submission} receiptCode={submitted.code} />;
  return <section className="submission-compose market-card" aria-labelledby="submission-form-heading">
    <div className="submission-section-top"><div><p className="market-kicker">One final review</p><h2 id="submission-form-heading">Submit your selected activity</h2></div>{onCancel && <button type="button" className="trace-text-button" onClick={onCancel} disabled={busy}>Back to selection</button>}</div>
    <p className="market-muted">Agent-Me will review the selected records and the uses you are willing to consider. You decide whether to accept an offer.</p>
    <div className="submission-pack-summary" aria-label="Submission summary">
      <div><strong>{pack.selection.events.toLocaleString()}</strong><span>selected {pack.selection.events === 1 ? "record" : "records"}</span></div>
      <div><strong>{pack.selection.conversations.toLocaleString()}</strong><span>{pack.selection.conversations === 1 ? "conversation" : "conversations"}</span></div>
      <div><strong>{Object.keys(pack.selection.sources).length}</strong><span>{Object.keys(pack.selection.sources).length === 1 ? "source" : "sources"}</span></div>
    </div>
    <div className="submission-use-preview"><span className="submission-small-label">Uses you selected</span><div>{pack.offer?.requested_uses.map(use => <span className="market-pill" key={use}>{useLabels[use]}</span>)}</div></div>
    {pack.offer?.note && <div className="submission-note"><span className="submission-small-label">Your note</span><p>{pack.offer.note}</p></div>}
    <PackPreview pack={pack} />
    <form className="market-form submission-form" onSubmit={send} aria-busy={busy}>
      <label className="market-label" htmlFor="submission-title">Submission title<input id="submission-title" value={title} onChange={event => setTitle(event.target.value)} maxLength={120} placeholder="e.g. Coding assistant evaluation sessions" required disabled={busy || attempted} /></label>
      <label className="market-label" htmlFor="submission-alias"><span>Display name <span className="market-muted">(optional)</span></span><input id="submission-alias" value={alias} onChange={event => setAlias(event.target.value)} maxLength={80} placeholder="Your name or a contributor alias" disabled={busy || attempted} /></label>
      <label className="submission-confirm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} disabled={busy || attempted} /><span>Submit these selected records to Agent-Me for review</span></label>
      <p className="submission-fineprint">The selected content and submission metadata will leave this browser. Save your private receipt after sending; it is how you return to your submission. Sending does not transfer ownership or start a payment.</p>
      <div className="submission-service" role="status"><span className={service?.enabled ? "submission-service-dot" : "submission-service-dot unavailable"} aria-hidden="true" />{checkingService ? "Checking submission availability…" : service ? service.enabled ? "Ready to receive submissions" : service.reason || "Submissions are not available yet." : "Submission availability could not be confirmed."}</div>
      {!checkingService && !service?.enabled && <button type="button" className="trace-text-button" onClick={recheckService}>Check availability again</button>}
      {exceedsServiceLimit && <p className="market-error" role="alert">This service accepts up to {formatBytes(service.max_pack_bytes)} per submission. Your selected activity is {formatBytes(selectedBytes)}. Choose fewer records in Activity review, then prepare a smaller submission.</p>}
      {!validPack && <p className="market-error" role="alert">This is a personal export. Prepare a submission draft in <a href="/traces">Activity review</a> before submitting.</p>}
      {error && <p className="market-error" role="alert">{error}</p>}
      {attempted && !busy && error && <p className="submission-fineprint">Keep this page open and retry. The same receipt code will check or complete your original submission without sending a duplicate.</p>}
      <div className="submission-send-row"><button className="trace-button" type="submit" disabled={busy || checkingService || !service?.enabled || exceedsServiceLimit || !validPack || !confirmed || !title.trim()}>{busy ? "Submitting selected activity…" : attempted ? "Retry submission" : "Submit selected activity"}<span aria-hidden="true">↗</span></button><span className="submission-fineprint">Only the selected records shown above.</span></div>
    </form>
    <p className="submission-hash">Submission fingerprint <code>{pack.integrity.sha256}</code></p>
  </section>;
}

function PackPreview({ pack }: { pack: TracePack }) {
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState(false);
  const pageSize = 20;
  const offset = page * pageSize;
  return <details className="submission-pack-preview" onToggle={event => setOpen(event.currentTarget.open)}><summary>Inspect the {pack.selection.events === 1 ? "record" : "records"} being sent</summary>
    {open && pack.events.slice(offset, offset + pageSize).map((record, index) => <article key={record.id}><span>{offset + index + 1} · {record.source} · {record.role}</span><pre>{record.content}</pre></article>)}
    {open && pack.events.length > pageSize && <div className="submission-preview-pagination"><button type="button" className="trace-text-button" disabled={page === 0} onClick={() => setPage(previous => previous - 1)}>Previous records</button><span>{offset + 1}–{Math.min(offset + pageSize, pack.events.length)} of {pack.events.length}</span><button type="button" className="trace-text-button" disabled={offset + pageSize >= pack.events.length} onClick={() => setPage(previous => previous + 1)}>Next records</button></div>}
  </details>;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} bytes`;
  const unit = bytes < 1024 * 1024 ? "KiB" : "MiB";
  const amount = bytes / (unit === "KiB" ? 1024 : 1024 * 1024);
  return `${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${unit}`;
}
