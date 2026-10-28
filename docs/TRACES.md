# Extract, review, and export traces

Open **Trace studio** from the app navigation, or visit `/traces` directly. This
flow works without an account, backend, model provider, mounted vault, or the
owner's large archive import. Extraction and export run in the browser. Nothing
is uploaded until you explicitly confirm and send a selected sale-offer pack.
See [Submissions and buyer review](SUBMISSIONS.md) for that separate step.

## Start locally

With the repository's supported Node.js runtime:

```bash
npm --prefix frontend ci
npm --prefix frontend run dev -- --host 127.0.0.1
```

Open the `/traces` path on the URL Vite prints (usually
`http://localhost:5173/traces`). Production static hosting must route `/traces`
to the SPA's `index.html`; the repository's Nginx setup already has that fallback.
You can use the [fictional sample](../frontend/public/examples/trace-sample.jsonl)
to try the flow. It contains no real customer data.

## Review and choose

1. Choose one or more supported trace files. The browser reads only the files
   you explicitly select. Opening a new batch replaces the current review after
   the entire new batch parses successfully. Cancelling or a failed import keeps
   the current review.
2. Inspect the source, role, kind, conversation, and redacted text. Nothing is
   selected automatically. Search and filter by source or show selected/excluded
   records. Page selection applies only to the visible page.
3. Open a record to review its full text. Remove sensitive details and save the
   edit, or exclude that record. Tool text is not clipped; embedded binary media
   is omitted. Source files remain unchanged.
4. Choose **Personal copy** or **Offer selected traces to Agent-Me**. A sale-offer
   draft also records which uses you want reviewed: stack optimization,
   evaluation, or small-model training. These preferences are not agreed terms.
5. Review the selected subset and confirm it. Selection, content, note, purpose,
   or use-preference changes reset that confirmation. Unsaved edits to selected
   records block export.
6. Download the JSON trace pack. It contains only selected records, their saved
   text, and references to their source files. Unselected records, unselected
   edits, original filenames, and unselected file metadata are excluded.

An offer export is a **local draft** with `submitted: false`. Downloading does not
submit it. Choose **Send selected pack** to inspect a submission preview, enter a
title, and explicitly confirm sending to Agent-Me. You can also load an exported
draft at `/submit`. Submission status is stored separately from the sealed pack.
A proposal and response do not complete a purchase, agreement, or payment.

Refresh or **Clear all trace data** removes the browser's in-memory review state.
The review does not put traces in localStorage, IndexedDB, or cookies. Explicitly
submitted packs are stored in the separate private intake described in
[Submissions](SUBMISSIONS.md). Files already downloaded remain wherever the owner
saved them. Save the private submission receipt before leaving its page.

## Source formats and limits

Supported text sources:

- Claude Code session JSONL from `~/.claude/projects`;
- Codex rollout JSONL from `~/.codex/sessions` or `archived_sessions`;
- OMP/Pi session JSONL from `~/.omp/agent/sessions` or `~/.pi/agent/sessions`;
- agent-trace `events.ndjson`;
- normalized JSON/JSONL conversations with `source`, `conversation_id` or
  `identity`, and `events` containing `role`, `kind`, and `text` or `content`;
- Agent-Me trace pack v1 JSON exports.

Choose up to 100 files, 25 MiB per file, 100 MiB total, and 50,000 extracted events
per batch. Each exported pack is at most 25 MiB so it can be reopened. Export
smaller selections as separate packs for larger datasets. Individual exported
record text is limited to 2 million characters. Compressed archives, SQLite
files, and binary attachments are not accepted by this browser flow; decompress
or create supported text exports first.

Malformed JSON or invalid UTF-8 rejects the new batch without a partial import.
Unsupported rows/blocks are omitted with extraction notes. This extracts stored
records; it does not reconstruct missing tool output or unavailable model internals.
Native sessions preserve harness/subagent roles where indicated. Unattributed
OMP and generic agent-trace prompts are conservatively labelled `unknown`.
Declared roles and source checksums are not proof of identity or factual truth.

## Redaction and provenance

Credential patterns, structured sensitive keys, common provider tokens, private
keys, authorization values, home-directory names, email-like text, and embedded
media data are redacted before review. Saved edits and exported text are redacted
again. This is best-effort assistance, not complete anonymization. Review project
names, proprietary code, customer details, and other sensitive material yourself.

Conversation IDs are pseudonymous; event IDs are deterministic. Events retain a
source file SHA-256 plus line/item coordinates. JSONL uses physical line numbers;
JSON documents use line 1 and item positions. Packs omit original filenames and
raw source bytes. Source checksums may cover an original file that also held
unselected records, but those records are not included.

Opening a trace pack checks its version, shape, event content hashes, provenance
references, selection totals, and overall checksum before review. Prior sale
intent and selection are not carried into a new review; nothing becomes selected
automatically. Historical text always has `trust: untrusted_trace` and
`instruction_authority: none`, and is rendered as text rather than executed.

## Portable pack v1

The machine-readable [JSON schema](../frontend/public/schemas/trace-pack.v1.schema.json)
is served at `/schemas/trace-pack.v1.schema.json`. It describes:

- `schema`, pack `id`, `created_at`, and `intent`;
- a draft `offer` for sale exports, or `null` for personal exports;
- selected event/conversation/source counts;
- review/redaction flags and selected source references;
- selected `events` with author roles, reviewed content, source position, content
  hashes, edit flags, and no instruction authority;
- an overall SHA-256 integrity checksum.

For the overall checksum, remove `integrity`, sort object keys recursively,
retain array order, serialize compact UTF-8 JSON, and hash those bytes. Event
hashes cover the UTF-8 exported content. These detect changes, not authorship;
anyone with the data can recompute a checksum. Cross-field counts, file references,
and hashes are checked by the parser in addition to the JSON schema.

## Verification

```bash
npm --prefix frontend test
npm --prefix frontend run build
npm --prefix frontend run lint
```

Tests cover native attribution, full tool text, redaction, malformed/oversized
inputs, no automatic selection, edited selected-only exports, draft sale intent,
reimports, integrity failures, and a real import → review → export → reopen flow
with network access forbidden.

## Interface

Trace Studio uses a compact trace library with a sticky pack summary and green
actions. Empty, imported, editing, filtered, failed-import, and download states
share the same review/export rules. Displayed counts derive from loaded records;
the interface does not invent prices or earnings estimates. DM Sans is hosted
locally with its [font license](../frontend/public/fonts/OFL.txt).
