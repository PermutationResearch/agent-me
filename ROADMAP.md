# Agent-Me Roadmap

## From owned traces to a better agent stack

Agent-Me's main product is an open-source extraction and improvement platform. People can extract and own their agent traces, optionally sell selected trace packs to us, and use their work history to improve prompts, skills, harnesses, or smaller models for their needs.

A personal AI Twin is one application. [Product vision](docs/PRODUCT_VISION.md) records the core direction. This roadmap separates existing code from proposed capabilities and does not promise release dates.

## Product priorities

1. **Portable extraction and trace packs — first flow implemented.** The public `/traces` studio reads supported local files in the browser, preserves roles and provenance, offers review/redaction/selection, and exports selected-only personal packs or sale-offer drafts. It runs without an account or server upload. See [Trace extraction](docs/TRACES.md). Broader connectors, large archives, and an installable local extraction workflow remain future work.
2. **Optional trace purchasing.** Draft offer packs with requested-use preferences can now be exported locally. Build submission, buyer review, agreed usage, purchase records, and payment flows. Pricing and commercial terms are undecided. Private extraction and personal optimization remain distinct choices from selling data.
3. **Measured stack optimization.** Describe the user's models, prompts, skills, tools, and constraints; build relevant evaluation tasks; use GEPA to propose improvements. A local archive-backed prompt/skill optimizer is implemented. Real task replay, broader stack targets, and reliable outcome labels remain work to do.
4. **Personalized harnesses.** Generate a portable harness with context assembly, tools, skill routing, constraints, and an evaluation suite for the user's tasks. Harness generation is planned; the current sequential RAG workflow is a foundation.
5. **Smaller models for specific needs.** Curate suitable training examples and held-out evaluations, train or adapt a selected model, and return the model/adapter with measurements. Dataset production and training are planned. Importing traces or running GEPA does not itself train model weights.
6. **Portable delivery and repeated improvement.** Deliver prompts, skills, harness configurations, datasets, or models with source lineage and before/after results. The current GEPA candidate and JSON receipt exports are the first delivery path.

**Completion signal:** a person can extract their history, choose what happens to it, and receive a portable improvement whose value is measured on their actual tasks.

## Design principles

Every roadmap contribution should preserve these principles:

1. **The owner stays in control.** Learning, retention, correction, export, and deletion must have clear user controls.
2. **Memory has provenance.** A personal claim should retain where it came from, when it was learned, and how confidently it is held.
3. **Learning is not silent accumulation.** Ingestion requires boundaries, review, deduplication, conflict handling, and forgetting.
4. **Important decisions are inspectable.** Public traces expose evidence, tool activity, stage outcomes, and verification results—not private chain-of-thought.
5. **Uncertainty is a feature.** The twin should distinguish known, inferred, disputed, outdated, and unknown information.
6. **Progress is evaluated.** New capability needs supported, unsupported, adversarial, privacy, and temporal test cases.
7. **The architecture stays understandable.** Prefer typed contracts and bounded components over hidden behavior or unnecessary complexity.

## Current foundation

The repository currently provides:

- reviewable, version-controlled Markdown as the personal knowledge source;
- bounded deterministic retrieval with exact source excerpts;
- Planner, Researcher, Critic, Writer, and optional Verifier roles;
- typed handoffs between agent stages;
- evidence-sufficiency and citation-path checks;
- sources, grounding status, safe public execution traces, and run IDs;
- deterministic evaluation fixtures; and
- a runnable FastAPI + React reference application using fictional public examples.

The opt-in single-owner private workspace additionally provides typed fact, preference,
event, and decision records; server-controlled source links and timestamps; pending/confirmed
review; transactional revision snapshots and same-key supersession; restore-as-candidate;
optional stale-review preconditions; deletion of record snapshots; and snapshot-consistent
version-8 export with learning provenance and forgetting digests. The memory core runs independently of HTTP and model providers, with a
deterministic longitudinal evaluation suite. See [private workspace contracts](docs/PERSONAL.md).

Current boundaries are equally important: public conversations are not persisted; private
conversations are persisted for display but not re-injected as evidence. The knowledge source includes explicit entities and evidence-linked relationships;
pre-migration revision history cannot be reconstructed,
controlled document ingestion supports exact fields and literal paragraph candidates, not autonomous
semantic inference. Alias resolution, declared valid/event time, epistemic states and previewed retention now exist.
Unified hybrid retrieval, live atomic source-value verification and approved local tools now exist;
portable import and operational audit now exist; longitudinal metrics and explicit provider/data disclosure now exist; final acceptance is tracked in the ledger; the Verifier does not prove factual truth or semantic entailment.


Approved document, project, conversation, and event sources can additionally propose pending
memories through the independent learning pipeline. It provides exact excerpts, canonical exact
deduplication, conflict reporting, replayable runs, recoverable failure, revocation, and replay-aware
forgetting. Structured sensitivity labels control context disclosure. A local owner CLI requires
neither an HTTP server nor a model provider. See [learning contracts](docs/LEARNING.md) and the
[full implementation acceptance ledger](docs/AGENT_IMPLEMENTATION.md) for evidence and gaps.


Structured identity now supports seven entity kinds, ambiguity-aware aliases, reviewed relationships,
workspace ownership, memory categories, optional declared confidence, and explicit belief states.
Valid time is distinct from recorded knowledge time; context excludes expired, future and disputed
claims by default. Retention is opt-in, previewed, stale-safe and atomic. See
[identity/time contracts](docs/IDENTITY_TIME.md) for evidence and limits.


The local personal Agent now answers through typed owner-scoped hybrid retrieval, explicit uncertainty,
whole-record budgets and live atomic evidence checks. Public fictional examples cannot establish
owner identity, preferences do not stand in for factual support, and temporal queries do not invent
episode dates. See [personal retrieval contracts](docs/PERSONAL_RETRIEVAL.md).

Typed know/recommend/act routing and three real local task/note tools now provide explicit
per-tool data permissions, reviewed plans, live preconditions, inspectable outcomes, atomic effects,
bounded retries and exact-output rollback. See [local agency contracts](docs/AGENCY.md).

Learning policy now narrows source kinds, labels, candidate batches and keys, and supports stronger
revision-bound review for sensitive/identity keys. Exact cross-record consolidation is explicitly
previewed, digest-approved and history-preserving; it never accepts pending memories. See
[learning control contracts](docs/LEARNING_CONTROL.md).

Digest-reviewed portable import now preserves personal state while moving historical grants/approvals
into inert archives. Content-free ingestion/access audit, independent-copy erasure and explicit SQLite
purge are owner-controlled. See [owner control](docs/OWNER_CONTROL.md) and the
[connected-tool threat model](docs/THREAT_MODEL.md).

Default-off, per-request opt-in provider disclosure is target-bound and label/namespace/entity/record/
document-scoped. Twenty longitudinal stages measure status, coverage, provenance, privacy, preference
fidelity, declared-confidence calibration and correction cost. See
[disclosure](docs/DISCLOSURE.md) and [longitudinal evaluation](docs/LONGITUDINAL_EVALUATION.md).

The private workspace also retrieves a verified all-events archive and offers local GEPA
candidate runs with held-out model-judge comparisons. A browser-local trace selection/export
workflow and a local selected-pack submission and buyer review service are implemented. Trace
purchasing, payment, harness generation, and model training are not implemented. GEPA proxy
scores do not prove actual task success.

## Supporting AI Twin workstreams

### 1. Structured identity and memory

Move from a collection of documents toward explicit, source-linked personal knowledge.

Proposed work includes:

- typed entities for people, projects, organizations, events, ideas, preferences, and decisions;
- relationships between entities without requiring one fixed graph backend;
- episodic, semantic, and preference memory boundaries;
- source, timestamp, confidence, sensitivity, and ownership metadata;
- correction, supersession, deletion, and export semantics; and
- compatibility between structured records and existing Markdown knowledge.

**Completion signal:** the twin can explain what it believes about a person, where that belief came from, and whether it is current or disputed.

### 2. Continuous learning pipeline

Build controlled learning over time rather than silently storing every interaction.

Proposed work includes:

- opt-in ingestion from approved documents, projects, conversations, and events;
- extraction into reviewable candidate memories before acceptance;
- deduplication and entity resolution;
- temporal updates and conflict detection;
- configurable retention, forgetting, and memory consolidation;
- human approval policies for sensitive or identity-defining memories; and
- replayable ingestion traces and failure recovery.

**Completion signal:** new information can update the twin predictably without erasing provenance, accumulating duplicates, or overwriting conflicting history.

### 3. Retrieval over personal context

Retrieve the right mixture of facts, episodes, preferences, decisions, and relationships.

Proposed work includes:

- hybrid retrieval over documents and structured memory;
- temporal and relationship-aware retrieval;
- sensitivity-aware context assembly;
- evidence sufficiency and contradiction detection; and
- retrieval evaluation beyond simple lexical overlap.

**Completion signal:** retrieval quality can be measured across factual, temporal, preference, project, and relationship questions.

### 4. Contextual agency and tools

Allow the twin to help with bounded tasks while keeping actions attributable and reversible.

Proposed work includes:

- typed intent routing;
- explicit tool permissions and per-tool data boundaries;
- plan and approval gates for consequential actions;
- inspectable tool calls and results;
- idempotency, retry, and rollback behavior; and
- separation between what the twin knows, recommends, and is allowed to do.

**Completion signal:** every action can be traced to an intent, plan, permission, tool result, and owner-visible outcome.

### 5. Verification and longitudinal evaluation

Evaluate whether the AI Twin remains faithful and useful as its memory changes.

Proposed work includes:

- atomic claim-to-evidence verification;
- temporal consistency and stale-memory cases;
- preference fidelity without rigid personality imitation;
- contradiction, correction, and deletion tests;
- privacy leakage and prompt-injection cases;
- regression suites for memory and tool behavior; and
- longitudinal measures for calibration, coverage, provenance, and user correction effort.

**Completion signal:** improvements can be demonstrated with repeatable evidence rather than subjective conversations alone.

### 6. Privacy, portability, and owner control

Treat personal context as user-controlled data, not an incidental prompt cache.

Proposed work includes:

- local-first and provider-boundary documentation;
- sensitivity labels and selective disclosure;
- review, correction, export, and deletion interfaces;
- portable memory formats;
- audit records for ingestion and access; and
- threat models for personal knowledge and connected tools.

**Completion signal:** an owner can understand, move, correct, and remove what the twin knows without depending on opaque internal state.

## How to contribute

Contributions are welcome across code, research, design, evaluation, documentation, and security.

Good starting points include:

- propose a small typed memory schema with provenance and correction semantics;
- add an adversarial, temporal, contradiction, or deletion evaluation case;
- design a reviewable candidate-memory ingestion flow;
- improve evidence and execution-trace presentation;
- document a concrete privacy or threat-model boundary;
- prototype a bounded tool contract with explicit permissions; or
- improve the current retrieval, verification, tests, accessibility, or documentation.

Before implementing a substantial workstream item:

1. Search existing issues and discussions.
2. Open a [feature proposal](https://github.com/jzjzzzzzzz/agent-me/issues/new?template=feature.yml).
3. Define the user problem, current boundary, proposed contract, privacy impact, and evaluation plan.
4. Keep the first pull request focused and independently testable.
5. Follow [CONTRIBUTING.md](CONTRIBUTING.md) and run the documented quality gates.

Roadmap proposals do not need to introduce a large dependency or a new agent. A precise schema, test case, threat model, or failure analysis can move the project forward substantially.

## What success looks like

Agent-Me should become more useful as it learns more about its owner—but also more accountable, not less.

The long-term test is not whether it can imitate a person convincingly. It is whether the owner can ask:

- What do you know about me?
- Where did that come from?
- When did it change?
- What are you uncertain about?
- Why did you answer or act this way?
- Can I correct or delete it?

and receive clear, inspectable answers.
