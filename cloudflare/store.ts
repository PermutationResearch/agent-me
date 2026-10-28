/** D1-backed submission lifecycle. Stored activity is always untrusted data. */
import { sha256 } from "../frontend/src/tracePack";
import type { TracePack } from "../frontend/src/traceTypes";
import type { BuyerDetail, OfferPayload, SubmissionDetail, SubmissionStatus, SubmissionSummary } from "../frontend/src/marketApi";
export interface Statement {
    bind(...values: (string | number | null)[]): Statement;
    first<T>(): Promise<T | null>;
    all<T>(): Promise<{
        results: T[];
    }>;
    run(): Promise<{
        meta: {
            changes: number;
        };
    }>;
}
export interface Database {
    prepare(sql: string): Statement;
    batch(statements: Statement[]): Promise<{
        meta: {
            changes: number;
        };
    }[]>;
}
type Row = {
    id: string;
    receipt_hash: string;
    payload_hash: string;
    summary_json: string;
    offers_json: string;
    notes_json: string;
    contributor_note: string;
    pack_bytes: number;
    version: number;
};
export const STATUSES: SubmissionStatus[] = ["submitted", "under_review", "offered", "accepted_pending_agreement", "declined", "withdrawn"];
export class HttpError extends Error {
    constructor(public status: number, message: string) { super(message); }
}
export function canonical(value: unknown): string {
    if (Array.isArray(value))
        return `[${value.map(canonical).join(",")}]`;
    if (value !== null && typeof value === "object") {
        const row = value as Record<string, unknown>;
        return `{${Object.keys(row).sort().map(key => JSON.stringify(key) + ":" + canonical(row[key])).join(",")}}`;
    }
    return JSON.stringify(value);
}
export function equalHash(left: string, right: string) { let difference = left.length ^ right.length; for (let i = 0; i < 64; i++)
    difference |= (left.charCodeAt(i) || 0) ^ (right.charCodeAt(i) || 0); return difference === 0; }
function identifier(prefix: string) { return prefix + crypto.randomUUID().replaceAll("-", ""); }
function now() { return new Date().toISOString(); }
function encodeChunk(bytes: Uint8Array) { let binary = ""; const STEP = 16384; for (let i = 0; i < bytes.length; i += STEP)
    binary += String.fromCharCode(...bytes.subarray(i, i + STEP)); return btoa(binary); }
function decodeChunk(text: string) { return Uint8Array.from(atob(text), char => char.charCodeAt(0)); }
function detail(row: Row, buyer = false): SubmissionDetail | BuyerDetail {
    return { ...JSON.parse(row.summary_json), offers: JSON.parse(row.offers_json), contributor_note: row.contributor_note, ...(buyer ? { review_notes: JSON.parse(row.notes_json) } : {}) };
}
export class IntakeStore {
    constructor(private db: Database, private quota = 512 * 1024 * 1024) { }
    async row(id: string, receiptHash?: string): Promise<Row> {
        const row = await this.db.prepare("SELECT * FROM submissions WHERE id=?").bind(id).first<Row>();
        if (receiptHash !== undefined) {
            if (!row || !equalHash(row.receipt_hash, receiptHash))
                throw new HttpError(401, "A valid submission ID and private receipt code are required.");
        }
        if (!row)
            throw new HttpError(404, "Submission not found.");
        return row;
    }
    async get(id: string, receiptHash?: string, buyer = false) { return detail(await this.row(id, receiptHash), buyer); }
    async pack(id: string, receiptHash?: string): Promise<TracePack> {
        const row = await this.row(id, receiptHash);
        if (!row.pack_bytes)
            throw new HttpError(410, "This submission was withdrawn and its activity removed.");
        const chunks = await this.db.prepare("SELECT content_base64 FROM submission_chunks WHERE submission_id=? ORDER BY chunk_index").bind(id).all<{
            content_base64: string;
        }>();
        const bytes = new Uint8Array(row.pack_bytes);
        let offset = 0;
        for (const chunk of chunks.results) {
            const part = decodeChunk(chunk.content_base64);
            bytes.set(part, offset);
            offset += part.length;
        }
        if (offset !== row.pack_bytes)
            throw new Error("Incomplete intake content");
        return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    }
    async submit(pack: TracePack, title: string, alias: string, receiptHash: string) {
        const payloadHash = await sha256(canonical({ pack, title, contributor_alias: alias, confirm_submission: true }));
        const retry = async () => {
            const old = await this.db.prepare("SELECT * FROM submissions WHERE receipt_hash=?").bind(receiptHash).first<Row>();
            if (!old)
                return null;
            if (old.payload_hash !== payloadHash)
                throw new HttpError(409, "This private code already belongs to a different submission.");
            return { submission: detail(old), created: false };
        };
        const existing = await retry();
        if (existing)
            return existing;
        const bytes = new TextEncoder().encode(JSON.stringify(pack));
        const created = now();
        const id = identifier("sub_");
        const summary: SubmissionSummary = { id, title, contributor_alias: alias, status: "submitted", created_at: created, updated_at: created, pack_sha256: pack.integrity.sha256, event_count: pack.selection.events, conversation_count: pack.selection.conversations, sources: pack.selection.sources, requested_uses: pack.offer!.requested_uses, current_offer: null, payment_status: "not_started" };
        const statements = [this.db.prepare("INSERT INTO submissions (id,receipt_hash,payload_hash,summary_json,contributor_note,pack_bytes,quota) VALUES(?,?,?,?,?,?,?)").bind(id, receiptHash, payloadHash, JSON.stringify(summary), pack.offer!.note, bytes.byteLength, this.quota)];
        const CHUNK = 1024 * 1024;
        for (let i = 0; i < bytes.length; i += CHUNK)
            statements.push(this.db.prepare("INSERT INTO submission_chunks(submission_id,chunk_index,content_base64) VALUES(?,?,?)").bind(id, i / CHUNK, encodeChunk(bytes.subarray(i, i + CHUNK))));
        try {
            await this.db.batch(statements);
        }
        catch (reason) {
            const concurrent = await retry();
            if (concurrent)
                return concurrent;
            if (reason instanceof Error && reason.message.includes("intake_storage_quota"))
                throw new HttpError(503, "Submission capacity is currently full. Please try again later.");
            throw reason;
        }
        return { submission: await this.get(id, receiptHash), created: true };
    }
    async listing(status: string, offset: number, limit: number) {
        const countRows = await this.db.prepare("SELECT json_extract(summary_json,'$.status') AS status,COUNT(*) AS n FROM submissions GROUP BY json_extract(summary_json,'$.status')").all<{
            status: SubmissionStatus;
            n: number;
        }>();
        const counts = Object.fromEntries(STATUSES.map(value => [value, 0])) as Record<SubmissionStatus, number>;
        for (const row of countRows.results)
            counts[row.status] = row.n;
        const sql = status ? "SELECT summary_json FROM submissions WHERE json_extract(summary_json,'$.status')=? ORDER BY rowid DESC LIMIT ? OFFSET ?" : "SELECT summary_json FROM submissions ORDER BY rowid DESC LIMIT ? OFFSET ?";
        const statement = this.db.prepare(sql);
        const rows = await (status ? statement.bind(status, limit, offset) : statement.bind(limit, offset)).all<{
            summary_json: string;
        }>();
        return { submissions: rows.results.map(row => JSON.parse(row.summary_json)), total: status ? counts[status as SubmissionStatus] : Object.values(counts).reduce((a, b) => a + b, 0), counts };
    }
    private update(row: Row, value: SubmissionDetail | BuyerDetail, withdraw = false) {
        const { offers, contributor_note: omitted, ...rest } = value;
        void omitted;
        const notes = "review_notes" in rest ? rest.review_notes : JSON.parse(row.notes_json);
        const summary = { ...rest } as Partial<BuyerDetail>;
        delete summary.review_notes;
        return this.db.prepare("UPDATE submissions SET summary_json=?,offers_json=?,notes_json=?,version=version+1,pack_bytes=? WHERE id=? AND version=?").bind(JSON.stringify(summary), JSON.stringify(offers), JSON.stringify(notes), withdraw ? 0 : row.pack_bytes, row.id, row.version);
    }
    private async save(row: Row, value: SubmissionDetail | BuyerDetail, buyer = false) {
        const result = await this.update(row, value).run();
        if (result.meta.changes !== 1)
            throw new HttpError(409, "This submission changed. Refresh before continuing.");
        return this.get(row.id, undefined, buyer);
    }
    async review(id: string, status: "under_review" | "declined", note: string) {
        const row = await this.row(id);
        const value = detail(row, true) as BuyerDetail;
        if (!["submitted", "under_review"].includes(value.status))
            throw new HttpError(409, "This submission cannot be reviewed in its current state.");
        value.status = status;
        value.updated_at = now();
        if (note.trim())
            value.review_notes.push({ id: identifier("note_"), note, created_at: now() });
        return this.save(row, value, true);
    }
    async offer(id: string, proposal: OfferPayload) {
        const row = await this.row(id);
        const value = detail(row, true) as BuyerDetail;
        if (!["submitted", "under_review", "offered"].includes(value.status))
            throw new HttpError(409, "This submission cannot receive an offer in its current state.");
        if (!proposal.proposed_uses.every(use => value.requested_uses.includes(use)))
            throw new HttpError(422, "Proposed uses must stay within the contributor's selected uses.");
        for (const item of value.offers)
            if (item.status === "open")
                item.status = "superseded";
        const offer = { ...proposal, id: identifier("offer_"), status: "open" as const, created_at: now() };
        value.offers.push(offer);
        value.current_offer = offer;
        value.status = "offered";
        value.updated_at = now();
        return this.save(row, value, true);
    }
    async respond(id: string, receiptHash: string, offerId: string, decision: "accept" | "decline") {
        const row = await this.row(id, receiptHash);
        const value = detail(row);
        if (value.status !== "offered" || !value.current_offer || value.current_offer.id !== offerId || value.current_offer.status !== "open")
            throw new HttpError(409, "This offer is no longer open. Refresh your submission.");
        const offer = value.offers.find(item => item.id === offerId)!;
        offer.status = decision === "accept" ? "accepted" : "declined";
        value.current_offer = offer;
        value.status = decision === "accept" ? "accepted_pending_agreement" : "declined";
        value.updated_at = now();
        return this.save(row, value);
    }
    async withdraw(id: string, receiptHash: string) {
        const row = await this.row(id, receiptHash);
        const value = detail(row);
        if (value.status === "withdrawn")
            return value;
        for (const item of value.offers)
            if (["open", "accepted"].includes(item.status))
                item.status = "declined";
        value.current_offer = value.offers.at(-1) ?? null;
        value.status = "withdrawn";
        value.updated_at = now();
        const results = await this.db.batch([this.update(row, value, true), this.db.prepare("DELETE FROM submission_chunks WHERE submission_id=? AND EXISTS(SELECT 1 FROM submissions WHERE id=? AND version=? AND pack_bytes=0)").bind(id, id, row.version + 1)]);
        if (results[0].meta.changes !== 1)
            throw new HttpError(409, "This submission changed. Refresh before continuing.");
        return this.get(id, receiptHash);
    }
}
