import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { PackedEvent, TracePack } from "../../frontend/src/traceTypes";

const rangeSchema = z.object({
  min: z.number().int().min(0).max(1_000_000),
  max: z.number().int().min(0).max(1_000_000),
}).strict().refine(({ min, max }) => min <= max, "Minimum must not exceed maximum.");
const rateCardSchema = z.object({
  schema: z.literal("agent-me.trace-rate-card.v1"),
  version: z.string().min(1).max(80),
  status: z.literal("experimental"),
  currency: z.enum(["USD", "CAD", "EUR", "GBP"]),
  planning_contributor_share_bps: z.number().int().min(1).max(10_000),
  paired_conversation_minor: rangeSchema,
  tool_evidence_conversation_minor: rangeSchema,
}).strict();

export type RateCard = z.infer<typeof rateCardSchema>;

// Planning assumptions, not a claim about prices accepted by buyers or a payout promise.
export const DEFAULT_RATE_CARD: RateCard = {
  schema: "agent-me.trace-rate-card.v1",
  version: "2026-10-25-draft-1",
  status: "experimental",
  currency: "USD",
  planning_contributor_share_bps: 7000,
  paired_conversation_minor: { min: 5, max: 25 },
  tool_evidence_conversation_minor: { min: 25, max: 200 },
};

export async function loadRateCard(path?: string): Promise<RateCard> {
  return rateCardSchema.parse(path ? JSON.parse(await readFile(path, "utf8")) : DEFAULT_RATE_CARD);
}

function normalized(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

function role(event: PackedEvent): "human" | "assistant" | "tool" | null {
  if (event.role === "human" || event.role === "user") return "human";
  if (event.role === "assistant" || event.role === "agent") return "assistant";
  if (event.role === "tool") return "tool";
  return null;
}

function signals(events: PackedEvent[]) {
  const parts: { role: "human" | "assistant" | "tool"; content: string }[] = [];
  for (const event of events) {
    const eventRole = role(event);
    const content = normalized(event.content);
    if (!eventRole || !content) continue;
    const previous = parts.at(-1);
    if (previous?.role === eventRole) {
      // Splitting one response across records must not create extra earning units.
      previous.content = `${previous.content} ${content}`;
    } else parts.push({ role: eventRole, content });
  }
  const firstHuman = parts.findIndex((part) => part.role === "human");
  let lastAssistant = -1;
  parts.forEach((part, index) => { if (part.role === "assistant") lastAssistant = index; });
  const paired = firstHuman >= 0 && lastAssistant > firstHuman;
  const toolEvidence = paired && parts.some((part, index) =>
    part.role === "tool" && index > firstHuman && index < lastAssistant);
  const fingerprint = createHash("sha256").update(JSON.stringify(parts)).digest("hex");
  return { paired, toolEvidence, fingerprint };
}

/** Estimate only the reviewed selection. Observable structure never proves outcome or ownership. */
export function estimateValue(pack: TracePack, inputPolicy: RateCard = DEFAULT_RATE_CARD) {
  const policy = rateCardSchema.parse(inputPolicy);
  if (pack.privacy?.manual_review_confirmed !== true) {
    throw new Error("Review the selected records and prepare an export before estimating its value.");
  }
  const groups = new Map<string, PackedEvent[]>();
  for (const event of pack.events) {
    const key = JSON.stringify([event.source, event.conversation_id]);
    const group = groups.get(key) ?? [];
    group.push(event);
    groups.set(key, group);
  }
  const seen = new Set<string>();
  let paired = 0;
  let toolEvidence = 0;
  let duplicates = 0;
  let incomplete = 0;
  for (const events of groups.values()) {
    const signal = signals(events);
    if (!signal.paired) { incomplete++; continue; }
    if (seen.has(signal.fingerprint)) { duplicates++; continue; }
    seen.add(signal.fingerprint);
    if (signal.toolEvidence) toolEvidence++;
    else paired++;
  }
  const lineItems = [
    { tier: "paired_conversation", count: paired, contributor_unit_minor: policy.paired_conversation_minor },
    { tier: "tool_evidence_conversation", count: toolEvidence, contributor_unit_minor: policy.tool_evidence_conversation_minor },
  ].map((item) => ({ ...item, subtotal_minor: {
    min: item.count * item.contributor_unit_minor.min,
    max: item.count * item.contributor_unit_minor.max,
  } }));
  const min = lineItems.reduce((sum, row) => sum + row.subtotal_minor.min, 0);
  const max = lineItems.reduce((sum, row) => sum + row.subtotal_minor.max, 0);
  return {
    status: paired + toolEvidence ? "experimental_estimate" : "no_eligible_conversations",
    not_an_offer: true,
    confidence: "low",
    policy_version: policy.version,
    currency: policy.currency,
    selection_sha256: pack.integrity.sha256,
    conditional_contributor_estimate_minor: { min, max },
    minimum_possible_payout_minor: 0,
    counts: {
      selected_events: pack.events.length,
      selected_conversations: groups.size,
      eligible_unique_conversations: paired + toolEvidence,
      paired_conversations: paired,
      tool_evidence_conversations: toolEvidence,
      duplicate_conversations_excluded: duplicates,
      incomplete_conversations_excluded: incomplete,
    },
    line_items: lineItems,
    planning_basis: {
      contributor_share_bps: policy.planning_contributor_share_bps,
      implied_gross_licence_receipts_minor: {
        min: Math.ceil(min * 10_000 / policy.planning_contributor_share_bps),
        max: Math.ceil(max * 10_000 / policy.planning_contributor_share_bps),
      },
      research_date: "2026-10-25",
      sources: [
        "https://getdataoffer.com/traces/",
        "https://app.selltraces.com/legal/sell-traces",
        "https://webuydata.io/",
      ],
    },
    explanation: "An experimental estimate if the selected material is accepted and licensed. " +
      "A paired conversation contains a selected human request followed by an assistant response; " +
      "the tool tier also contains a selected tool result before a later assistant response. " +
      "These signals do not establish that a task succeeded or that the original session is complete. " +
      "Exact normalized duplicate conversations and unpaired selections earn no estimated amount. " +
      "Longer text, more record chunks, and broader permissions do not increase a conversation's rate.",
    limitations: [
      "Rates are Agent-Me planning assumptions informed by advertised competitor estimates, not observed buyer transactions.",
      "There is no demonstrated buyer demand or guaranteed sale. Actual payout can be zero or outside this range.",
      "Ownership, rights, redaction quality, useful outcomes, rarity and near-duplicates still require review.",
      "The 70% share is an economic planning assumption, not an accepted licensing or payment agreement.",
      "An actual offer appears only after Agent-Me review. Preparing, estimating or submitting grants no additional use permissions.",
    ],
  };
}
