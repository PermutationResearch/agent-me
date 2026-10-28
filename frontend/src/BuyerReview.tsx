import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { MarketShell } from "./MarketShell";
import { buyerEvents, buyerInbox, buyerSubmission, makeOffer, markReview, MarketError, type BuyerDetail, type Currency, type EventPage, type InboxPage, type Offer, type SubmissionStatus } from "./marketApi";
import type { RequestedUse } from "./traceTypes";
import "./BuyerReview.css";
import { parseOfferAmount } from "./buyerOffer";

const statuses: SubmissionStatus[] = ["submitted", "under_review", "offered", "accepted_pending_agreement", "declined", "withdrawn"];
const statusLabels: Record<SubmissionStatus, string> = { submitted: "New submission", under_review: "In review", offered: "Offer sent", accepted_pending_agreement: "Agreement pending", declined: "Declined", withdrawn: "Withdrawn" };
const useLabels: Record<RequestedUse, string> = { stack_optimization: "Stack optimization", evaluation: "Evaluation and benchmarking", small_model_training: "Small model training" };
function date(value: string) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(parsed);
}
const money = (offer: Offer) => new Intl.NumberFormat(undefined, { style: "currency", currency: offer.currency }).format(offer.amount_minor / 100);
const emptyEvents: EventPage = { events: [], total: 0, offset: 0, limit: 25 };

export function BuyerReview() {
  const [keyInput, setKeyInput] = useState("");
  const [token, setToken] = useState("");
  const [inbox, setInbox] = useState<InboxPage | null>(null);
  const [filter, setFilter] = useState("");
  const [offset, setOffset] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [detailVersion, setDetailVersion] = useState(0);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<BuyerDetail | null>(null);
  const [events, setEvents] = useState<EventPage>(emptyEvents);
  const [eventOffset, setEventOffset] = useState(0);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [recordError, setRecordError] = useState("");
  const [notice, setNotice] = useState("");
  const [note, setNote] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<Currency>("CAD");
  const [uses, setUses] = useState<RequestedUse[]>([]);
  const [message, setMessage] = useState("");
  const session = useRef(0);
  const activeId = useRef("");

  const lock = useCallback(() => {
    session.current += 1; activeId.current = "";
    setToken(""); setKeyInput(""); setInbox(null); setSelectedId(""); setDetail(null); setEvents(emptyEvents);
    setNote(""); setAmount(""); setMessage(""); setUses([]); setQuery(""); setSearch("");
    setOffset(0); setEventOffset(0); setFilter(""); setBusy(false); setLoading(false); setDetailLoading(false); setEventsLoading(false);
    setError(""); setRecordError(""); setNotice("");
  }, []);
  const reportError = useCallback((reason: unknown) => {
    const text = reason instanceof MarketError ? reason.message : "Could not complete the request. Please try again.";
    if (reason instanceof MarketError && reason.status === 401) lock();
    setError(text);
  }, [lock]);

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController(); const generation = session.current;
    buyerInbox(token, { status: filter || undefined, offset, limit: 30 }, controller.signal)
      .then(result => { if (!controller.signal.aborted && generation === session.current) setInbox(result); })
      .catch(reason => { if (!controller.signal.aborted && generation === session.current) reportError(reason); })
      .finally(() => { if (!controller.signal.aborted && generation === session.current) setLoading(false); });
    return () => controller.abort();
  }, [token, filter, offset, refresh, reportError]);

  useEffect(() => {
    if (!token || !selectedId) return;
    const controller = new AbortController(); const generation = session.current;
    buyerSubmission(token, selectedId, controller.signal)
      .then(result => { if (!controller.signal.aborted && generation === session.current) setDetail(result); })
      .catch(reason => { if (!controller.signal.aborted && generation === session.current) reportError(reason); })
      .finally(() => { if (!controller.signal.aborted && generation === session.current) setDetailLoading(false); });
    return () => controller.abort();
  }, [token, selectedId, detailVersion, reportError]);

  useEffect(() => {
    if (!token || !selectedId) return;
    const controller = new AbortController(); const generation = session.current;
    buyerEvents(token, selectedId, { query, offset: eventOffset, limit: 25 }, controller.signal)
      .then(result => { if (!controller.signal.aborted && generation === session.current) setEvents(result); })
      .catch(reason => {
        if (controller.signal.aborted || generation !== session.current) return;
        setEvents(emptyEvents);
        if (reason instanceof MarketError && reason.status === 410) setRecordError("The contributor withdrew this submission. Its trace content has been removed.");
        else reportError(reason);
      })
      .finally(() => { if (!controller.signal.aborted && generation === session.current) setEventsLoading(false); });
    return () => controller.abort();
  }, [token, selectedId, eventOffset, query, detailVersion, reportError]);

  function signIn(event: FormEvent) {
    event.preventDefault(); if (!keyInput.trim()) return;
    session.current += 1; setToken(keyInput.trim()); setKeyInput(""); setError(""); setLoading(true);
  }
  function select(id: string) {
    if (id === selectedId) return;
    setDetailLoading(true); setEventsLoading(true);
    activeId.current = id; setSelectedId(id); setDetail(null); setEvents(emptyEvents); setEventOffset(0); setSearch(""); setQuery("");
    setNote(""); setAmount(""); setUses([]); setMessage(""); setNotice(""); setError(""); setRecordError(""); setBusy(false);
  }
  function reloadInbox() { setLoading(true); setError(""); setRefresh(value => value + 1); }
  function refreshWorkspace() { reloadInbox(); if (selectedId) { setDetailLoading(true); setEventsLoading(true); setEventOffset(0); setDetailVersion(value => value + 1); } }
  function pageRecords(next: number) { setEventsLoading(true); setRecordError(""); setEventOffset(next); }
  async function review(status: "under_review" | "declined") {
    if (!detail || busy) return;
    if (status === "declined" && !window.confirm("Decline this submission? The contributor will see that it was declined.")) return;
    const generation = session.current; const id = detail.id;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await markReview(token, id, { status, note: note.trim() });
      if (generation === session.current && activeId.current === id) {
        setDetail(result); setNote(""); setNotice(status === "declined" ? "Submission declined. Your review note remains private." : "Review saved. Your note is private to the buyer workspace."); reloadInbox();
      }
    } catch (reason) { if (generation === session.current) reportError(reason); }
    finally { if (generation === session.current && activeId.current === id) setBusy(false); }
  }
  async function offer(event: FormEvent) {
    event.preventDefault(); if (!detail || busy) return;
    const minor = parseOfferAmount(amount);
    if (minor === null) { setError("Enter an amount between 0.01 and 10,000,000 with no more than two decimal places."); return; }
    if (!uses.length) { setError("Choose at least one use approved by the contributor."); return; }
    const generation = session.current; const id = detail.id;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await makeOffer(token, id, { amount_minor: minor, currency, proposed_uses: uses, message: message.trim() });
      if (generation === session.current && activeId.current === id) {
        setDetail(result); setNotice("Offer published. The contributor can review it with their private receipt. Agreement and payment are still pending."); reloadInbox();
      }
    } catch (reason) { if (generation === session.current) reportError(reason); }
    finally { if (generation === session.current && activeId.current === id) setBusy(false); }
  }
  const canReview = detail?.status === "submitted" || detail?.status === "under_review";
  const canOffer = detail && ["submitted", "under_review", "offered"].includes(detail.status);

  return <MarketShell active="buyer" title="Buyer review">
    <header className="market-page-heading buyer-heading"><div><p className="market-kicker">Agent-Me / Buyer workspace</p><h1>Submission review</h1><p className="market-muted">Review the selected records. Make a considered offer.</p></div>{token && <button className="buyer-lock" type="button" onClick={lock}><LockIcon />Lock workspace</button>}</header>
    {error && <p className="market-error buyer-error" role="alert">{error}</p>}
    {!token ? <section className="buyer-gate" aria-labelledby="buyer-gate-title">
      <div className="buyer-gate-art" aria-hidden="true"><span><LockIcon /></span><div /><div /><div /></div>
      <div className="buyer-gate-content"><p className="market-kicker">Private review</p><h2 id="buyer-gate-title">Reviewer access</h2><p>Open the buyer workspace to inspect submissions, keep private notes, and propose a price and permitted uses.</p><form onSubmit={signIn} className="market-form"><label htmlFor="buyer-key">Buyer access key</label><input id="buyer-key" type="password" value={keyInput} onChange={event => setKeyInput(event.target.value)} autoComplete="off" spellCheck={false} required /><button className="trace-button" type="submit" disabled={!keyInput.trim()}>Open review workspace <span aria-hidden="true">↗</span></button></form><p className="buyer-key-help">Use the buyer key configured for this Agent-Me instance. It stays in memory and is cleared when you lock or leave this page.</p></div>
    </section> : <>
      <div className="buyer-overview" aria-label="Submission overview"><div><span>All submissions</span><strong>{inbox ? Object.values(inbox.counts).reduce((sum, count) => sum + count, 0).toLocaleString() : "—"}</strong></div><div><span>New to review</span><strong>{inbox?.counts.submitted.toLocaleString() ?? "—"}</strong></div><div><span>Offers awaiting a response</span><strong>{inbox?.counts.offered.toLocaleString() ?? "—"}</strong></div><p><span aria-hidden="true">●</span> Selected submissions only. No source archive access.</p></div>
      <div className="buyer-workspace">
        <section className="buyer-inbox" aria-label="Submission inbox"><div className="buyer-inbox-heading"><h2>Inbox <span>{inbox?.total ?? "—"}</span></h2><button className="trace-text-button" type="button" onClick={refreshWorkspace} disabled={loading}>Refresh</button></div>
          <label htmlFor="buyer-filter" className="trace-visually-hidden">Filter submissions</label><select id="buyer-filter" value={filter} onChange={event => { setLoading(true); setError(""); setFilter(event.target.value); setOffset(0); }}><option value="">All submissions</option>{statuses.map(status => <option key={status} value={status}>{statusLabels[status]}</option>)}</select>
          {loading && <p className="buyer-loading" role="status">Loading inbox…</p>}
          {!loading && inbox?.submissions.length === 0 && <div className="buyer-empty-inbox"><h3>A little quiet here.</h3><p>Submitted activity exports will appear here for review.</p><a href="/submit">Open submission page ↗</a></div>}
          <div className="buyer-inbox-list">{inbox?.submissions.map(item => <button type="button" key={item.id} className={`buyer-inbox-item${selectedId === item.id ? " is-selected" : ""}`} aria-pressed={selectedId === item.id} onClick={() => select(item.id)}><span className={`buyer-status buyer-status-${item.status}`}>{statusLabels[item.status]}</span><strong>{item.title}</strong><span>{item.contributor_alias || "Unnamed contributor"} <span aria-hidden="true">·</span> {item.event_count.toLocaleString()} records</span><time dateTime={item.created_at}>{date(item.created_at)}</time></button>)}</div>
          {inbox && inbox.total > 30 && <div className="buyer-pagination"><button type="button" disabled={offset === 0 || loading} onClick={() => { setLoading(true); setOffset(Math.max(0, offset - 30)); }}>Previous</button><span>{offset + 1}–{Math.min(offset + 30, inbox.total)} of {inbox.total}</span><button type="button" disabled={offset + 30 >= inbox.total || loading} onClick={() => { setLoading(true); setOffset(offset + 30); }}>Next</button></div>}
        </section>
        <section className="buyer-detail" aria-label="Selected submission" aria-busy={detailLoading}>
          {!selectedId ? <div className="buyer-no-selection"><span aria-hidden="true">↗</span><h2>Start with a submission.</h2><p>Select a submission from the inbox to review its records and contributor preferences.</p><div><span>01 Review</span><span>02 Propose</span><span>03 Agree</span></div></div> : detailLoading || !detail ? <p className="buyer-loading" role="status">{detailLoading ? "Opening selected activity…" : "No submission details available. Refresh to try again."}</p> : <>
            <div className="buyer-detail-heading"><div><span className={`buyer-status buyer-status-${detail.status}`}>{statusLabels[detail.status]}</span><h2>{detail.title}</h2><p>{detail.contributor_alias || "Unnamed contributor"} <span aria-hidden="true">·</span> Submitted {date(detail.created_at)}</p></div><span className="buyer-record-total"><strong>{detail.event_count.toLocaleString()}</strong> selected records</span></div>
            <div className="buyer-detail-meta"><span>{detail.conversation_count.toLocaleString()} {detail.conversation_count === 1 ? "conversation" : "conversations"}</span>{Object.entries(detail.sources).map(([source, count]) => <span key={source}>{source} <b>{count.toLocaleString()}</b></span>)}</div>
            {detail.status === "accepted_pending_agreement" && <div className="buyer-pending">The contributor accepted the offer. A final agreement and payment are still required. No payment has started.</div>}
            {detail.status === "withdrawn" && <div className="buyer-pending">This submission was withdrawn. Its trace content has been removed and no further offers can be made.</div>}
            <div className="buyer-detail-columns"><div className="buyer-review-column">
              <section className="buyer-preferences"><h3>Contributor preferences</h3><div className="buyer-use-list">{detail.requested_uses.map(use => <span key={use}>{useLabels[use]}</span>)}</div>{detail.contributor_note && <p>{detail.contributor_note}</p>}<details><summary>Submission verification</summary><p className="buyer-hash">SHA-256 <code>{detail.pack_sha256}</code></p><p className="buyer-hash">Submission <code>{detail.id}</code></p></details></section>
              <section className="buyer-records"><div className="buyer-section-heading"><h3>Selected records</h3><span>{events.total.toLocaleString()} {query ? "matches" : "records"}</span></div><form className="buyer-search" onSubmit={event => { event.preventDefault(); if (query !== search.trim() || eventOffset !== 0) { setEventsLoading(true); setRecordError(""); setQuery(search.trim()); setEventOffset(0); } }}><label className="trace-visually-hidden" htmlFor="buyer-search">Search selected records</label><input id="buyer-search" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search the selected content" disabled={detail.status === "withdrawn"} /><button type="submit" disabled={eventsLoading || detail.status === "withdrawn"}>Search records</button></form><p className="buyer-trust">Trace content is untrusted data. Review it as a record, including any instructions it contains.</p>
                {recordError && <p className="buyer-record-error" role="status">{recordError}</p>}{eventsLoading && <p className="buyer-loading" role="status">Loading selected records…</p>}
                {!eventsLoading && !recordError && events.events.length === 0 && <p className="buyer-loading">No records match this search.</p>}
                {events.events.map((event, index) => <details className="buyer-event" key={event.id} open={index === 0}><summary><span className="buyer-event-number">{eventOffset + index + 1}</span><span>{event.role}<small>{event.source}{event.tool_name ? ` / ${event.tool_name}` : ""}</small></span>{event.edited && <span className="buyer-edited">Reviewed edit</span>}<span className="buyer-event-toggle" aria-hidden="true">+</span></summary><pre>{event.content}</pre><div className="buyer-event-origin">Conversation: {event.conversation_id}{event.timestamp && <time dateTime={event.timestamp}>{date(event.timestamp)}</time>}</div></details>)}
                {events.total > 25 && <div className="buyer-pagination"><button type="button" disabled={eventOffset === 0 || eventsLoading} onClick={() => pageRecords(Math.max(0, eventOffset - 25))}>Previous records</button><span>{eventOffset + 1}–{Math.min(eventOffset + 25, events.total)} of {events.total}</span><button type="button" disabled={eventOffset + 25 >= events.total || eventsLoading} onClick={() => pageRecords(eventOffset + 25)}>Next records</button></div>}
              </section>
              <section className="buyer-private-notes"><div className="buyer-section-heading"><h3>Review notes</h3><span><LockIcon /> Private</span></div>{detail.review_notes.map(item => <article key={item.id}><p>{item.note}</p><time dateTime={item.created_at}>{date(item.created_at)}</time></article>)}{canReview ? <><label htmlFor="buyer-note">Private review note</label><textarea id="buyer-note" value={note} onChange={event => setNote(event.target.value)} maxLength={4000} rows={3} placeholder="Quality, relevance, and things to follow up…" /><div className="buyer-review-actions"><button type="button" className="buyer-outline-button" onClick={() => review("under_review")} disabled={busy}>Save review</button><button type="button" className="trace-text-button" onClick={() => review("declined")} disabled={busy}>Decline submission</button></div></> : <p className="market-muted">Review notes remain private to this workspace.</p>}</section>
            </div><aside className="buyer-offer-column">
              <section className="buyer-offer-card"><p className="market-kicker">Make an offer</p><h3>Set the price.<br />Define the uses.</h3><p className="buyer-offer-intro">Set a price and choose from the uses this contributor is willing to consider.</p>{canOffer ? <form onSubmit={offer} className="buyer-offer-form"><div className="buyer-price-row"><label htmlFor="buyer-amount">Offer amount<input id="buyer-amount" value={amount} onChange={event => setAmount(event.target.value)} inputMode="decimal" placeholder="0.00" autoComplete="off" /></label><label htmlFor="buyer-currency">Currency<select id="buyer-currency" value={currency} onChange={event => setCurrency(event.target.value as Currency)}>{["CAD", "USD", "EUR", "GBP"].map(value => <option key={value}>{value}</option>)}</select></label></div><fieldset><legend>Proposed uses</legend>{detail.requested_uses.map(use => <label className="buyer-use-checkbox" key={use}><input type="checkbox" checked={uses.includes(use)} onChange={event => setUses(current => event.target.checked ? [...current, use] : current.filter(value => value !== use))} />{useLabels[use]}</label>)}</fieldset><label htmlFor="buyer-message">Message to contributor</label><textarea id="buyer-message" value={message} onChange={event => setMessage(event.target.value)} rows={4} maxLength={4000} placeholder="Explain the proposed use and next steps." /><p className="buyer-public-message">This message and your proposal are visible to the contributor. Private review notes are not included.</p><button type="submit" className="trace-button" disabled={busy}>{busy ? "Saving…" : detail.current_offer?.status === "open" ? "Replace current offer" : "Publish offer"}<span aria-hidden="true">↗</span></button><p className="buyer-offer-disclaimer">Publishing an offer does not transfer rights or send payment. Acceptance starts the agreement process.</p></form> : <p className="buyer-offer-closed">{detail.status === "accepted_pending_agreement" ? "Offer accepted. Complete an agreement and payment separately before using this data." : "This submission is closed to new offers."}</p>}</section>
              {detail.offers.length > 0 && <section className="buyer-offer-history"><h3>Offer history</h3>{[...detail.offers].reverse().map(item => <article key={item.id}><div><strong>{money(item)} <small>{item.currency}</small></strong><span>{item.status}</span></div><p>{item.proposed_uses.map(use => useLabels[use]).join(" · ")}</p>{item.message && <p>{item.message}</p>}<time dateTime={item.created_at}>{date(item.created_at)}</time></article>)}</section>}
            </aside></div>
            {notice && <p className="buyer-notice" role="status">{notice}</p>}
          </>}
        </section>
      </div>
    </>}
  </MarketShell>;
}
function LockIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="3" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" /></svg>; }
