import { useEffect, useRef, useState } from "react";
import { MarketShell } from "./MarketShell";
import { SubmissionForm } from "./SubmissionForm";
import { MAX_TRACE_PACK_BYTES, parseTracePack } from "./tracePack";
import type { TracePack } from "./traceTypes";
import "./submission.css";

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("Could not read this file.")); reader.readAsText(file);
  });
}
export function SubmitPage() {
  const [pack, setPack] = useState<TracePack | null>(null);
  const [filename, setFilename] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement | null>(null);
  const readVersion = useRef(0);
  useEffect(() => () => { readVersion.current += 1; }, []);
  async function open(file: File) {
    const version = ++readVersion.current;
    setBusy(true); setError("");
    try {
      if (file.size > MAX_TRACE_PACK_BYTES) throw new Error("This export exceeds 25 MiB. Select fewer records in Activity review and export a smaller selection.");
      const parsed = await parseTracePack(JSON.parse(await readFile(file)));
      if (parsed.intent !== "sale_offer" || !parsed.offer) throw new Error("This is a personal export. Open it in Activity review and choose ‘Submit for review’ to prepare a submission draft.");
      if (version === readVersion.current) { setPack(parsed); setFilename(file.name); }
    } catch (reason) { if (version === readVersion.current) setError(reason instanceof SyntaxError ? "This is not a valid JSON activity export. Export a submission draft from Activity review first." : reason instanceof Error ? reason.message : "Could not open this activity export."); }
    finally { if (version === readVersion.current) setBusy(false); }
  }
  function clear() { ++readVersion.current; setPack(null); setFilename(""); setError(""); setBusy(false); }
  return <MarketShell active="submit" title="Submit an activity export">
    <header className="market-page-heading submission-page-heading"><p className="market-kicker">Contribute on your terms</p><h1>Submit your<br />selected activity.</h1><p className="market-muted">Submit a reviewed activity export. See exactly what Agent-Me proposes before you agree to anything.</p></header>
    {pack ? <div className="submission-page-body"><p className="submission-open-file">Opened locally <span>{filename}</span></p><SubmissionForm key={pack.id} pack={pack} onCancel={clear} /></div> : <div className="submission-intake-layout"><section className="market-card submission-file-card" aria-labelledby="pack-file-heading"><span className="submission-file-symbol" aria-hidden="true"><svg viewBox="0 0 32 32"><path d="M10 5h9l5 5v17H8V5h2Zm8 0v7h6M12 18h8m-8 4h6" /></svg></span><h2 id="pack-file-heading">Open your activity export</h2><p className="market-muted">Open a submission draft from Activity review. We will verify the file in your browser before you confirm submission.</p><input ref={input} className="trace-visually-hidden" type="file" accept=".json,application/json" aria-label="Open activity export" disabled={busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void open(file); }} /><button className="trace-button" type="button" disabled={busy} onClick={() => input.current?.click()}>{busy ? "Checking your export…" : "Choose activity export"}<span aria-hidden="true">↑</span></button><p className="submission-fineprint">JSON · up to 25 MiB · checked in this browser</p><div className="submission-file-divider"><span>Starting with activity files?</span><a href="/traces">Review your activity <span aria-hidden="true">↗</span></a></div>{error && <p className="market-error" role="alert">{error}</p>}</section><aside className="submission-steps" aria-label="How submission works"><p className="market-kicker">What happens next</p><ol><li><span>01</span><div><h3>Choose what to share</h3><p>Review and select records in Activity review. Exclude anything you want to keep private.</p></div></li><li><span>02</span><div><h3>Submit reviewed activity</h3><p>Confirm the selected records and uses, then save your private receipt.</p></div></li><li><span>03</span><div><h3>Consider the offer</h3><p>Return with your receipt to see the review and any offer and its intended uses.</p></div></li></ol><p className="submission-fineprint">Submission is for review. A final agreement and payment happen separately.</p></aside></div>}
  </MarketShell>;
}
