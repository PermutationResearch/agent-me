import type { PackedEvent, RequestedUse, TracePack } from "./traceTypes";

export type SubmissionStatus = "submitted" | "under_review" | "offered" | "accepted_pending_agreement" | "declined" | "withdrawn";
export type Currency = "CAD" | "USD" | "EUR" | "GBP";
export type Offer = { id: string; amount_minor: number; currency: Currency; proposed_uses: RequestedUse[]; message: string; created_at: string; status: "open" | "superseded" | "accepted" | "declined" };
export type SubmissionSummary = { id: string; title: string; contributor_alias: string; status: SubmissionStatus; created_at: string; updated_at: string; pack_sha256: string; event_count: number; conversation_count: number; sources: Record<string, number>; requested_uses: RequestedUse[]; current_offer: Offer | null; payment_status: "not_started" };
export type SubmissionDetail = SubmissionSummary & { offers: Offer[]; contributor_note: string };
export type BuyerDetail = SubmissionDetail & { review_notes: { id: string; note: string; created_at: string }[] };
export type MarketStatus = { enabled: boolean; max_pack_bytes: number; max_events: number; receipt_schema: "agent-me.submission-receipt.v1"; reason: string | null };
export type TraceReceipt = { schema: "agent-me.submission-receipt.v1"; submission_id: string; access_token: string };
export type InboxPage = { submissions: SubmissionSummary[]; total: number; counts: Record<SubmissionStatus, number> };
export type EventPage = { events: PackedEvent[]; total: number; offset: number; limit: number };
export type SubmissionPayload = { pack: TracePack; title: string; contributor_alias: string; confirm_submission: true };
export type OfferPayload = { amount_minor: number; currency: Currency; proposed_uses: RequestedUse[]; message: string };
export class MarketError extends Error {
  constructor(public status: number, message: string) { super(message); this.name = "MarketError"; }
}
async function request<T>(path: string, token?: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/v1/${path}`, { method: body === undefined ? "GET" : "POST", headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), cache: "no-store", signal });
  } catch (reason) {
    if (signal?.aborted) throw reason;
    throw new MarketError(0, path === "trace-submissions" ? "Could not reach Agent-Me. Your pack has not been confirmed received. Try again with the same receipt code." : "Could not reach Agent-Me. Check the local review service and try again.");
  }
  if (!response.ok) {
    let detail = "The request could not be completed. Please try again.";
    try { const data: unknown = await response.json(); if (data && typeof data === "object" && "detail" in data && typeof data.detail === "string") detail = data.detail; } catch { /* A proxy can return a non-JSON error. */ }
    throw new MarketError(response.status, detail);
  }
  return response.json() as Promise<T>;
}
function segment(value: string) { return encodeURIComponent(value); }
function query(values: Record<string, string | number | undefined>) {
  const params = new URLSearchParams(); Object.entries(values).forEach(([key, value]) => { if (value !== undefined && value !== "") params.set(key, String(value)); });
  return params.size ? `?${params}` : "";
}
export function createReceiptCode() { const bytes = crypto.getRandomValues(new Uint8Array(32)); return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
export const marketStatus = (signal?: AbortSignal) => request<MarketStatus>("trace-market/status", undefined, undefined, signal);
export const submitPack = (payload: SubmissionPayload, code: string, signal?: AbortSignal) => request<{ submission: SubmissionDetail; receipt_schema: "agent-me.submission-receipt.v1" }>("trace-submissions", code, payload, signal);
export const getSubmission = (id: string, code: string, signal?: AbortSignal) => request<SubmissionDetail>(`trace-submissions/${segment(id)}`, code, undefined, signal);
export const getSubmissionPack = (id: string, code: string, signal?: AbortSignal) => request<TracePack>(`trace-submissions/${segment(id)}/pack`, code, undefined, signal);
export const respondToOffer = (id: string, code: string, body: { offer_id: string; decision: "accept" | "decline" }, signal?: AbortSignal) => request<SubmissionDetail>(`trace-submissions/${segment(id)}/respond`, code, body, signal);
export const withdrawSubmission = (id: string, code: string, signal?: AbortSignal) => request<SubmissionDetail>(`trace-submissions/${segment(id)}/withdraw`, code, {}, signal);
export const buyerInbox = (token: string, filters: { status?: string; offset?: number; limit?: number } = {}, signal?: AbortSignal) => request<InboxPage>(`buyer/trace-submissions${query(filters)}`, token, undefined, signal);
export const buyerSubmission = (token: string, id: string, signal?: AbortSignal) => request<BuyerDetail>(`buyer/trace-submissions/${segment(id)}`, token, undefined, signal);
export const buyerEvents = (token: string, id: string, filters: { query?: string; offset?: number; limit?: number } = {}, signal?: AbortSignal) => request<EventPage>(`buyer/trace-submissions/${segment(id)}/events${query(filters)}`, token, undefined, signal);
export const buyerPack = (token: string, id: string, signal?: AbortSignal) => request<TracePack>(`buyer/trace-submissions/${segment(id)}/pack`, token, undefined, signal);
export const markReview = (token: string, id: string, body: { status: "under_review" | "declined"; note: string }, signal?: AbortSignal) => request<BuyerDetail>(`buyer/trace-submissions/${segment(id)}/review`, token, body, signal);
export const makeOffer = (token: string, id: string, body: OfferPayload, signal?: AbortSignal) => request<BuyerDetail>(`buyer/trace-submissions/${segment(id)}/offers`, token, body, signal);
