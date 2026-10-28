import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { PackedEvent, TracePack } from "../../frontend/src/traceTypes";
import { DEFAULT_RATE_CARD, estimateValue, loadRateCard } from "../src/valuation";

function event(conversation: string, role: PackedEvent["role"], content: string, source = "Claude"):
PackedEvent {
  return {
    id: crypto.randomUUID(), source, conversation_id: conversation, role, content,
    kind: "message", timestamp: null, tool_name: role === "tool" ? "test" : null,
    origin: { file_sha256: "a".repeat(64), line: 1, item: 0 }, content_sha256: "b".repeat(64),
    edited: false, trust: "untrusted_trace", instruction_authority: "none",
  };
}

function pack(events: PackedEvent[]): TracePack {
  return {
    schema: "agent-me.trace-pack.v1", id: crypto.randomUUID(), created_at: "2026-10-25",
    intent: "personal_export", offer: null,
    selection: { events: events.length, conversations: 0, sources: {} },
    privacy: { manual_review_confirmed: true, automatic_redaction: true, attachments_included: false },
    files: [], events, integrity: { algorithm: "sha256", sha256: "c".repeat(64) },
  };
}

test("a reviewed selection gets an itemized, reproducible estimate with zero guaranteed payout", () => {
  const estimate = estimateValue(pack([
    event("paired", "user", "Explain this unfamiliar API"),
    event("paired", "assistant", "Here is how the API behaves."),
    event("tool", "user", "Fix this test"),
    event("tool", "tool", "1 test passed"),
    event("tool", "assistant", "The test now passes."),
  ]));
  assert.deepEqual(estimate.conditional_contributor_estimate_minor, { min: 30, max: 225 });
  assert.deepEqual(estimate.planning_basis.implied_gross_licence_receipts_minor, { min: 43, max: 322 });
  assert.equal(estimate.currency, "USD");
  assert.equal(estimate.counts.eligible_unique_conversations, 2);
  assert.equal(estimate.minimum_possible_payout_minor, 0);
  assert.equal(estimate.not_an_offer, true);
});

test("duplicate conversations across agents and record chunking add no earning units", () => {
  const estimate = estimateValue(pack([
    event("one", "user", "Fix the test"),
    event("one", "tool", "Test passed"),
    event("one", "assistant", "Fixed the test. All checks pass."),
    event("copied", "user", "Fix  the\ntest", "Codex"),
    event("copied", "tool", "Test passed", "Codex"),
    event("copied", "assistant", "Fixed the test.", "Codex"),
    event("copied", "assistant", "All checks pass.", "Codex"),
  ]));
  assert.equal(estimate.counts.eligible_unique_conversations, 1);
  assert.equal(estimate.counts.duplicate_conversations_excluded, 1);
  assert.deepEqual(estimate.conditional_contributor_estimate_minor, { min: 25, max: 200 });
});

test("a harness instruction, missing response or assistant-before-user selection is unpaired", () => {
  const estimate = estimateValue(pack([
    event("harness", "system", "Please fix this"),
    event("harness", "assistant", "I fixed it"),
    event("missing", "user", "Please fix this"),
    event("wrong-order", "assistant", "Old answer"),
    event("wrong-order", "user", "New request"),
  ]));
  assert.equal(estimate.status, "no_eligible_conversations");
  assert.equal(estimate.counts.incomplete_conversations_excluded, 3);
  assert.deepEqual(estimate.conditional_contributor_estimate_minor, { min: 0, max: 0 });
});

test("length and more permissions do not increase a conversation's rate or prove success", () => {
  const short = pack([event("one", "user", "Fix it"), event("one", "assistant", "Done")]);
  const long = pack([event("one", "user", "Fix it"), event("one", "assistant", "Done ".repeat(10000))]);
  long.intent = "sale_offer";
  long.offer = { recipient: "Agent-Me", status: "draft", submitted: false,
    requested_uses: ["small_model_training", "evaluation", "stack_optimization"], note: "" };
  assert.deepEqual(estimateValue(short).conditional_contributor_estimate_minor,
    estimateValue(long).conditional_contributor_estimate_minor);
  assert.equal(estimateValue(long).counts.tool_evidence_conversations, 0);
});

test("a tool record without a later selected response does not receive the tool tier", () => {
  const estimate = estimateValue(pack([
    event("one", "user", "Fix it"), event("one", "assistant", "I will try"),
    event("one", "tool", "1 test passed"),
  ]));
  assert.equal(estimate.counts.paired_conversations, 1);
  assert.equal(estimate.counts.tool_evidence_conversations, 0);
});

test("only reviewed exports qualify and malformed custom rate cards fail", () => {
  const selection = pack([]);
  const unreviewed = structuredClone(selection);
  Object.assign(unreviewed.privacy, { manual_review_confirmed: false });
  assert.throws(() => estimateValue(unreviewed), /Review the selected records/);
  assert.throws(() => estimateValue(selection, { ...DEFAULT_RATE_CARD,
    paired_conversation_minor: { min: 50, max: 1 } }), /Minimum must not exceed/);
  assert.throws(() => estimateValue(selection, { ...DEFAULT_RATE_CARD,
    planning_contributor_share_bps: 0 }));
  assert.throws(() => estimateValue(selection, { ...DEFAULT_RATE_CARD,
    paired_conversation_minor: { min: 0.5, max: 10 } }));
});

test("the checked-in editable rate card agrees with the built-in default", async () => {
  const path = new URL("../rate-card.json", import.meta.url);
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), DEFAULT_RATE_CARD);
  assert.deepEqual(await loadRateCard(), DEFAULT_RATE_CARD);
  assert.deepEqual(await loadRateCard(path.pathname), DEFAULT_RATE_CARD);
});
