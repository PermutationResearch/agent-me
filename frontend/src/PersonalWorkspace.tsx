import { FormEvent, useCallback, useState } from "react";
import { OptimizationPanel } from "./OptimizationPanel";

type Entry = { id: string; kind: string; key: string; content: string; status: string; source: string; updated_at: string };
type Turn = { id: string; role: string; content: string };
type CorpusStatus = { configured: boolean; verified: boolean; read_only: boolean; review_only: boolean; chat_grounding_enabled?: boolean; includes_work?: boolean; conversations?: number; owner_documents?: number; sources?: string[] };
type CorpusEvidence = { evidence_id: string; source: string; timestamp: string | null; excerpt: string; trust: string; author_role: string; review_only: boolean };
const base = (import.meta.env.VITE_API_BASE_URL ?? "").trim().replace(/\/+$/, "");

function memoryActionName(label: string, entryKey: string, position: number) {
  return `${label}: ${entryKey}, memory ${position}`;
}

export function PersonalWorkspace({ external, maxQuestionChars = 8000 }: { external: boolean; maxQuestionChars?: number }) {
  const questionLimit = Math.min(maxQuestionChars, 8000);
  const [token, setToken] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [history, setHistory] = useState<Turn[]>([]);
  const [corpusStatus, setCorpusStatus] = useState<CorpusStatus | null>(null);
  const [corpusQuery, setCorpusQuery] = useState("");
  const [corpusResults, setCorpusResults] = useState<CorpusEvidence[]>([]);
  const [kind, setKind] = useState("fact");
  const [key, setKey] = useState("identity.name");
  const [content, setContent] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<{ id: string; ids: string[] } | null>(null);

  const request = useCallback(async (path: string, body?: unknown) => {
    const response = await fetch(`${base}/api/v1/personal${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json();
    if (response.status === 409 && Array.isArray(data.detail?.conflict_ids)) {
      setConflict({ id: path.split("/")[2], ids: data.detail.conflict_ids });
      throw new Error("Conflicting memory: review replacement below.");
    }
    if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Request failed");
    return data;
  }, [token]);
  async function refresh() {
    const [items, turns, status] = await Promise.all([request("/entries"), request("/history"), request("/corpus/status")]);
    setEntries(items); setHistory(turns); setCorpusStatus(status);
  }
  async function run(action: () => Promise<void>) {
    setBusy(true); setError("");
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : "Request failed"); }
    finally { setBusy(false); }
  }
  function lock() {
    setToken(""); setUnlocked(false); setEntries([]); setHistory([]); setCorpusStatus(null);
    setContent(""); setQuestion(""); setCorpusQuery(""); setCorpusResults([]); setConflict(null); setError(""); setEditing(null);
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      await request(editing ? `/entries/${editing}/edit` : "/entries", { kind, key, content });
      setContent(""); setEditing(null); await refresh();
    });
  }
  return <section className={`personal-workspace ${unlocked ? "is-unlocked" : "is-locked"}`} aria-label="Private workspace">
    <div className="personal-heading">
      <div>
        <span className="section-kicker">Private memory</span>
        <h2>Private twin</h2>
      </div>
      <span className={`workspace-status ${unlocked ? "online" : "locked"}`}>
        <span aria-hidden="true" />{unlocked ? `${entries.length} memories` : "Locked"}
      </span>
    </div>
    <p className="personal-intro">Your profile, conversations, and memories are stored locally. Confirmed memories and connected historical evidence can ground answers.</p>
    <p className="privacy-disclosure"><span aria-hidden="true" />{external
      ? "Model connected: private-chat questions, relevant memories, knowledge, and work-archive excerpts are sent to the configured model provider."
      : "Local extractive mode: no external model is called. Connect a model provider to generate personalized responses."}</p>
    {!unlocked ? <form className="unlock-form" onSubmit={e => { e.preventDefault(); void run(async () => { await refresh(); setUnlocked(true); }); }}>
      <label>Workspace token<input type="password" autoComplete="off" value={token} onChange={e => setToken(e.target.value)} required /></label>
      <button disabled={busy}>Unlock</button>
    </form> : <>
      <div className="personal-toolbar">
        <span>Owner workspace</span>
        <button className="button-secondary" disabled={busy} onClick={lock}>Lock</button>
      </div>
      <section className="memory-editor" aria-labelledby="memory-heading">
      <div className="subsection-heading">
        <div>
          <span className="section-kicker">Review queue</span>
          <h3 id="memory-heading">Profile & memories</h3>
        </div>
        <span>{entries.length} total</span>
      </div>
      <form className="memory-form" onSubmit={save}>
        <label>Type<select value={kind} onChange={e => setKind(e.target.value)}>
          <option value="fact">Fact</option><option value="preference">Preference</option>
          <option value="event">Event</option><option value="decision">Decision</option>
          <option value="project">Project</option><option value="skill">Skill</option>
          <option value="working_pattern">Working pattern</option>
        </select></label>
        <label>Key<input maxLength={100} required value={key} onChange={e => setKey(e.target.value)} placeholder="identity.name / goals.current / response.style" /></label>
        <label>Content<textarea maxLength={2000} required value={content} onChange={e => setContent(e.target.value)} /></label>
        <div className="form-actions">
          <button disabled={busy}>{editing ? "Save edit as pending" : "Add candidate"}</button>
          {editing && <button className="button-secondary" type="button" onClick={() => { setEditing(null); setContent(""); }}>Cancel</button>}
        </div>
      </form>
      <ul className="memory-list">{entries.map((entry, index) => <li key={entry.id}>
        <div className="memory-meta">
          <strong>{entry.key}</strong>
          <span>{entry.kind}</span>
          <span className={entry.status === "confirmed" ? "confirmed" : "pending"}>{entry.status === "confirmed" ? "Confirmed" : "Pending"}</span>
        </div>
        <p>{entry.content}</p><small>{entry.source} · {entry.updated_at}</small>
        <div className="memory-actions">
          {entry.status === "pending" && <button aria-label={memoryActionName("Confirm", entry.key, index + 1)} disabled={busy} onClick={() => void run(async () => { setConflict(null); await request(`/entries/${entry.id}/confirm`, { replace_ids: [] }); await refresh(); })}>Confirm</button>}
          <button className="button-secondary" aria-label={memoryActionName("Edit", entry.key, index + 1)} disabled={busy} onClick={() => { setEditing(entry.id); setKind(entry.kind); setKey(entry.key); setContent(entry.content); }}>Edit</button>
          <button className="button-danger" aria-label={memoryActionName("Delete", entry.key, index + 1)} disabled={busy} onClick={() => void run(async () => { await request(`/entries/${entry.id}/delete`, {}); setConflict(null); await refresh(); })}>Delete</button>
        </div>
      </li>)}</ul>
      {conflict && <aside role="alert"><p>Replace these confirmed memories?</p>
        {entries.filter(e => conflict.ids.includes(e.id)).map(e => <p key={e.id}>{e.key}: {e.content}</p>)}
        <button disabled={busy} onClick={() => void run(async () => { await request(`/entries/${conflict.id}/confirm`, { replace_ids: conflict.ids }); setConflict(null); await refresh(); })}>Replace</button>
        <button className="button-secondary" onClick={() => setConflict(null)}>Cancel</button>
      </aside>}
      </section>
      <section className="corpus-review" aria-labelledby="corpus-heading">
        <div className="subsection-heading">
          <div>
            <span className="section-kicker">Historical evidence</span>
            <h3 id="corpus-heading">Work archive</h3>
          </div>
          <span>{corpusStatus?.verified ? "Verified · read only" : "Not connected"}</span>
        </div>
        {corpusStatus?.configured ? <>
          <p className="section-help">
            Search {corpusStatus.conversations?.toLocaleString() ?? 0} archive records. Results preserve author labels, are redacted and untrusted, and never become memories automatically. {corpusStatus.chat_grounding_enabled ? "Relevant excerpts also ground private-chat answers." : "Archive search is separate from private-chat answers."}
          </p>
          <form className="corpus-search-form" onSubmit={e => { e.preventDefault(); void run(async () => {
            const data = await request("/corpus/search", { query: corpusQuery });
            setCorpusResults(data.results);
          }); }}>
            <label>Search historical evidence<input required maxLength={questionLimit} value={corpusQuery} onChange={e => setCorpusQuery(e.target.value)} placeholder="How do I usually verify releases?" /></label>
            <button disabled={busy}>Search</button>
          </form>
          <ul className="corpus-results">{corpusResults.map(result => <li key={result.evidence_id}>
            <div className="memory-meta"><strong>{result.source}</strong><span>{result.author_role === "owner" ? "Owner" : result.author_role}</span><span>Historical evidence</span></div>
            <p>{result.excerpt}</p>
            <small>{result.timestamp ?? "Timestamp unavailable"} · untrusted historical evidence</small>
          </li>)}</ul>
        </> : <p className="section-help">No verified corpus is configured. Add its absolute path and SHA-256 to the private backend environment.</p>}
      </section>
      <OptimizationPanel request={request} />
      <section className="private-chat" aria-labelledby="private-chat-heading">
      <div className="subsection-heading">
        <div>
          <span className="section-kicker">Conversation</span>
          <h3 id="private-chat-heading">Private chat</h3>
        </div>
      </div>
      <p className="section-help">Use “Remember: …” to create a preference candidate, then confirm it above. Other information can be added manually.</p>
      <div className="private-history">{history.map(turn => <article key={turn.id}><strong>{turn.role}</strong><p>{turn.content}</p></article>)}</div>
      <form className="private-chat-form" onSubmit={e => { e.preventDefault(); if (busy || question.length > questionLimit) return; void run(async () => { await request("/chat", { question }); setQuestion(""); await refresh(); }); }}>
        <label>Private question<textarea required maxLength={questionLimit} value={question} onChange={e => setQuestion(e.target.value)} /></label>
        <button disabled={busy || question.length > questionLimit}>Send</button>
      </form>
      <div className="workspace-actions">
        <button className="button-secondary" disabled={busy} onClick={() => void run(async () => { await request("/history/clear", {}); await refresh(); })}>Clear all chat</button>
        <button className="button-secondary" disabled={busy} onClick={() => void run(async () => {
          const data = await request("/export");
          const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
          const link = document.createElement("a"); link.href = url; link.download = "private-twin-export.json"; link.click(); URL.revokeObjectURL(url);
        })}>Export private data</button>
      </div>
      </section>
    </>}
    {busy && <p role="status">Working…</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
