/** Public intake only: no owner archive, inference, personal APIs, or tool execution. */
import { MAX_PACK_EVENTS, parseTracePack, sha256 } from "../frontend/src/tracePack";
import type { OfferPayload } from "../frontend/src/marketApi";
import { equalHash, HttpError, IntakeStore, STATUSES, type Database } from "./store";
export interface Env {
    DB: Database;
    ASSETS?: {
        fetch(request: Request): Promise<Response>;
    };
    TRACE_BUYER_TOKEN?: string;
    TRACE_SUBMISSIONS_ENABLED?: string;
    TRACE_SUBMISSION_STORAGE_LIMIT_BYTES?: string;
    SUBMISSION_RATE_LIMITER?: {
        limit(options: {
            key: string;
        }): Promise<{
            success: boolean;
        }>;
    };
}
const MAX_PACK_BYTES = 4 * 1024 * 1024, MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const RECEIPT_SCHEMA = "agent-me.submission-receipt.v1";
const securityHeaders = { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY", "Permissions-Policy": "camera=(), microphone=(), geolocation=()", "Cross-Origin-Opener-Policy": "same-origin", "Strict-Transport-Security": "max-age=31536000" };
function json(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: { ...securityHeaders, "Content-Type": "application/json;charset=utf-8", "Cache-Control": "no-store" } }); }
function enabled(env: Env) { return env.TRACE_SUBMISSIONS_ENABLED === "true" && (env.TRACE_BUYER_TOKEN?.length ?? 0) >= 32 && Boolean(env.DB); }
function requireCondition(condition: unknown, message = "Invalid submission request fields."): asserts condition { if (!condition)
    throw new HttpError(422, message); }
function object(value: unknown, required: string[], optional: string[] = []): Record<string, unknown> {
    requireCondition(value !== null && typeof value === "object" && !Array.isArray(value));
    const row = value as Record<string, unknown>;
    requireCondition(required.every(key => Object.hasOwn(row, key)) && Object.keys(row).every(key => required.includes(key) || optional.includes(key)));
    return row;
}
function string(value: unknown, max: number, empty = false): value is string { return typeof value === "string" && value.length <= max && (empty || value.trim().length > 0); }
async function readBody(request: Request, max = 262144) {
    const length = request.headers.get("Content-Length");
    if (length && Number(length) > max)
        throw new HttpError(413, "Submission exceeds the upload limit.");
    const reader = request.body?.getReader();
    if (!reader)
        throw new HttpError(422, "A JSON request body is required.");
    const parts: Uint8Array[] = [];
    let lengthRead = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            lengthRead += value.byteLength;
            if (lengthRead > max) {
                await reader.cancel();
                throw new HttpError(413, "Submission exceeds the upload limit.");
            }
            parts.push(value);
        }
    }
    finally {
        reader.releaseLock();
    }
    const bytes = new Uint8Array(lengthRead);
    let offset = 0;
    for (const part of parts) {
        bytes.set(part, offset);
        offset += part.byteLength;
    }
    try {
        return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    }
    catch {
        throw new HttpError(422, "Invalid submission JSON.");
    }
}
async function authenticate(request: Request, env: Env, buyer: boolean) {
    const token = request.headers.get("Authorization");
    if (!token?.startsWith("Bearer "))
        throw new HttpError(401, "A valid access code is required.");
    const code = token.slice(7), hash = await sha256(code), buyerHash = await sha256(env.TRACE_BUYER_TOKEN!);
    if (buyer) {
        if (!equalHash(hash, buyerHash))
            throw new HttpError(401, "A valid buyer access key is required.");
    }
    else if (!/^[A-Za-z0-9_-]{43,128}$/.test(code) || equalHash(hash, buyerHash))
        throw new HttpError(401, "A valid private receipt code is required.");
    return hash;
}
function pagination(url: URL, defaultLimit: number) {
    function integer(key: string, fallback: number, min: number, max: number) { const raw = url.searchParams.get(key); if (raw === null)
        return fallback; requireCondition(/^\d+$/.test(raw)); const value = Number(raw); requireCondition(Number.isSafeInteger(value) && value >= min && value <= max); return value; }
    return { offset: integer("offset", 0, 0, Number.MAX_SAFE_INTEGER), limit: integer("limit", defaultLimit, 1, 100) };
}
async function route(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url), path = url.pathname, method = request.method;
    if ((path === "/health" || path === "/ready") && method === "GET") {
        if (path === "/ready") {
            if (!enabled(env))
                return json({ status: "not_ready" }, 503);
            await env.DB.prepare("SELECT 1 AS ok FROM submissions LIMIT 1").all();
        }
        return json({ status: "ok" });
    }
    if (path === "/api/v1/trace-market/status" && method === "GET")
        return json({ enabled: enabled(env), max_pack_bytes: MAX_PACK_BYTES, max_events: MAX_PACK_EVENTS, receipt_schema: RECEIPT_SCHEMA, reason: enabled(env) ? null : "Submissions are not currently available." });
    const buyer = path.startsWith("/api/v1/buyer/trace-submissions"), prefix = buyer ? "/api/v1/buyer/trace-submissions" : "/api/v1/trace-submissions";
    if (path === prefix || path.startsWith(prefix + "/")) {
        if (!enabled(env))
            throw new HttpError(503, "Submissions are not currently available.");
        if (method !== "GET" && method !== "POST")
            return json({ detail: "Method not allowed." }, 405);
        if (path === prefix && method === "POST" && !buyer && env.SUBMISSION_RATE_LIMITER) {
            const allowed = await env.SUBMISSION_RATE_LIMITER.limit({ key: request.headers.get("CF-Connecting-IP") || "unknown-client" });
            if (!allowed.success) {
                const response = json({ detail: "Too many submissions. Please wait a minute and try again." }, 429);
                response.headers.set("Retry-After", "60");
                return response;
            }
        }
        const receiptHash = await authenticate(request, env, buyer);
        const quota = Number(env.TRACE_SUBMISSION_STORAGE_LIMIT_BYTES ?? 536870912);
        const store = new IntakeStore(env.DB, Number.isSafeInteger(quota) && quota > 0 ? quota : 536870912);
        const suffix = path.slice(prefix.length);
        const match = /^\/([A-Za-z0-9_-]{1,100})(?:\/(pack|events|review|offers|respond|withdraw))?$/.exec(suffix);
        if (!suffix && !buyer && method === "POST") {
            const body = object(await readBody(request, MAX_UPLOAD_BYTES), ["pack", "title", "confirm_submission"], ["contributor_alias"]);
            requireCondition(string(body.title, 120) && string(body.contributor_alias ?? "", 80, true) && body.confirm_submission === true);
            if (new TextEncoder().encode(JSON.stringify(body.pack, null, 2)).byteLength > MAX_PACK_BYTES)
                throw new HttpError(413, "The selected activity exceeds the hosted 4 MiB limit. Submit a smaller selection.");
            let pack;
            try {
                pack = await parseTracePack(body.pack);
            }
            catch {
                throw new HttpError(422, "The activity export failed validation. Re-export your reviewed selection.");
            }
            requireCondition(pack.intent === "sale_offer" && pack.offer !== null, "Prepare a submission export before sending.");
            requireCondition(new Set(pack.offer.requested_uses).size === pack.offer.requested_uses.length);
            const result = await store.submit(pack, body.title as string, body.contributor_alias as string ?? "", receiptHash);
            return json({ submission: result.submission, receipt_schema: RECEIPT_SCHEMA }, result.created ? 201 : 200);
        }
        if (!suffix && buyer && method === "GET") {
            const { offset, limit } = pagination(url, 30);
            const status = url.searchParams.get("status") || "";
            requireCondition(!status || STATUSES.includes(status as typeof STATUSES[number]));
            return json(await store.listing(status, offset, limit));
        }
        if (!match)
            return json({ detail: "Not found." }, 404);
        const [, id, action] = match;
        if (!action && method === "GET")
            return json(await store.get(id, buyer ? undefined : receiptHash, buyer));
        if (action === "pack" && method === "GET")
            return json(await store.pack(id, buyer ? undefined : receiptHash));
        if (buyer && action === "events" && method === "GET") {
            const { offset, limit } = pagination(url, 25);
            const query = url.searchParams.get("query") ?? "";
            requireCondition(query.length <= 500);
            const needle = query.trim().toLocaleLowerCase();
            const pack = await store.pack(id);
            const events = pack.events.filter(event => !needle || event.content.toLocaleLowerCase().includes(needle));
            return json({ events: events.slice(offset, offset + limit), total: events.length, offset, limit });
        }
        if (method === "POST") {
            if (buyer && action === "review") {
                const body = object(await readBody(request), ["status"], ["note"]);
                requireCondition((body.status === "under_review" || body.status === "declined") && string(body.note ?? "", 4000, true));
                return json(await store.review(id, body.status as "under_review" | "declined", body.note as string ?? ""));
            }
            if (buyer && action === "offers") {
                const body = object(await readBody(request), ["amount_minor", "currency", "proposed_uses"], ["message"]);
                const uses = body.proposed_uses;
                requireCondition(Number.isInteger(body.amount_minor) && Number(body.amount_minor) >= 1 && Number(body.amount_minor) <= 1000000000 && ["CAD", "USD", "EUR", "GBP"].includes(body.currency as string));
                requireCondition(Array.isArray(uses) && uses.length > 0 && uses.length <= 3 && new Set(uses).size === uses.length && uses.every(use => ["stack_optimization", "evaluation", "small_model_training"].includes(use)) && string(body.message ?? "", 4000, true));
                return json(await store.offer(id, { ...body, message: body.message ?? "" } as OfferPayload));
            }
            if (!buyer && action === "respond") {
                const body = object(await readBody(request), ["offer_id", "decision"]);
                requireCondition(string(body.offer_id, 100) && (body.decision === "accept" || body.decision === "decline"));
                return json(await store.respond(id, receiptHash, body.offer_id, body.decision));
            }
            if (!buyer && action === "withdraw") {
                object(await readBody(request), []);
                return json(await store.withdraw(id, receiptHash));
            }
        }
        return json({ detail: "Not found." }, 404);
    }
    if (path.startsWith("/api/") || ["/docs", "/redoc", "/openapi.json"].includes(path))
        return json({ detail: "Not found." }, 404);
    if (env.ASSETS && (method === "GET" || method === "HEAD")) {
        const response = await env.ASSETS.fetch(request);
        const copy = new Response(response.body, response);
        for (const [key, value] of Object.entries(securityHeaders))
            copy.headers.set(key, value);
        return copy;
    }
    return json({ detail: "Not found." }, 404);
}
export default { async fetch(request: Request, env: Env) { try {
        return await route(request, env);
    }
    catch (reason) {
        return reason instanceof HttpError ? json({ detail: reason.message }, reason.status) : json({ detail: "Submission storage is temporarily unavailable. Please try again." }, 503);
    } } };
