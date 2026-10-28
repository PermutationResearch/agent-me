// @vitest-environment node
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, expect, it } from "vitest";
import worker, { type Env } from "./worker";
import type { Database, Statement } from "./store";
class LocalStatement implements Statement {
    constructor(readonly db: DatabaseSync, readonly sql: string, readonly args: (string | number | null)[] = []) { }
    bind(...args: (string | number | null)[]) { return new LocalStatement(this.db, this.sql, args); }
    async first<T>() { return (this.db.prepare(this.sql).get(...this.args) ?? null) as T | null; }
    async all<T>() { return { results: this.db.prepare(this.sql).all(...this.args) as T[] }; }
    async run() { const result = this.db.prepare(this.sql).run(...this.args); return { meta: { changes: Number(result.changes) } }; }
}
class LocalDatabase implements Database {
    db: DatabaseSync;
    constructor(path: string) { this.db = new DatabaseSync(path); this.db.exec(readFileSync(new URL("./migrations/0001_intake.sql", import.meta.url), "utf8")); }
    prepare(sql: string) { return new LocalStatement(this.db, sql); }
    async batch(statements: Statement[]) {
        this.db.exec("BEGIN IMMEDIATE");
        try {
            const results = [];
            for (const statement of statements)
                results.push(await statement.run());
            this.db.exec("COMMIT");
            return results;
        }
        catch (reason) {
            this.db.exec("ROLLBACK");
            throw reason;
        }
    }
}
const fixture = JSON.parse(readFileSync(new URL("../backend/tests/trace_pack_fixture.json", import.meta.url), "utf8"));
const code = "r".repeat(43), buyer = "buyer-key-" + "b".repeat(50);
const BASE = "/api/v1/trace-submissions", BUYER = "/api/v1/buyer/trace-submissions";
let directory: string, env: Env, db: LocalDatabase;
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), "agent-me-worker-")); db = new LocalDatabase(join(directory, "test.sqlite3")); env = { DB: db, TRACE_BUYER_TOKEN: buyer, TRACE_SUBMISSIONS_ENABLED: "true" }; });
afterEach(() => { db.db.close(); rmSync(directory, { recursive: true, force: true }); });
async function request(path: string, token?: string, body?: unknown, extra?: Record<string, string>) {
    return worker.fetch(new Request("https://agent-me.example" + path, { method: body === undefined ? "GET" : "POST", headers: { ...(token ? { Authorization: "Bearer " + token } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), env);
}
async function submit(token = code, pack = structuredClone(fixture), title = "Fictional activity") { return request(BASE, token, { pack, title, contributor_alias: "Synthetic only", confirm_submission: true }); }
async function created() { const response = await submit(); expect(response.status).toBe(201); return (await response.json()).submission; }
it("exposes only the public intake API and requires an enabled, configured buyer", async () => {
    for (const path of ["/api/v1/personal/status", "/api/v1/profile", "/api/v1/chat", "/docs", "/openapi.json"])
        expect((await request(path)).status).toBe(404);
    expect((await request("/health")).status).toBe(200);
    const response = await request("/api/v1/trace-market/status");
    expect((await response.json()).enabled).toBe(true);
    env.TRACE_BUYER_TOKEN = "";
    expect((await request("/api/v1/trace-market/status")).status).toBe(200);
    expect((await submit()).status).toBe(503);
});
it("stores only the selected sealed data and survives a new database client", async () => {
    const detail = await created();
    expect(detail).toMatchObject({ event_count: 1, conversation_count: 1, status: "submitted", payment_status: "not_started" });
    db.db.close();
    db = new LocalDatabase(join(directory, "test.sqlite3"));
    env.DB = db;
    const result = await request(BASE + "/" + detail.id + "/pack", code);
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual(fixture);
    const stored = db.db.prepare("SELECT receipt_hash FROM submissions").get();
    expect(stored?.receipt_hash).not.toBe(code);
});
it("isolates contributor receipts, buyer credentials, and private reviewer notes", async () => {
    const detail = await created();
    const sid = detail.id;
    expect((await request(BASE + "/" + sid, "s".repeat(43))).status).toBe(401);
    expect((await request(BASE + "/unknown", code)).status).toBe(401);
    expect((await request(BUYER, code)).status).toBe(401);
    expect((await submit(buyer)).status).toBe(401);
    const saved = await request(BUYER + "/" + sid + "/review", buyer, { status: "under_review", note: "Private fictional review" });
    expect((await saved.json()).review_notes[0].note).toBe("Private fictional review");
    const publicDetail = await request(BASE + "/" + sid, code);
    expect(await publicDetail.text()).not.toContain("Private fictional review");
    expect(publicDetail.headers.get("Cache-Control")).toBe("no-store");
});
it("retries the same payload once and refuses reuse of a receipt for changed data", async () => {
    const detail = await created();
    const retry = await submit();
    expect(retry.status).toBe(200);
    expect((await retry.json()).submission.id).toBe(detail.id);
    expect((await submit(code, structuredClone(fixture), "Different title")).status).toBe(409);
    expect(db.db.prepare("SELECT count(*) AS n FROM submissions").get()?.n).toBe(1);
});
it("rejects modified hashes, invalid selection counts, personal exports, and implicit sends", async () => {
    const tampered = structuredClone(fixture);
    tampered.events[0].content += "tamper";
    expect((await submit(code, tampered)).status).toBe(422);
    const counts = structuredClone(fixture);
    counts.selection.events = 2;
    expect((await submit(code, counts)).status).toBe(422);
    const personal = structuredClone(fixture);
    personal.intent = "personal_export";
    personal.offer = null;
    expect((await submit(code, personal)).status).toBe(422);
    const response = await request(BASE, code, { pack: fixture, title: "test", confirm_submission: false });
    expect(response.status).toBe(422);
    expect((await request(BASE, code, { pack: fixture, title: "test", confirm_submission: true, secret: "DoNotEchoThis" })).status).toBe(422);
});
it("allows only approved uses, exact integer price, and current-offer responses", async () => {
    const sid = (await created()).id;
    const endpoint = BUYER + "/" + sid + "/offers";
    expect((await request(endpoint, buyer, { amount_minor: 100, currency: "CAD", proposed_uses: ["small_model_training"], message: "" })).status).toBe(422);
    expect((await request(endpoint, buyer, { amount_minor: 12.34, currency: "CAD", proposed_uses: ["evaluation"], message: "" })).status).toBe(422);
    const payload = { amount_minor: 1234, currency: "CAD", proposed_uses: ["evaluation"], message: "Fictional test proposal" };
    const first = (await (await request(endpoint, buyer, payload)).json()).current_offer;
    const second = (await (await request(endpoint, buyer, payload)).json()).current_offer;
    expect((await request(BASE + "/" + sid + "/respond", code, { offer_id: first.id, decision: "accept" })).status).toBe(409);
    const accepted = await request(BASE + "/" + sid + "/respond", code, { offer_id: second.id, decision: "accept" });
    expect(await accepted.json()).toMatchObject({ status: "accepted_pending_agreement", payment_status: "not_started", current_offer: { amount_minor: 1234, status: "accepted" } });
    expect((await request(endpoint, buyer, payload)).status).toBe(409);
});
it("withdraws active content, closes offers, and releases intake capacity", async () => {
    const sid = (await created()).id;
    env.TRACE_SUBMISSION_STORAGE_LIMIT_BYTES = "1";
    expect((await submit("s".repeat(43))).status).toBe(503);
    const response = await request(BASE + "/" + sid + "/withdraw", code, {});
    expect((await response.json()).status).toBe("withdrawn");
    expect(db.db.prepare("SELECT count(*) AS n FROM submission_chunks").get()?.n).toBe(0);
    for (const path of [BASE + "/" + sid + "/pack", BUYER + "/" + sid + "/pack", BUYER + "/" + sid + "/events"])
        expect((await request(path, path.startsWith(BUYER) ? buyer : code)).status).toBe(410);
    env.TRACE_SUBMISSION_STORAGE_LIMIT_BYTES = "536870912";
    expect((await submit("s".repeat(43))).status).toBe(201);
});
it("searches and paginates without leaking excluded records", async () => {
    const sid = (await created()).id;
    const page = await request(BUYER + "/" + sid + "/events?query=verify&offset=0&limit=1", buyer);
    expect((await page.json()).total).toBe(1);
    const none = await request(BUYER + "/" + sid + "/events?query=not-present", buyer);
    expect((await none.json()).events).toEqual([]);
    const listing = await request(BUYER + "?status=submitted&limit=1", buyer);
    expect((await listing.json()).total).toBe(1);
    expect((await request(BUYER + "?limit=0", buyer)).status).toBe(422);
});
it("enforces hosted upload limits before JSON parse and applies public intake rate limits", async () => {
    const response = await request(BASE, code, { oversized: "x".repeat(5 * 1024 * 1024) });
    expect(response.status).toBe(413);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    env.SUBMISSION_RATE_LIMITER = { limit: async () => ({ success: false }) };
    expect((await submit()).status).toBe(429);
});
it("fails closed with safe JSON when persistence is unavailable", async () => {
    env.DB = { prepare() { throw Error("Secret database path and password"); }, batch: async () => [] };
    const response = await submit();
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("Secret database");
});
it("round-trips activity larger than a D1 row using UTF-8-safe chunks", async () => {
    const { sha256 } = await import("../frontend/src/tracePack");
    const { canonical } = await import("./store");
    const pack = structuredClone(fixture);
    const content = "abcdef😀".repeat(120000);
    pack.events[0].content = content;
    pack.events[0].content_sha256 = await sha256(content);
    pack.events.push({ ...structuredClone(pack.events[0]), id: "fictional-second-event" });
    pack.selection.events = 2;
    pack.selection.sources[pack.events[0].source] = 2;
    pack.files[0].selected_events = 2;
    const { integrity: omitted, ...body } = pack;
    void omitted;
    pack.integrity.sha256 = await sha256(canonical(body));
    const response = await submit(code, pack);
    expect(response.status).toBe(201);
    const sid = (await response.json()).submission.id;
    const chunks = db.db.prepare("SELECT length(content_base64) AS n FROM submission_chunks").all();
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every(row => Number(row.n) < 2000000)).toBe(true);
    const stored = await request(BASE + "/" + sid + "/pack", code);
    expect(await stored.json()).toEqual(pack);
});
it("rolls back every chunk when the intake quota rejects an admission", async () => {
    await created();
    const before = db.db.prepare("SELECT count(*) AS n FROM submission_chunks").get()?.n;
    env.TRACE_SUBMISSION_STORAGE_LIMIT_BYTES = "1";
    expect((await submit("t".repeat(43))).status).toBe(503);
    expect(db.db.prepare("SELECT count(*) AS n FROM submissions").get()?.n).toBe(1);
    expect(db.db.prepare("SELECT count(*) AS n FROM submission_chunks").get()?.n).toBe(before);
});
it("rejects a simultaneous stale review instead of overwriting a review note", async () => {
    const sid = (await created()).id;
    const { IntakeStore } = await import("./store");
    const store = new IntakeStore(db);
    const results = await Promise.allSettled([store.review(sid, "under_review", "Reviewer one"), store.review(sid, "under_review", "Reviewer two")]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const failure = results.find(result => result.status === "rejected");
    expect(failure?.status === "rejected" && failure.reason.status).toBe(409);
    const detail = await (await request(BUYER + "/" + sid, buyer)).json();
    expect(detail.review_notes).toHaveLength(1);
});
it("rejects malformed JSON and disallowed methods without reflecting submitted secrets", async () => {
    const response = await worker.fetch(new Request("https://agent-me.example" + BASE, { method: "POST", headers: { Authorization: "Bearer " + code }, body: '{"secret":"NeverEchoThis"' }), env);
    expect(response.status).toBe(422);
    expect(await response.text()).not.toContain("NeverEchoThis");
    const disallowed = await worker.fetch(new Request("https://agent-me.example" + BASE, { method: "DELETE", headers: { Authorization: "Bearer " + code } }), env);
    expect(disallowed.status).toBe(405);
});
