import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { importTraceFiles, MAX_TRACE_FILE_BYTES, MAX_TRACE_FILES, MAX_TRACE_TOTAL_BYTES } from "./traceImport";
import { SubmissionForm } from "./SubmissionForm";
import "./market.css";
import { buildTracePack } from "./tracePack";
import { redactTraceText } from "./traceRedaction";
import { TRACE_SAMPLE_JSONL } from "./traceSample";
import "./TraceStudio.css";
import "./ClonkTheme.css";
import "./SiteChrome.css";
import { SiteNavigation } from "./SiteNavigation";
import { SiteFooter } from "./SiteFooter";
import type { RequestedUse, TraceImportResult, TraceIntent, TracePack } from "./traceTypes";

const PAGE_SIZE = 25;
const USES: { value: RequestedUse; label: string }[] = [
  { value: "stack_optimization", label: "Prompt and stack optimization" },
  { value: "evaluation", label: "Evaluation and benchmarking" },
  { value: "small_model_training", label: "Small-model training" },
];

export function TraceStudio() {
  const picker = useRef<HTMLInputElement>(null);
  const [sample, setSample] = useState(false);
  const [imported, setImported] = useState<TraceImportResult | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [focused, setFocused] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("");
  const [visibility, setVisibility] = useState("all");
  const [page, setPage] = useState(0);
  const [intent, setIntent] = useState<TraceIntent>("personal_export");
  const [uses, setUses] = useState<RequestedUse[]>([]);
  const [note, setNote] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState<"import" | "export" | null>(null);
  const [error, setError] = useState("");
  const [submissionPack, setSubmissionPack] = useState<TracePack | null>(null);
  const [downloaded, setDownloaded] = useState<TracePack | null>(null);
  const generation = useRef(0);
  const mounted = useRef(false);
  const editor = useRef<HTMLTextAreaElement>(null);
  const preview = useRef<HTMLElement>(null);

  useEffect(() => {
    mounted.current = true;
    const previousTitle = document.title;
    const alreadyScoped = document.body.classList.contains("trace-studio-page");
    document.title = "Activity review | Agent-Me";
    document.body.classList.add("trace-studio-page");
    return () => {
      mounted.current = false; generation.current += 1;
      document.title = previousTitle;
      if (!alreadyScoped) document.body.classList.remove("trace-studio-page");
    };
  }, []);
  useEffect(() => { if (focused) editor.current?.focus(); }, [focused]);

  useEffect(() => { if (submissionPack) { preview.current?.focus({ preventScroll: true }); preview.current?.scrollIntoView?.({ block: "start" }); } }, [submissionPack]);

  const events = useMemo(() => imported?.events ?? [], [imported]);
  const eventById = useMemo(() => new Map(events.map((event, index) => [event.id, { event, index }])), [events]);
  const sources = useMemo(() => [...new Set(events.map(event => event.source))].sort(), [events]);
  const roleCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const event of events) counts.set(event.role, (counts.get(event.role) ?? 0) + 1);
    return [...counts];
  }, [events]);
  const kindCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const event of events) counts.set(event.kind, (counts.get(event.kind) ?? 0) + 1);
    return [...counts];
  }, [events]);
  const textFor = (id: string) => edits[id] ?? eventById.get(id)?.event.text ?? "";
  const filtered = events.filter(event => (!source || event.source === source) &&
    (visibility === "all" || (visibility === "selected" ? selected.has(event.id) : !selected.has(event.id))) &&
    `${event.source} ${event.role} ${event.kind} ${edits[event.id] ?? event.text}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const current = focused ? eventById.get(focused) : undefined;
  const unsaved = [...selected].some(id => drafts[id] !== undefined && drafts[id] !== textFor(id));
  const warnings = [...new Set([...(imported?.warnings ?? []), ...(imported?.files.flatMap(file => file.warnings) ?? [])])];

  function invalidate() { setReviewed(false); setDownloaded(null); setSubmissionPack(null); }
  function resetData() {
    generation.current += 1;
    setSubmissionPack(null); setSample(false); setImported(null); setSelected(new Set()); setEdits({}); setDrafts({}); setFocused(null);
    setQuery(""); setSource(""); setVisibility("all"); setPage(0); setIntent("personal_export"); setUses([]);
    setNote(""); setReviewed(false); setDownloaded(null); setBusy(null); setError("");
  }
  async function openFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    await loadFiles(files);
  }
  async function loadFiles(files: File[], isSample = false) {
    if (!files.length) return;
    const revision = ++generation.current;
    setBusy("import"); setError("");
    try {
      const result = await importTraceFiles(files);
      if (!mounted.current || generation.current !== revision) return;
      setSample(isSample); setImported(result); setSelected(new Set()); setEdits({}); setDrafts({}); setFocused(null);
      setQuery(""); setSource(""); setVisibility("all"); setPage(0); setIntent("personal_export"); setUses([]);
      setNote(""); invalidate();
    } catch (reason) {
      if (mounted.current && generation.current === revision) setError(reason instanceof Error ? reason.message : "Could not read these trace files.");
    } finally {
      if (mounted.current && generation.current === revision) setBusy(null);
    }
  }
  function toggle(id: string) {
    setSelected(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; });
    invalidate();
  }
  function selectVisible(include: boolean) {
    setSelected(previous => { const next = new Set(previous); visible.forEach(event => include ? next.add(event.id) : next.delete(event.id)); return next; });
    invalidate();
  }
  function saveText() {
    if (!focused) return;
    const safe = redactTraceText(drafts[focused] ?? textFor(focused)).text;
    setEdits(previous => ({ ...previous, [focused]: safe }));
    setDrafts(previous => ({ ...previous, [focused]: safe }));
    invalidate();
  }
  function revertText() {
    if (!focused) return;
    setEdits(previous => { const next = { ...previous }; delete next[focused]; return next; });
    setDrafts(previous => { const next = { ...previous }; delete next[focused]; return next; });
    invalidate();
  }
  async function exportPack(sendPreview = false) {
    if (!imported || busy || !reviewed || !selected.size || unsaved || (intent === "sale_offer" && !uses.length)) return;
    const revision = ++generation.current;
    setBusy("export"); setError("");
    try {
      const pack = await buildTracePack(imported, [...selected], edits, {
        intent, requestedUses: intent === "sale_offer" ? uses : [], note: intent === "sale_offer" ? note : "", reviewConfirmed: reviewed,
      });
      if (!mounted.current || generation.current !== revision) return;
      if (sendPreview) { setSubmissionPack(pack); return; }
      const blob = new Blob([JSON.stringify(pack, null, 2)], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = `agent-me-traces-${pack.id}.json`; anchor.click();
      URL.revokeObjectURL(url); setDownloaded(pack);
    } catch (reason) {
      if (mounted.current && generation.current === revision) setError(reason instanceof Error ? reason.message : "Could not export the selected records.");
    } finally {
      if (mounted.current && generation.current === revision) setBusy(null);
    }
  }

  const selectedEvents = events.filter(event => selected.has(event.id));
  const selectedSources = new Map<string, number>();
  for (const event of selectedEvents) selectedSources.set(event.source, (selectedSources.get(event.source) ?? 0) + 1);
  const selectedConversations = new Set(selectedEvents.map(event => `${event.source}:${event.conversationId}`)).size;
  const redactionCount = imported?.files.reduce((total, file) => total + file.redactions, 0) ?? 0;
  const readableSource = (value: string) => ({ "claude-code": "Claude", codex: "Codex", omp: "OMP", "agent-trace": "Agent trace", normalized: "Portable" })[value] ?? value;
  const chooseFiles = () => picker.current?.click();
  const sampleFile = () => { void loadFiles([new File([TRACE_SAMPLE_JSONL], "agent-me-fictional-sample.jsonl", { type: "application/x-ndjson" })], true); };

  return <div className="app-shell trace-studio">
    <a className="trace-skip-link" href="#trace-main">Skip to activity review</a>
    <SiteNavigation active="traces" local />
    <main id="trace-main" className="trace-main">
      <header className="trace-page-heading"><div><p className="trace-breadcrumb">Your workspace</p><div className="trace-title-line"><h1>Your activity</h1>{sample && imported && <span className="trace-sample-label">Sample data</span>}</div><p>Review your agent activity. Choose what to keep or contribute.</p></div><div className="trace-header-actions">{imported && <button type="button" className="trace-button trace-button-small" disabled={busy !== null} onClick={chooseFiles}>Open files <span aria-hidden="true">+</span></button>}{(imported || busy) && <button type="button" className="trace-text-button" onClick={resetData} aria-label="Clear reviewed activity">Clear</button>}</div></header>
      <input ref={picker} className="trace-visually-hidden" type="file" multiple accept=".json,.jsonl,.ndjson,application/json" aria-label="Open activity files" disabled={busy !== null} onChange={event => { void openFiles(event); }} />
      {error && <p role="alert" className="trace-error">{error}</p>}
      {busy === "import" && <p className="trace-import-status" role="status"><span aria-hidden="true" />Reading and redacting trace files…</p>}
      <div className="trace-layout">
        <div className="trace-library-column">
          {!imported ? <section className="trace-empty" aria-labelledby="trace-import-heading">
            <div className="trace-upload-surface"><div className="trace-upload-symbol" aria-hidden="true"><svg viewBox="0 0 36 36"><path d="M18 23V7m-6 6 6-6 6 6M7 22v7h22v-7" /></svg></div><h2 id="trace-import-heading">Start with your agent activity.</h2><p>Review conversations and tool activity from your agents.<br />Choose what to share before it leaves your device.</p><button type="button" className="trace-button trace-import-action" disabled={busy !== null} onClick={chooseFiles}>Open activity files<svg aria-hidden="true" viewBox="0 0 16 16"><path d="M8 3v10M3 8h10" /></svg></button><button type="button" className="trace-text-button trace-sample-action" disabled={busy !== null} onClick={sampleFile}>Try sample data <span aria-hidden="true">↗</span></button><span className="trace-file-types">JSON · JSONL · NDJSON</span></div>
            <div className="trace-source-chips" aria-label="Supported sources"><span><i aria-hidden="true">C</i>Claude</span><span><i aria-hidden="true">↗</i>Codex</span><span><i aria-hidden="true">O</i>OMP / Pi</span><span><i aria-hidden="true">↔</i>Open exports</span></div>
            <p className="trace-local-copy"><svg aria-hidden="true" viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="9" rx="1.5" /><path d="M5 14h6" /></svg>Processed in this browser. Your files stay here.</p>
          </section> : <section className="trace-library" aria-labelledby="trace-review-heading">
            <div className="trace-library-heading"><div><h2 id="trace-review-heading">Activity</h2><p aria-live="polite">{selected.size} selected of {events.length} records</p></div><span className="trace-library-count">{events.length.toLocaleString()}<small>records</small></span></div>
            <div className="trace-metrics"><div><strong>{imported.files.length}</strong><span>Imported files</span></div><div><strong>{new Set(events.map(event => event.conversationId)).size}</strong><span>Conversations</span></div><div><strong>{redactionCount}</strong><span>Redactions</span></div></div>
            <div className="trace-filters"><label className="trace-search-label"><span className="trace-visually-hidden">Search records</span><svg aria-hidden="true" viewBox="0 0 20 20"><circle cx="8.5" cy="8.5" r="5.25" /><path d="m12.5 12.5 4 4" /></svg><input value={query} disabled={busy !== null} onChange={event => { setQuery(event.target.value); setPage(0); }} placeholder="Search your traces" /></label><label><span className="trace-visually-hidden">Source</span><select value={source} disabled={busy !== null} onChange={event => { setSource(event.target.value); setPage(0); }}><option value="">All sources</option>{sources.map(value => <option key={value} value={value}>{readableSource(value)}</option>)}</select></label><label><span className="trace-visually-hidden">Record visibility</span><select value={visibility} disabled={busy !== null} onChange={event => { setVisibility(event.target.value); setPage(0); }}><option value="all">All records</option><option value="selected">Selected only</option><option value="excluded">Excluded only</option></select></label></div>
            {current && <section className="trace-editor" aria-label="Record editor"><div className="trace-inspector-heading"><div><span>Record {current.index + 1}</span><h3>Review your text</h3></div><button type="button" className="trace-icon-button" aria-label="Close record editor" onClick={() => setFocused(null)}>×</button></div><p>{readableSource(current.event.source)} · {current.event.role} · {current.event.kind}</p><label><span className="trace-visually-hidden">Reviewed record text</span><textarea ref={editor} rows={7} maxLength={2000000} value={drafts[current.event.id] ?? textFor(current.event.id)} disabled={busy !== null} onChange={event => { setDrafts(previous => ({ ...previous, [current.event.id]: event.target.value })); invalidate(); }} /></label><div className="trace-editor-actions"><button type="button" className="trace-button trace-button-small" disabled={busy !== null} onClick={saveText}>Save reviewed text</button><button type="button" className="trace-text-button" disabled={busy !== null} onClick={revertText}>Restore imported text</button></div><small>Credential redaction runs again when you save. The source file stays unchanged.</small></section>}
            <div className="trace-page-actions"><span>{filtered.length} matching records</span><button type="button" className="trace-text-button" disabled={busy !== null || !visible.length} onClick={() => selectVisible(true)}>Select this page</button><button type="button" className="trace-text-button" disabled={busy !== null || !visible.length} onClick={() => selectVisible(false)}>Exclude this page</button><button type="button" className="trace-text-button" disabled={busy !== null || !selected.size} onClick={() => { setSelected(new Set()); invalidate(); }}>Exclude all records</button></div>
            <ul className="trace-records">{visible.map(event => {
              const position = (eventById.get(event.id)?.index ?? 0) + 1;
              const dirty = drafts[event.id] !== undefined && drafts[event.id] !== textFor(event.id);
              return <li key={event.id} className={selected.has(event.id) ? "is-selected" : ""}><label className="trace-row-select"><input type="checkbox" aria-label={`Select record ${position}`} checked={selected.has(event.id)} disabled={busy !== null} onChange={() => toggle(event.id)} /><span className="trace-visually-hidden">Select record {position}</span></label><div className="trace-record-content"><div className="trace-record-meta"><span className="trace-source-badge">{readableSource(event.source)}</span><span>{event.role}</span><span>{event.kind.replace(/_/g, " ")}</span>{dirty ? <span className="trace-edited-label">Unsaved edit</span> : edits[event.id] !== undefined && <span className="trace-edited-label">Edited</span>}</div><p className="trace-preview">{textFor(event.id).slice(0, 220)}{textFor(event.id).length > 220 ? "…" : ""}</p><small>{event.timestamp ? new Date(event.timestamp).toLocaleDateString() : "No date"}<span aria-hidden="true"> · </span>Record {position}<span aria-hidden="true"> · </span>line {event.origin.line}</small></div><button type="button" className="trace-review-button" disabled={busy !== null} onClick={() => setFocused(event.id)} aria-label={`Review record ${position}`}>Review<svg aria-hidden="true" viewBox="0 0 16 16"><path d="m6 3 5 5-5 5" /></svg></button></li>;
            })}</ul>
            {!visible.length && <div className="trace-filter-empty"><strong>No records match.</strong><p>Try another search or change your filters.</p></div>}
            <div className="trace-pagination"><span>Page {currentPage + 1} of {pageCount}</span><div><button type="button" className="trace-icon-button" disabled={busy !== null || currentPage === 0} onClick={() => setPage(Math.max(0, currentPage - 1))} aria-label="Previous page">←</button><button type="button" className="trace-icon-button" disabled={busy !== null || currentPage + 1 >= pageCount} onClick={() => setPage(currentPage + 1)} aria-label="Next page">→</button></div></div>
          </section>}
          <div className="trace-help">
            <details><summary>Where to find activity files<span aria-hidden="true">+</span></summary><p>Open a source folder in your file picker, then choose the uncompressed JSONL files to review.</p><ul><li>Claude Code: <code>~/.claude/projects</code></li><li>Codex: <code>~/.codex/sessions</code> or <code>~/.codex/archived_sessions</code></li><li>OMP/Pi: <code>~/.omp/agent/sessions</code> or <code>~/.pi/agent/sessions</code></li></ul></details>
            <details><summary>Privacy and supported formats<span aria-hidden="true">+</span></summary><p>Files are processed in this browser. Records leave your device only after you explicitly confirm and send selected activity. Refreshing or clearing removes the in-memory review; downloads stay on your device.</p><p>Likely credentials and home paths are redacted automatically. Review personal details, project names, and sensitive work yourself. Automatic redaction is not complete anonymization.</p><p>Claude Code, Codex, OMP/Pi, normalized JSON/JSONL, agent-trace NDJSON, and Agent-Me packs are supported. Attachments are omitted. Decompress archives before importing.</p><p>Up to {MAX_TRACE_FILES} files · {MAX_TRACE_FILE_BYTES / 1024 / 1024} MiB per file · {MAX_TRACE_TOTAL_BYTES / 1024 / 1024} MiB total. A new batch replaces your review only after successful import.</p></details>
            {imported && <details><summary>Imported files and extraction notes<span aria-hidden="true">+</span></summary><p>Roles: {roleCounts.map(([role, count]) => `${role} (${count})`).join(", ")}</p><p>Kinds: {kindCounts.map(([kind, count]) => `${kind} (${count})`).join(", ")}</p><ul>{imported.files.map(file => <li key={file.id}><strong>{file.name}</strong> · {file.format} · {file.events} records<br /><code>{file.sha256}</code></li>)}</ul>{warnings.map((warning, index) => <p key={index}>{warning}</p>)}<p>Source filenames stay in this review. Exports carry selected source hashes and formats.</p></details>}
          </div>
        </div>
        <aside id="trace-pack" className="trace-pack" aria-labelledby="trace-export-heading">
          <div className="trace-pack-heading"><h2 id="trace-export-heading">Your selection</h2><span>Local draft</span></div><div className="trace-pack-total"><strong>{selected.size.toLocaleString()}</strong><span>{selected.size === 1 ? "record selected" : "records selected"}</span></div>
          {selectedEvents.length > 0 && <div className="trace-pack-breakdown"><div><span>Conversations</span><strong>{selectedConversations}</strong></div><div><span>Sources</span><strong>{selectedSources.size}</strong></div>{[...selectedSources].map(([value, count]) => <div className="trace-pack-source" key={value}><span>{readableSource(value)}</span><span>{count} {count === 1 ? "record" : "records"}</span></div>)}</div>}
          <fieldset className="trace-intent" disabled={busy !== null}><legend className="trace-visually-hidden">Your next step</legend><label><input className="trace-visually-hidden" type="radio" name="trace-intent" checked={intent === "personal_export"} onChange={() => { setIntent("personal_export"); invalidate(); }} /><span>Personal export</span></label><label><input className="trace-visually-hidden" type="radio" name="trace-intent" aria-label="Offer selected activity to Agent-Me" checked={intent === "sale_offer"} onChange={() => { setIntent("sale_offer"); invalidate(); }} /><span>Submit for review</span></label></fieldset>
          {intent === "sale_offer" ? <><fieldset className="trace-uses" disabled={busy !== null}><legend>Uses to consider</legend>{USES.map(use => <label key={use.value} className="trace-checkbox"><input type="checkbox" checked={uses.includes(use.value)} onChange={() => { setUses(previous => previous.includes(use.value) ? previous.filter(value => value !== use.value) : [...previous, use.value]); invalidate(); }} /><span>{use.label}</span></label>)}</fieldset><details className="trace-offer-note"><summary>Add note for review<span aria-hidden="true">+</span></summary><label><span className="trace-visually-hidden">Note for review (optional)</span><textarea maxLength={1000} rows={3} disabled={busy !== null} value={note} onChange={event => { setNote(event.target.value); invalidate(); }} placeholder="A little context about these traces" /></label></details><p className="trace-offer-notice">Choose the uses you would consider. You can download a draft or submit selected activity for review. No sale happens automatically.</p></> : <p className="trace-pack-description">A portable copy of the records you choose. Ready to keep, inspect, or use elsewhere.</p>}
          {unsaved && <p role="status" className="trace-unsaved">Save or restore selected-record edits before exporting.</p>}
          <label className="trace-checkbox trace-confirm"><input type="checkbox" checked={reviewed} disabled={busy !== null || !selected.size || unsaved} onChange={event => { setReviewed(event.target.checked); setDownloaded(null); }} /><span>I reviewed the selected records</span></label>
          <button type="button" className="trace-button trace-export-button" disabled={busy !== null || !selected.size || !reviewed || unsaved || (intent === "sale_offer" && !uses.length)} onClick={() => { void exportPack(); }}>{busy === "export" ? "Preparing your export…" : intent === "sale_offer" ? "Download submission draft" : "Download personal export"}<svg aria-hidden="true" viewBox="0 0 16 16"><path d="M8 2v9m-4-4 4 4 4-4M3 12v2h10v-2" /></svg></button>
          {intent === "sale_offer" && <button type="button" className="trace-send-button" disabled={busy !== null || !selected.size || !reviewed || unsaved || !uses.length} onClick={() => { void exportPack(true); }}>Continue to submission <span aria-hidden="true">↗</span></button>}
          <p className="trace-pack-local"><span aria-hidden="true" />Downloads to your device. Nothing is uploaded.</p>
          <details className="trace-pack-details"><summary>What's in the export?<span aria-hidden="true">+</span></summary><p>Only selected records and their saved text, source roles, provenance hashes, and an integrity checksum. Unselected text and source filenames are excluded.</p><p>Each export can be up to 25 MiB. Export smaller selections for larger datasets.</p><p>You can reopen the JSON export here. Its checksum detects changes; it does not authenticate a source or make claims true.</p></details>
          {downloaded && <div role="status" className="trace-download-status"><strong>Downloaded {downloaded.selection.events} {downloaded.selection.events === 1 ? "record" : "records"} as {downloaded.intent === "sale_offer" ? "an offer draft" : "a personal copy"}.</strong><span>Your file is ready on this device.</span><details><summary>View checksum</summary><code>{downloaded.integrity.sha256}</code></details></div>}
        </aside>
      </div>
      {submissionPack && <section ref={preview} tabIndex={-1} className="trace-submission-preview" aria-label="Submission preview"><SubmissionForm key={submissionPack.id} pack={submissionPack} onCancel={() => setSubmissionPack(null)} /></section>}
      {selected.size > 0 && <a className="trace-mobile-pack-link" href="#trace-pack">Your selection <span>{selected.size} selected</span><span aria-hidden="true">↗</span></a>}

    </main>
    <SiteFooter />
  </div>;
}
