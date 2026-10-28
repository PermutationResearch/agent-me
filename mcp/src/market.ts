import { randomBytes, randomUUID } from "node:crypto";
import { parseTracePack } from "../../frontend/src/tracePack";
import type { TracePack } from "../../frontend/src/traceTypes";
import { Store } from "./storage";

type Receipt = {
  schema: "agent-me.mcp-receipt.v1"; base_url: string; export_id: string; pack_sha256: string;
  title: string; contributor_alias: string; access_token: string; submission_id: string | null;
};
export type SubmitInput = {
  export_id: string; expected_sha256: string; title: string; contributor_alias?: string;
  confirm_submission: boolean; receipt_id?: string;
};
function endpoint(value: string): string {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("Configure the review service origin without credentials or a path.");
  if (url.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Non-local review services require HTTPS.");
  return url.origin;
}
function metadata(value: string, maximum: number, label: string, empty = false): string {
  if (typeof value !== "string" || value.length > maximum || (!empty && !value.trim())) throw new Error(`Choose a ${label} within ${maximum} characters.`);
  return value.trim();
}
async function request(base: string, path: string, token: string, body?: unknown) {
  return fetch(`${base}/api/v1/${path}`, {
    method: body === undefined ? "GET" : "POST", signal: AbortSignal.timeout(30000),
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
function publicSubmission(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || !("id" in value) || typeof value.id !== "string") throw new Error("The review service returned an invalid confirmation. Keep the saved receipt and retry.");
  const row = value as Record<string, unknown>;
  const keys = ["id", "title", "status", "created_at", "updated_at", "pack_sha256", "event_count", "conversation_count", "sources", "requested_uses", "current_offer", "offers", "payment_status"];
  return Object.fromEntries(keys.filter(key => key in row).map(key => [key, row[key]]));
}

/** The only network write: explicit reviewed export, exact checksum and user confirmation. */
export async function submitExport(store: Store, input: SubmitInput, baseUrl: string) {
  if (input.confirm_submission !== true) throw new Error("Ask the contributor to confirm sending this selected export before submission.");
  const base = endpoint(baseUrl);
  const pack = await parseTracePack(await store.read<TracePack>("exports", input.export_id));
  if (pack.intent !== "sale_offer") throw new Error("Prepare a reviewed sale-offer export before submitting.");
  if (pack.integrity.sha256 !== input.expected_sha256) throw new Error("The export checksum changed. Review the current export before submitting.");
  const title = metadata(input.title, 120, "title");
  const alias = metadata(input.contributor_alias ?? "", 80, "contributor alias", true);
  const receipt_id = input.receipt_id ?? `rcpt_${randomUUID()}`;
  let receipt: Receipt;
  if (input.receipt_id) {
    receipt = await store.read<Receipt>("receipts", receipt_id);
    if (receipt.base_url !== base || receipt.export_id !== input.export_id || receipt.pack_sha256 !== input.expected_sha256 || receipt.title !== title || receipt.contributor_alias !== alias) throw new Error("Retry the original submission with its original review service, export, title and alias.");
    if (receipt.submission_id) return submissionStatus(store, receipt_id, base);
  } else {
    receipt = { schema: "agent-me.mcp-receipt.v1", base_url: base, export_id: input.export_id, pack_sha256: input.expected_sha256, title, contributor_alias: alias, access_token: randomBytes(32).toString("base64url"), submission_id: null };
    await store.save("receipts", receipt_id, receipt);
  }
  const pendingPath = store.path("receipts", receipt_id);
  let response: Response;
  try {
    response = await request(base, "trace-submissions", receipt.access_token, { pack, title, contributor_alias: alias, confirm_submission: true });
  } catch {
    return { receipt_id, path: pendingPath, status: "not_confirmed", review_service: base, message: "Receipt saved before sending. Delivery could not be confirmed; retry submit_trace_export with this receipt_id and the same arguments. Do not create a second submission." };
  }
  if (!response.ok) return {
    receipt_id, path: pendingPath, status: "not_confirmed", http_status: response.status, review_service: base,
    message: response.status === 503 ? "Submissions are disabled on this review service. Your local export and receipt are saved." : "The review service did not confirm receipt. Retry with the same receipt_id after resolving the service error.",
  };
  let submission: Record<string, unknown>;
  try { submission = publicSubmission((await response.json() as { submission: unknown }).submission); }
  catch { return { receipt_id, path: pendingPath, status: "not_confirmed", review_service: base, message: "The response was invalid. Delivery is uncertain; retry with this same receipt_id." }; }
  receipt.submission_id = submission.id as string;
  await store.save("receipts", receipt_id, receipt);
  const path = await store.save("submission-receipts", receipt_id, { schema: "agent-me.submission-receipt.v1", submission_id: receipt.submission_id, access_token: receipt.access_token });
  return { receipt_id, path, submission_id: receipt.submission_id, status: submission.status, review_service: base, submission, message: "Private receipt saved locally. Keep it to reopen your submission on the website. No sale, payment, or agreement has been accepted." };
}

export async function submissionStatus(store: Store, receipt_id: string, baseUrl: string) {
  const base = endpoint(baseUrl);
  const receipt = await store.read<Receipt>("receipts", receipt_id);
  if (receipt.base_url !== base) throw new Error("This receipt belongs to a different review service. Configure its original endpoint.");
  if (!receipt.submission_id) return { receipt_id, status: "not_confirmed", path: store.path("receipts", receipt_id), message: "Retry submit_trace_export with this receipt_id and its original arguments to resolve delivery." };
  const response = await request(base, `trace-submissions/${encodeURIComponent(receipt.submission_id)}`, receipt.access_token);
  if (!response.ok) throw new Error(`Could not read the submission (HTTP ${response.status}). Keep your private receipt.`);
  const submission = publicSubmission(await response.json());
  return { receipt_id, path: store.path("submission-receipts", receipt_id), submission_id: receipt.submission_id, status: submission.status, review_service: base, submission };
}
