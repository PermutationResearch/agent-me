/** Read supported trace text locally. No upload, storage, or command execution. */
import { parseTracePack, sha256 } from "./tracePack";
import { redactTraceText } from "./traceRedaction";
import type { TraceEvent, TraceFile, TraceImportResult, TraceRole } from "./traceTypes";

export const MAX_TRACE_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_TRACE_TOTAL_BYTES = 100 * 1024 * 1024;
export const MAX_TRACE_FILES = 100;
export const MAX_TRACE_EVENTS = 50000;
const MAX_ROWS = 100000;
const ROLES = new Set<TraceRole>(["user", "human", "assistant", "tool", "agent", "harness", "system", "developer", "document", "unknown"]);
const HARNESS = /^\s*(?:<(?:task-notification|system-reminder|local-command-stdout|local-command-stderr|local-command-caveat|bash-stdout|bash-stderr|side-sessions-event|ci-monitor-event|environment_context|user_instructions|external_codex_apps_open_page|turn_aborted|guardian_tool_descriptions|recommended_plugins|codex_internal_context|in-app-browser-context|subagent_notification|skill|codex_delegation)\b|# AGENTS\.md instructions|# Files (?:mentioned|pasted)|\[Request interrupted by user|Caveat: The messages below were generated)/;
type Row = Record<string, unknown>;
type Positioned = { row: Row; line: number };
type RawEvent = Omit<TraceEvent, "id" | "conversationId" | "origin" | "redactions" | "edited"> & { identity: string; line: number; item: number };
const object = (value: unknown): Row => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const text = (value: unknown, fallback = "") => typeof value === "string" ? value : fallback;
const render = (value: unknown) => value === null || value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value);
const role = (value: unknown): TraceRole => ROLES.has(value as TraceRole) ? value as TraceRole : "unknown";
const blocks = (value: unknown): Row[] => (Array.isArray(value) ? value : value === undefined || value === null ? [] : [value])
  .map(value => typeof value === "string" ? { type: "text", text: value } : object(value));
const isMedia = (block: Row) => /^(?:image|input_image|image_url|audio|input_audio|output_audio|video|file|document)$/.test(text(block.type));
function stamp(value: unknown): string | null {
  if (typeof value === "string" && Number.isFinite(Date.parse(value))) return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value);return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }
  return null;
}
function contentText(value: unknown): string {
  if (typeof value === "string") return value;
  return blocks(value).map(block => isMedia(block) ? "[attachment omitted]" : text(block.text)).filter(Boolean).join("\n");
}

function readBytes(file: File): Promise<Uint8Array> {
  // Native File supports both browser extraction and the local Node MCP adapter.
  if (typeof file.arrayBuffer === "function") return file.arrayBuffer().then(buffer => new Uint8Array(buffer));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => reader.result instanceof ArrayBuffer
      ? resolve(new Uint8Array(reader.result))
      : reject(new Error("The trace file could not be read."));
    reader.onerror = reader.onabort = () => reject(new Error("The trace file could not be read."));
    reader.readAsArrayBuffer(file);
  });
}

function rowsOf(value: unknown, line: number): Positioned[] {
  const entries = Array.isArray(value) ? value : [value];
  if (entries.some(entry => entry === null || typeof entry !== "object" || Array.isArray(entry))) {
    throw new Error("Trace records must be JSON objects.");
  }
  return entries.map(row => ({ row: row as Row, line }));
}
function parseRows(content: string, file: File): { rows: Positioned[]; document: unknown } {
  try {
    if (/\.json$/i.test(file.name)) {
      const document = JSON.parse(content) as unknown;
      return { rows: rowsOf(document, 1), document };
    }
    const lines = content.split(/\r?\n/);
    if (lines.length > MAX_ROWS + 1) throw new Error("too many rows");
    const rows = lines.flatMap((line, index) => line.trim() ? rowsOf(JSON.parse(line) as unknown, index + 1) : []);
    return { rows, document: rows.length === 1 ? rows[0].row : null };
  } catch {
    throw new Error("The trace file must contain valid JSON records. Split very large logs into smaller files.");
  }
}

function extract(rows: Positioned[], filename: string, fileHash: string): { events: RawEvent[]; skipped: number; format: string } {
  if (rows.length > MAX_ROWS) throw new Error("Too many trace records; split the file into smaller files.");
  const firstMeta = rows.find(({ row }) => row.type === "session_meta");
  const firstSession = rows.find(({ row }) => row.type === "session");
  const format = rows.some(({ row }) => Array.isArray(row.events) && typeof row.source === "string") ? "normalized"
    : firstMeta || rows.some(({ row }) => row.type === "response_item" || row.type === "event_msg") ? "codex"
      : rows.some(({ row }) => typeof row.event_type === "string") ? "agent-trace"
        : firstSession || rows.some(({ row }) => row.type === "message" || row.recordType === "message") ? "omp"
          : rows.some(({ row }) => row.type === "user" || row.type === "assistant") ? "claude-code" : "unsupported";
  const meta = object(firstMeta?.row.payload);
  const session = firstSession?.row ?? {};
  const claudeIdentity = rows.map(({ row }) => text(row.sessionId)).find(Boolean);
  const identity = text(meta.id) || text(session.id) || claudeIdentity || fileHash;
  const claudeAgent = /^agent-/.test(filename) || rows.some(({ row }) => row.isSidechain === true || /^sdk/.test(text(row.entrypoint)) || /^\/(?:private\/)?tmp\//.test(text(row.cwd)));
  const codexAgent = Object.hasOwn(object(meta.source), "subagent");
  const events: RawEvent[] = [];
  const seenUser = new Set<string>();
  const items = new Map<number, number>();
  let skipped = 0;
  function emit(source: string, id: string, line: number, kind: string, author: TraceRole, value: unknown, timestamp: unknown, tool: unknown = null) {
    const body = render(value);
    if (!body.trim()) return;
    const item = items.get(line) ?? 0;items.set(line, item + 1);
    events.push({ source, identity: id, line, item, kind, role: author, text: body, timestamp: stamp(timestamp), toolName: typeof tool === "string" ? tool : null });
    if (events.length > MAX_TRACE_EVENTS) throw new Error("Too many trace events; import smaller groups of files.");
  }
  for (const { row, line } of rows) {
    const timestamp = row.timestamp;
    if (format === "normalized") {
      if (!Array.isArray(row.events) || typeof row.source !== "string") { skipped += 1;continue; }
      const source = row.source;
      const id = text(row.conversation_id) || text(row.identity) || identity;
      for (const value of row.events) {
        const event = object(value);
        if (typeof event.content !== "string" && typeof event.text !== "string" && (event.content === undefined || event.content === null)) { skipped += 1;continue; }
        emit(source, id, line, text(event.kind, "message"), role(event.role), event.content ?? event.text, event.timestamp, event.tool ?? event.tool_name);
      }
    } else if (format === "claude-code") {
      if (!["user", "assistant"].includes(text(row.type))) {
        if (!["custom-title", "summary"].includes(text(row.type))) skipped += 1;
        continue;
      }
      for (const block of blocks(object(row.message).content)) {
        const kind = text(block.type, "text");
        const ownerRole = row.isMeta || row.isCompactSummary || HARNESS.test(text(block.text)) ? "harness" : claudeAgent ? "agent" : "user";
        const author = row.type === "user" ? ownerRole : "assistant";
        if (kind === "text") emit(format, identity, line, "message", author, block.text, timestamp);
        else if (kind === "thinking") emit(format, identity, line, "reasoning", "assistant", block.thinking, timestamp);
        else if (kind === "tool_use") emit(format, identity, line, "tool_call", "assistant", block.input ?? {}, timestamp, block.name);
        else if (kind === "tool_result") emit(format, identity, line, "tool_result", "tool", (block.is_error ? "[tool error] " : "") + contentText(block.content), timestamp);
        else if (isMedia(block)) emit(format, identity, line, "attachment", author, "[attachment omitted]", timestamp);
        else skipped += 1;
      }
    } else if (format === "codex") {
      const payload = object(row.payload);
      const type = text(payload.type);
      if (row.type === "session_meta") continue;
      if (row.type === "event_msg" && type === "user_message") {
        const value = text(payload.message);
        if (value && !seenUser.has(value)) {
          seenUser.add(value);emit(format, identity, line, "message", HARNESS.test(value) ? "harness" : codexAgent ? "agent" : "user", value, timestamp);
        }
      } else if (row.type === "response_item" && type === "message") {
        for (const block of blocks(payload.content)) {
          const author = role(payload.role);
          const body = isMedia(block) ? "[attachment omitted]" : text(block.text);
          if (!body) { skipped += 1;continue; }
          if (author === "user") {
            if (seenUser.has(body)) continue;
            seenUser.add(body);
          }
          emit(format, identity, line, isMedia(block) ? "attachment" : "message", author === "user" ? HARNESS.test(body) ? "harness" : codexAgent ? "agent" : "user" : author, body, timestamp);
        }
      } else if (row.type === "response_item" && ["function_call", "custom_tool_call", "web_search_call", "local_shell_call"].includes(type)) {
        emit(format, identity, line, "tool_call", "assistant", payload.arguments ?? payload.input ?? payload.action ?? payload.query ?? "", timestamp, payload.name ?? type);
      } else if (row.type === "response_item" && ["function_call_output", "custom_tool_call_output", "local_shell_call_output"].includes(type)) {
        emit(format, identity, line, "tool_result", "tool", payload.output ?? "", timestamp);
      } else if (row.type === "response_item" && type === "reasoning") {
        const body = contentText(payload.summary) || contentText(payload.content);
        if (body) emit(format, identity, line, "reasoning", "assistant", body, timestamp);else skipped += 1;
      } else skipped += 1;
    } else if (format === "omp") {
      if (["session", "title", "title_change"].includes(text(row.type))) continue;
      let message: Row;
      if (["compaction", "branch_summary"].includes(text(row.type))) message = { role: "harness", content: row.summary ?? row.shortSummary };
      else if (row.type === "custom_message") message = { role: "harness", content: row.content, attribution: row.attribution };
      else if (row.recordType === "message") message = { ...object(row.message), attribution: "agent" };
      else if (row.recordType === "stderr") message = { role: "tool", content: row.text };
      else if (row.type === "message") message = object(row.message);
      else { skipped += 1;continue; }
      const given = text(message.role);
      const author: TraceRole = message.synthetic ? "harness" : message.attribution === "agent" ? "agent"
        : ["toolResult", "tool-result"].includes(given) ? "tool"
          : ["user", "human"].includes(given) ? message.attribution === "user" ? "user" : "unknown" : role(given);
      for (const block of blocks(message.content)) {
        const type = text(block.type, "text");
        if (isMedia(block)) emit(format, identity, line, "attachment", author, "[attachment omitted]", timestamp ?? message.timestamp);
        else if (author === "tool") emit(format, identity, line, "tool_result", author, (message.isError ? "[tool error] " : "") + text(block.text), timestamp ?? message.timestamp, message.toolName);
        else if (type === "text") emit(format, identity, line, "message", author, block.text, timestamp ?? message.timestamp);
        else if (type === "thinking") emit(format, identity, line, "reasoning", "assistant", block.thinking ?? block.summary, timestamp ?? message.timestamp);
        else if (type === "toolCall") emit(format, identity, line, "tool_call", "assistant", block.arguments ?? {}, timestamp ?? message.timestamp, block.name);
        else skipped += 1;
      }
    } else if (format === "agent-trace") {
      const data = object(row.data);
      const type = text(row.event_type);
      const id = text(data.session_id) || identity;
      if (type === "user_prompt") emit(format, id, line, "message", data.attribution === "user" ? "user" : data.attribution === "agent" ? "agent" : "unknown", data.prompt ?? data.text ?? data.content ?? "", timestamp);
      else if (["assistant_response", "llm_response"].includes(type)) emit(format, id, line, "message", "assistant", data.text ?? data.content ?? data.response ?? "", timestamp);
      else if (["tool_call", "file_read", "file_write"].includes(type)) emit(format, id, line, "tool_call", "assistant", data.arguments ?? data.input ?? data, timestamp, data.tool_name ?? data.tool ?? data.name ?? type);
      else if (["tool_result", "error"].includes(type)) emit(format, id, line, type === "error" ? "error" : "tool_result", "tool", data.result ?? data.output ?? data.error ?? data, timestamp, data.tool_name);
      else if (type === "decision") emit(format, id, line, "reasoning", "assistant", data.reasoning ?? data.decision ?? data.text ?? data, timestamp);
      else if (!["session_start", "session_end"].includes(type)) skipped += 1;
    } else skipped += 1;
  }
  return { events, skipped, format };
}

async function nativeImport(file: File, hash: string, rows: Positioned[]): Promise<TraceImportResult> {
  const raw = extract(rows, file.name, hash);
  if (!raw.events.length) throw new Error("No supported trace events were found. Use a native Claude Code, Codex, OMP/Pi, agent-trace, or normalized export.");
  const conversations = new Map<string, string>();
  const events: TraceEvent[] = [];
  for (const event of raw.events) {
    const cleaned = redactTraceText(event.text);
    const source = redactTraceText(event.source).text.slice(0, 200);
    const conversationKey = event.source + ":" + event.identity;
    if (!conversations.has(conversationKey)) conversations.set(conversationKey, "conv_" + (await sha256(conversationKey)).slice(0, 32));
    events.push({ id: "event_" + (await sha256(`${hash}:${event.line}:${event.item}`)).slice(0, 40),
      source, conversationId: conversations.get(conversationKey)!, kind: redactTraceText(event.kind).text.slice(0, 200),
      role: event.role, timestamp: event.timestamp, toolName: event.toolName ? redactTraceText(event.toolName).text.slice(0, 200) : null,
      text: cleaned.text, origin: { fileId: hash, line: event.line, item: event.item }, redactions: cleaned.redactions, edited: false });
  }
  const warnings = raw.skipped ? [`${raw.skipped} unsupported records or content blocks were omitted.`] : [];
  if (events.some(event => event.kind === "attachment" || event.text.includes("[attachment omitted]"))) warnings.push("Binary attachment contents are omitted; only text references remain.");
  const redactions = events.reduce((sum, event) => sum + event.redactions, 0);
  const metadata: TraceFile = { id: hash, name: redactTraceText(file.name).text, sha256: hash, bytes: file.size, format: raw.format, events: events.length, skipped: raw.skipped, redactions, warnings };
  return { files: [metadata], events, warnings };
}

async function packImport(value: unknown): Promise<TraceImportResult> {
  const pack = await parseTracePack(value);
  const events: TraceEvent[] = [];
  for (const event of pack.events) {
    const cleaned = redactTraceText(event.content);
    const id = redactTraceText(event.id);
    const conversation = redactTraceText(event.conversation_id);
    const source = redactTraceText(event.source);
    const kind = redactTraceText(event.kind);
    const timestamp = redactTraceText(event.timestamp ?? "");
    const tool = redactTraceText(event.tool_name ?? "");
    // Preserve normal producer IDs. Pseudonymize sensitive opaque IDs instead
    // of collapsing several distinct identities to the same redaction marker.
    const eventId = id.text === event.id ? event.id : "event_" + (await sha256("pack-event:" + event.id)).slice(0, 40);
    const conversationId = conversation.text === event.conversation_id ? event.conversation_id
      : "conv_" + (await sha256("pack-conversation:" + event.source + ":" + event.conversation_id)).slice(0, 32);
    events.push({ id: eventId, source: source.text, conversationId,
      kind: kind.text, role: event.role, timestamp: stamp(timestamp.text),
      toolName: tool.text || null,
      text: cleaned.text, origin: { fileId: event.origin.file_sha256, line: event.origin.line, item: event.origin.item },
      redactions: cleaned.redactions + id.redactions + conversation.redactions + source.redactions + kind.redactions + timestamp.redactions + tool.redactions,
      edited: event.edited || cleaned.text !== event.content });
  }
  const files = pack.files.map(source => ({ id: source.sha256, sha256: source.sha256, name: `Pack source ${source.sha256.slice(0, 12)}`,
    bytes: 0, format: redactTraceText(source.format).text, events: source.selected_events, skipped: 0,
    redactions: events.filter(event => event.origin.fileId === source.sha256).reduce((sum, event) => sum + event.redactions, 0), warnings: [] }));
  return { files, events, warnings: ["Open exports omit original filenames and byte sizes. Their prior export intent is not reused."] };
}

export async function importTraceFiles(files: File[]): Promise<TraceImportResult> {
  if (!files.length) throw new Error("Choose at least one trace file.");
  if (files.length > MAX_TRACE_FILES) throw new Error("Import up to 100 files at a time.");
  if (files.some(file => file.size > MAX_TRACE_FILE_BYTES)) throw new Error("Each trace file must be 25 MiB or smaller.");
  if (files.reduce((sum, file) => sum + file.size, 0) > MAX_TRACE_TOTAL_BYTES) throw new Error("A trace batch must be 100 MiB or smaller.");
  if (files.some(file => !/\.(?:json|jsonl|ndjson)$/i.test(file.name))) throw new Error("Choose JSON, JSONL, or NDJSON trace files. Decompress archives before importing.");
  const merged: TraceImportResult = { files: [], events: [], warnings: [] };
  const seenEvents = new Map<string, TraceEvent>();
  const seenFiles = new Set<string>();
  let duplicates = 0;
  for (const file of files) {
    const bytes = await readBytes(file);
    let content: string;
    try { content = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { throw new Error("Trace files must be valid UTF-8 text."); }
    const hash = await sha256(bytes);
    const parsed = parseRows(content, file);
    const imported = text(object(parsed.document).schema).startsWith("agent-me.trace-pack.") ? await packImport(parsed.document) : await nativeImport(file, hash, parsed.rows);
    for (const event of imported.events) {
      const previous = seenEvents.get(event.id);
      if (previous) {
        if (previous.text !== event.text || previous.role !== event.role || previous.kind !== event.kind || previous.source !== event.source) throw new Error("Conflicting versions of the same trace record were found. Review these files separately.");
        duplicates += 1;continue;
      }
      seenEvents.set(event.id, event);merged.events.push(event);
      if (merged.events.length > MAX_TRACE_EVENTS) throw new Error("Import up to 50000 events per batch; choose a smaller set of files.");
    }
    for (const metadata of imported.files) {
      if (!seenFiles.has(metadata.id)) { seenFiles.add(metadata.id);merged.files.push(metadata); }
    }
    merged.warnings.push(...imported.warnings);
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  if (duplicates) merged.warnings.push(`${duplicates} duplicate events were omitted.`);
  merged.files = merged.files.map(file => {
    const owned = merged.events.filter(event => event.origin.fileId === file.id);
    return { ...file, events: owned.length, redactions: owned.reduce((sum, event) => sum + event.redactions, 0) };
  });
  merged.warnings = [...new Set(merged.warnings)];
  return merged;
}
