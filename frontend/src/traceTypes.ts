export type TraceRole = "user" | "human" | "assistant" | "tool" | "agent" | "harness" | "system" | "developer" | "document" | "unknown";
export type TraceOrigin = { fileId: string; line: number; item: number };
export type TraceEvent = {
  id: string; source: string; conversationId: string; kind: string; role: TraceRole;
  timestamp: string | null; toolName: string | null; text: string;
  origin: TraceOrigin; redactions: number; edited: boolean;
};
export type TraceFile = {
  id: string; name: string; sha256: string; bytes: number; format: string;
  events: number; skipped: number; redactions: number; warnings: string[];
};
export type TraceImportResult = { files: TraceFile[]; events: TraceEvent[]; warnings: string[] };
export type TraceIntent = "personal_export" | "sale_offer";
export type RequestedUse = "stack_optimization" | "evaluation" | "small_model_training";
export type TracePackOptions = {
  intent: TraceIntent; requestedUses: RequestedUse[]; note: string; reviewConfirmed: boolean;
};
export type PackedEvent = {
  id: string; source: string; conversation_id: string; kind: string; role: TraceRole;
  timestamp: string | null; tool_name: string | null; content: string;
  origin: { file_sha256: string; line: number; item: number };
  content_sha256: string; edited: boolean; trust: "untrusted_trace"; instruction_authority: "none";
};
export type TracePack = {
  schema: "agent-me.trace-pack.v1"; id: string; created_at: string; intent: TraceIntent;
  offer: { recipient: "Agent-Me"; status: "draft"; submitted: false; requested_uses: RequestedUse[]; note: string } | null;
  selection: { events: number; conversations: number; sources: Record<string, number> };
  privacy: { automatic_redaction: true; manual_review_confirmed: true; attachments_included: false };
  files: { sha256: string; format: string; selected_events: number }[];
  events: PackedEvent[];
  integrity: { algorithm: "sha256"; sha256: string };
};
