/** Portable selected-only activity exports. Checksums detect changes, not authorship. */
import { redactTraceText } from "./traceRedaction";
import type { PackedEvent, RequestedUse, TraceImportResult, TracePack, TracePackOptions } from "./traceTypes";

const roles = new Set(["user", "human", "assistant", "tool", "agent", "harness", "system", "developer", "document", "unknown"]);
const uses = new Set<RequestedUse>(["stack_optimization", "evaluation", "small_model_training"]);
const hashPattern = /^[a-f0-9]{64}$/;
export const MAX_PACK_EVENTS = 50000;
export const MAX_TRACE_PACK_BYTES = 25 * 1024 * 1024;

export async function sha256(value: string | Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error("Trace export requires HTTPS or localhost for integrity checks.");
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value);
  const result = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(result), byte => byte.toString(16).padStart(2, "0")).join("");
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonical(object[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function check(condition: unknown, message = "Invalid activity export fields."): asserts condition {
  if (!condition) throw new Error(message);
}
function text(value: unknown, maximum = 2000000): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximum;
}
function count(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}
function object(value: unknown, fields?: string[]): Record<string, unknown> {
  check(value !== null && typeof value === "object" && !Array.isArray(value));
  const row = value as Record<string, unknown>;
  if (fields) check(Object.keys(row).length === fields.length && fields.every(key => Object.hasOwn(row, key)));
  return row;
}
function metadata(value: string, maximum = 200): string {
  check(text(value, maximum));
  return redactTraceText(value).text;
}
function totals(events: PackedEvent[]) {
  const sourceCounts = new Map<string, number>();
  for (const event of events) sourceCounts.set(event.source, (sourceCounts.get(event.source) ?? 0) + 1);
  return { events: events.length, conversations: new Set(events.map(event => `${event.source}:${event.conversation_id}`)).size,
    sources: Object.fromEntries(sourceCounts) };
}

export async function buildTracePack(data: TraceImportResult, ids: string[], edits: Record<string, string>, options: TracePackOptions): Promise<TracePack> {
  check(options.reviewConfirmed, "Review the selected records before exporting.");
  check(ids.length > 0 && ids.length <= MAX_PACK_EVENTS, "Select between 1 and 50,000 records to export.");
  const selected = new Set(ids);
  check(selected.size === ids.length, "The record selection contains duplicate IDs.");
  check(options.intent === "personal_export" || options.intent === "sale_offer", "Choose an export intent.");
  check(options.note.length <= 1000, "Keep the offer note within 1,000 characters.");
  check(options.requestedUses.every(use => uses.has(use)), "Choose a supported use preference.");
  if (options.intent === "sale_offer") check(options.requestedUses.length > 0, "Choose at least one use preference for the offer.");
  const records = data.events.filter(event => selected.has(event.id));
  check(records.length === selected.size, "The selection includes unavailable records.");
  const events: PackedEvent[] = [];
  const sourceFiles = new Map<string, { sha256: string; format: string; selected_events: number }>();
  for (const event of records) {
    const file = data.files.find(candidate => candidate.id === event.origin.fileId);
    check(file && hashPattern.test(file.sha256) && file.sha256 === event.origin.fileId,
      "Selected record source provenance is unavailable.");
    const revised = Object.hasOwn(edits, event.id);
    const content = redactTraceText(revised ? edits[event.id] : event.text).text;
    check(text(content), "A selected record cannot be empty or exceed 2 million characters.");
    check(roles.has(event.role), "A selected record has an unsupported author role.");
    check(count(event.origin.line) && event.origin.line >= 1 && count(event.origin.item), "Invalid source position.");
    events.push({
      id: metadata(event.id), source: metadata(event.source), conversation_id: metadata(event.conversationId),
      kind: metadata(event.kind), role: event.role, timestamp: event.timestamp === null ? null : metadata(event.timestamp),
      tool_name: event.toolName === null ? null : metadata(event.toolName), content,
      origin: { file_sha256: file.sha256, line: event.origin.line, item: event.origin.item },
      content_sha256: await sha256(content), edited: event.edited || revised,
      trust: "untrusted_trace", instruction_authority: "none",
    });
    const entry = sourceFiles.get(file.sha256) ?? { sha256: file.sha256, format: metadata(file.format), selected_events: 0 };
    entry.selected_events += 1; sourceFiles.set(file.sha256, entry);
  }
  check(new Set(events.map(event => event.id)).size === events.length, "Record IDs conflict after redaction.");
  const body = {
    schema: "agent-me.trace-pack.v1" as const, id: crypto.randomUUID(), created_at: new Date().toISOString(), intent: options.intent,
    offer: options.intent === "sale_offer" ? { recipient: "Agent-Me" as const, status: "draft" as const, submitted: false as const,
      requested_uses: [...new Set(options.requestedUses)], note: redactTraceText(options.note).text } : null,
    selection: totals(events), privacy: { automatic_redaction: true as const, manual_review_confirmed: true as const, attachments_included: false as const },
    files: [...sourceFiles.values()], events,
  };
  const pack: TracePack = { ...body, integrity: { algorithm: "sha256", sha256: await sha256(canonical(body)) } };
  check(new TextEncoder().encode(JSON.stringify(pack, null, 2)).byteLength <= MAX_TRACE_PACK_BYTES,
    "The selected activity exceeds 25 MiB. Select fewer records and export smaller selections.");
  return pack;
}

export async function parseTracePack(value: unknown): Promise<TracePack> {
  const pack = object(value, ["schema", "id", "created_at", "intent", "offer", "selection", "privacy", "files", "events", "integrity"]);
  check(pack.schema === "agent-me.trace-pack.v1", "Unsupported activity export version.");
  check(text(pack.id, 100) && text(pack.created_at, 100));
  check(pack.intent === "personal_export" || pack.intent === "sale_offer");
  const privacy = object(pack.privacy, ["automatic_redaction", "manual_review_confirmed", "attachments_included"]);
  check(privacy.automatic_redaction === true && privacy.manual_review_confirmed === true && privacy.attachments_included === false);
  if (pack.intent === "sale_offer") {
    const offer = object(pack.offer, ["recipient", "status", "submitted", "requested_uses", "note"]);
    check(offer.recipient === "Agent-Me" && offer.status === "draft" && offer.submitted === false);
    check(Array.isArray(offer.requested_uses) && offer.requested_uses.length > 0 && offer.requested_uses.length <= uses.size);
    check(offer.requested_uses.every(use => typeof use === "string" && uses.has(use as RequestedUse)));
    check(typeof offer.note === "string" && offer.note.length <= 1000);
  } else check(pack.offer === null);
  check(Array.isArray(pack.files) && pack.files.length > 0 && pack.files.length <= MAX_PACK_EVENTS);
  const files = new Map<string, number>();
  for (const item of pack.files) {
    const file = object(item, ["sha256", "format", "selected_events"]);
    check(typeof file.sha256 === "string" && hashPattern.test(file.sha256));
    check(text(file.format, 200) && count(file.selected_events) && file.selected_events > 0 && !files.has(file.sha256));
    files.set(file.sha256, file.selected_events);
  }
  check(Array.isArray(pack.events) && pack.events.length > 0 && pack.events.length <= MAX_PACK_EVENTS);
  const observedFiles = new Map<string, number>();
  const ids = new Set<string>();
  for (const item of pack.events) {
    const event = object(item, ["id", "source", "conversation_id", "kind", "role", "timestamp", "tool_name", "content", "origin", "content_sha256", "edited", "trust", "instruction_authority"]);
    check(text(event.id, 200) && !ids.has(event.id)); ids.add(event.id);
    check(text(event.source, 200) && text(event.conversation_id, 200) && text(event.kind, 200));
    check(typeof event.role === "string" && roles.has(event.role));
    check(event.timestamp === null || text(event.timestamp, 200));
    check(event.tool_name === null || text(event.tool_name, 200));
    check(text(event.content) && typeof event.content_sha256 === "string" && hashPattern.test(event.content_sha256));
    check(typeof event.edited === "boolean" && event.trust === "untrusted_trace" && event.instruction_authority === "none");
    const origin = object(event.origin, ["file_sha256", "line", "item"]);
    check(typeof origin.file_sha256 === "string" && files.has(origin.file_sha256));
    check(count(origin.line) && origin.line >= 1 && count(origin.item));
    observedFiles.set(origin.file_sha256, (observedFiles.get(origin.file_sha256) ?? 0) + 1);
    check(await sha256(event.content) === event.content_sha256, "Trace content hash integrity check failed.");
  }
  check(observedFiles.size === files.size && [...files].every(([hash, expected]) => observedFiles.get(hash) === expected));
  const selection = object(pack.selection, ["events", "conversations", "sources"]);
  const expected = totals(pack.events as PackedEvent[]);
  check(selection.events === expected.events && selection.conversations === expected.conversations);
  check(canonical(object(selection.sources)) === canonical(expected.sources));
  const integrity = object(pack.integrity, ["algorithm", "sha256"]);
  check(integrity.algorithm === "sha256" && typeof integrity.sha256 === "string" && hashPattern.test(integrity.sha256));
  const { integrity: omitted, ...body } = pack;
  void omitted;
  check(await sha256(canonical(body)) === integrity.sha256, "Activity export hash integrity check failed.");
  return value as TracePack;
}
