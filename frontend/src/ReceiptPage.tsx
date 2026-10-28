import { useEffect, useRef, useState, type FormEvent } from "react";
import { getSubmission, type SubmissionDetail, type TraceReceipt } from "./marketApi";
import { MarketShell } from "./MarketShell";
import { SubmissionReceipt } from "./SubmissionReceipt";
import "./submission.css";

function readReceipt(file: File): Promise<TraceReceipt> {
  return new Promise((resolve, reject) => {
    if (file.size > 16384) { reject(new Error("Choose a private receipt file smaller than 16 KiB, not your activity export.")); return; }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read this receipt file."));
    reader.onload = () => {
      try {
        const value: unknown = JSON.parse(String(reader.result));
        if (!value || typeof value !== "object" || !("schema" in value) || value.schema !== "agent-me.submission-receipt.v1" || !("submission_id" in value) || typeof value.submission_id !== "string" || !value.submission_id || value.submission_id.length > 100 || !("access_token" in value) || typeof value.access_token !== "string" || !/^[A-Za-z0-9_-]{43,128}$/.test(value.access_token)) throw new Error("Choose an Agent-Me private receipt file. Activity exports do not contain a private receipt code.");
        resolve(value as TraceReceipt);
      } catch (reason) { reject(reason instanceof SyntaxError ? new Error("This is not a valid private receipt JSON file.") : reason); }
    };
    reader.readAsText(file);
  });
}
export function ReceiptPage({ submissionId = "" }: { submissionId?: string }) {
  const [id, setId] = useState(submissionId);
  const [code, setCode] = useState("");
  const [detail, setDetail] = useState<SubmissionDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement | null>(null);
  const request = useRef<AbortController | null>(null);
  const readVersion = useRef(0);
  useEffect(() => () => { request.current?.abort(); ++readVersion.current; }, []);

  async function openReceipt(event: FormEvent) {
    event.preventDefault();
    if (busy || !id.trim() || !/^[A-Za-z0-9_-]{43,128}$/.test(code.trim())) return;
    setBusy(true); setError("");
    const controller = new AbortController(); request.current = controller;
    try { const result = await getSubmission(id.trim(), code.trim(), controller.signal); if (!controller.signal.aborted) setDetail(result); }
    catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not open this receipt. Check your submission ID and private code."); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  async function load(file: File) {
    const version = ++readVersion.current;
    setBusy(true); setError("");
    try { const receipt = await readReceipt(file); if (version === readVersion.current) { setId(receipt.submission_id); setCode(receipt.access_token); } }
    catch (reason) { if (version === readVersion.current) setError(reason instanceof Error ? reason.message : "Could not read this receipt."); }
    finally { if (version === readVersion.current) setBusy(false); }
  }
  function close() { request.current?.abort(); ++readVersion.current; setDetail(null); setCode(""); setError(""); setBusy(false); }
  return <MarketShell active="submissions" title="My submission">
    {detail ? <div className="submission-page-body"><h1 className="trace-visually-hidden">Your submission</h1><div className="submission-page-back"><a href="/">← Agent-Me</a><button className="trace-text-button" type="button" onClick={close}>Close private receipt</button></div><SubmissionReceipt key={detail.id} submission={detail} receiptCode={code.trim()} /></div> : <div className="submission-lookup-layout"><header className="market-page-heading"><p className="market-kicker">Your private submission</p><h1>Review your<br />submission.</h1><p className="market-muted">Use your private receipt to check the review, see offers, or withdraw your submission.</p><div className="submission-lookup-note"><span aria-hidden="true">↗</span><p>No account needed.<br />Your receipt is your access.</p></div></header><section className="market-card submission-lookup-card" aria-labelledby="receipt-lookup-heading"><p className="market-kicker">Private access</p><h2 id="receipt-lookup-heading">Open your submission</h2><input ref={input} className="trace-visually-hidden" type="file" accept=".json,application/json" aria-label="Load private receipt file" disabled={busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void load(file); }} /><button className="submission-receipt-file-button" type="button" disabled={busy} onClick={() => input.current?.click()}>Load private receipt <span aria-hidden="true">↑</span></button><p className="submission-fineprint">Read locally. Nothing is sent until you open the submission.</p><div className="submission-or"><span>or enter your details</span></div><form className="market-form" onSubmit={openReceipt} aria-busy={busy}><label className="market-label" htmlFor="lookup-id">Submission ID<input id="lookup-id" value={id} onChange={event => setId(event.target.value)} maxLength={100} required autoComplete="off" disabled={busy} /></label><label className="market-label" htmlFor="lookup-code">Private receipt code<input id="lookup-code" type="password" value={code} onChange={event => setCode(event.target.value)} minLength={43} maxLength={128} required autoComplete="off" spellCheck={false} disabled={busy} /></label>{error && <p className="market-error" role="alert">{error}</p>}<button className="trace-button" type="submit" disabled={busy || !id.trim() || !/^[A-Za-z0-9_-]{43,128}$/.test(code.trim())}>{busy ? "Opening submission…" : "Open submission"}<span aria-hidden="true">→</span></button></form><p className="submission-fineprint">Your private code stays out of links and browser storage. Keep your receipt safe; there is no account recovery in this version.</p></section></div>}
  </MarketShell>;
}
