# Agent-Me product vision

## Core idea

People should be able to extract and own the traces of their AI-agent work, choose
to sell selected traces to us, and turn that experience into a better stack for
their needs. Agent-Me provides open-source extraction and a path from trace data
to measured prompts, skills, harnesses, and smaller models.

This direction comes from the owner's product clarification on October 25, 2026.
The existing private AI Twin and archive search are applications and foundations
within that broader product.

## The product loop

1. **Extract.** Read supported agent histories through open-source adapters.
   Preserve who said or did what, source references, tool activity, observable
   outcomes, and artifact links. Do not label unavailable model internals as data
   we extracted.
2. **Package.** Let the owner inspect and select data, then export a portable
   trace pack. Keep source attribution and track transformations.
3. **Choose a use.** Keep the pack private, move it elsewhere, offer selected
   traces for sale to us, or use it to improve a personal stack. A sale is an
   explicit product flow; extraction alone is not a sale.
4. **Measure.** Capture the user's current stack and representative tasks.
   Separate training, validation, and held-out tests. Historical outputs are
   evidence to assess, not automatically correct training labels.
5. **Improve.** Use GEPA Optimize Anything and other suitable methods to improve
   prompts and skills. Build a tailored harness or curate data to train/adapt a
   smaller model when that is the requested deliverable.
6. **Evaluate and deliver.** Compare the original and candidate on held-out tasks.
   Return useful artifacts, provenance, and results, including cases where no
   improvement was demonstrated. Keep improvements exportable.

## What people get

| Need | Intended deliverable |
| --- | --- |
| Own or move agent history | Open-source extraction and a portable trace pack |
| Sell selected traces to us | A contribution offer and agreed purchase record |
| Improve an existing stack | Measured prompt, skill, or configuration candidates |
| Build an agent for a workflow | A portable harness with task-specific context, tools, and evaluations |
| Use a smaller specialized model | Curated data, a trained model or adapter, and held-out measurements |

Trace purchasing and optimization services are separate commercial activities.
Prices, payment mechanisms, acceptance criteria, and usage terms are not yet
specified. The code must distinguish a user's private optimization data from a
pack they explicitly choose to offer for sale or other training uses.

## Current implementation and gaps

- **Implemented foundation:** local Claude/Codex/OMP adapters and saved-work
  ingestion, a verified private archive reader, private workspace storage, and
  inspectable RAG/evaluation contracts. The owner's bulk import remains a separate
  running operation until its completion and verification reports succeed.
- **Implemented optimizer:** real GEPA with local Ollama, archive-selected cases,
  separate train/validation/test groups, bounded runs, candidate receipts, and
  downloads. Results are model-judge proxies. It does not install the candidate
  or prove that tools execute correctly. See [Optimization](OPTIMIZATION.md).
- **Implemented trace review/export:** the public browser-local `/traces` flow
  reads supported local files, offers explicit selection and redacted edits, and
  exports portable personal packs or draft sale offers. It performs no upload,
  submission, purchase, or payment. See [Trace extraction](TRACES.md).
- **To build:** broader extraction connectors, offer submission and purchase
  flows; stack profiles and actual task-replay
  evaluations; harness generation; training-dataset production; model adaptation
  and deployment.

## Product test

A successful first end-to-end offer lets a person bring real agent traces,
retain a portable copy, and receive one measured improvement to an existing
prompt or skill. Trace sales, generated harnesses, and trained small models can
then extend that working path without being presented as capabilities already
shipped.

See [Roadmap](../ROADMAP.md) for priorities and supporting AI Twin work.
