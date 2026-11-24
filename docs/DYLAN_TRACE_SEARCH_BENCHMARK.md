# Agent Me trace retrieval: DYLAN benchmark

Measured 2026-11-14. This is an offline comparison on a public conversation
retrieval proxy, not a measurement on real Agent Me traces or a production
recommendation. No private corpus or user trace was opened or exported.

## Re-run after the FTS fix

On 2026-11-14 the external corpus builder was changed to create new FTS
indexes with `detail=full`. Agent Me's corpus status now reports whether an
attached index has the older unranked settings. Existing indexes are not modified;
build a new index from original sources and verify it before switching to it.

The runner was updated to invoke the actual corrected builder's schema, with the
same public pooled corpus and embeddings described below. The rerun produced:

| Arm | Recall@10 | Hit@10 |
| --- | ---: | ---: |
| Fixed-builder Agent Me FTS | 0.7449 | 0.8500 |
| Legacy index control | 0.0160 | 0.0160 |
| DYLAN exact vectors | 0.4933 | 0.6260 |
| DYLAN approximate, ef 32 | 0.4791 | 0.6060 |
| DYLAN approximate, ef 128 | 0.4933 | 0.6260 |

The new FTS result is directly measured using Agent Me's search and the corrected
builder's FTS schema. The dataset, one-document-per-session fixture, unequal
text surfaces, and timing caveats below still apply. FTS took 7.32 seconds for
500 calls; DYLAN ef 128 took a 0.213-second median for a CLI batch of 500
pre-embedded queries. These are different interfaces and do not include model
inference; they are not an end-to-end latency comparison. No private index was
opened or rebuilt. The tables and discussion in the following sections record
the earlier experiment and do not describe the current builder default.

## Current search and integration

Trace Studio's `frontend/src/TraceStudio.tsx` filters locally loaded events by
case-insensitive substring, source, and selection state. It has no similarity
ranking in that path. The separate private `backend/app/corpus.py` search uses
SQLite FTS, limits results by allowed roles, deduplicates by conversation, and
returns untrusted review-only evidence. The external corpus builder
`scripts/ai_corpus_semantic_index.py` previously defined `document_fts` as a contentless
FTS5 table with `detail=column`; its schema also defines stored conversation
vectors, though the inspected Agent Me search does not query them.

A plausible optional feature is **Find similar traces** for explicitly selected
local records, using a separate derived vector index and preserving source
references, redaction, consent, and existing export selections. Do not silently
replace Trace Studio's literal search, upload traces, or treat retrieved text as
instructions. A native C++ index needs a deployment bridge: the existing
browser-only trace review cannot directly invoke a native binary. Source, role,
and kind are available in Trace Studio; project, tool, and outcome filters need
verified metadata or an explicit unknown value. Reapply the authoritative
selection and access rules after candidate retrieval, and handle edits, deletes,
and stale vectors. The [DYLAN implementation](https://github.com/CUHK-DBGroup/DYLAN)
uses squared L2; cosine equivalence requires normalized nonzero vectors. Check
its license and dependencies before distributing it; no repository-level license
file was visible in the inspected checkout. Its supported build is Linux/GCC;
this run used macOS ARM64 and AppleClang with manual x86 SIMD disabled.

## Experiment

- Actual `CorpusIndex.search` code was imported from Agent Me; SHA-256
  `ca5cb666e7960d31eb7136ff405a31b86b708806a7828327a5ed1e28d38df9cc`.
  The temporary SQLite index used the builder's `content=''`, `detail=column`
  settings, `all_events` scope, one session per conversation and one searchable
  document per session. Unlike the real builder, this fixture did not apply its
  redaction, chunking or bounded excerpts. It indexed full session text.
- The pooled LongMemEval oracle dataset contained 940 distinct sessions and
  500 questions. As in an earlier retrieval benchmark, sessions were pooled as
  distractors because the oracle's original haystacks contain the answer
  sessions. This is a conversation-memory benchmark, not a benchmark of trace
  tasks, source filters, or multi-event conversations.
- DYLAN source revision `250a52390005e500548ca6b4cf82b3bfab7e550a` used the
  existing qwen3-embedding:0.6b 1024-dimensional embeddings of session heads
  truncated to 2,000 characters and the question text. Vectors were normalized.
  Every session and query received the same synthetic label; filtering was not
  evaluated. Embedding time and model memory are excluded.
- Recall@10 is the mean fraction of answer sessions in the first ten results;
  hit@10 is the fraction of questions with at least one answer session there.
  DYLAN neighbor recall compares its approximate top ten with its exact vector
  top ten, not with human relevance labels.

| Arm | Recall@10 | Hit@10 | Other |
| --- | ---: | ---: | --- |
| Agent Me FTS, builder index settings | 0.0160 | 0.0160 | actual search code; zero rank scores in this fixture |
| Agent Me FTS, `detail=full` control | 0.7449 | 0.8500 | same search code and text; temporary index change |
| DYLAN exact vector search | 0.4933 | 0.6260 | precomputed embeddings |
| DYLAN approximate, ef 32 | 0.4791 | 0.6060 | exact-neighbor recall@10 0.9902 |
| DYLAN approximate, ef 128 | 0.4933 | 0.6260 | exact-neighbor recall@10 1.0000 |

At the time of that earlier experiment the FTS control was not yet an implemented fix.
On this machine, SQLite 3.54.0 returned `-0.0` rank for matched rows in the
contentless `detail=column` fixture. A minimal two-matching-document reproduction
also returned both scores as `-0.0`; changing to `detail=full` produced distinct
scores. The fixture matches the builder's FTS settings, but the deployed index,
SQLite version, and live behavior were not inspected. Verify those before
concluding the same issue occurs in a deployment. Equal ranks make the measured
baseline sensitive to insertion order.

In the last run, 500 direct Python FTS calls took 10.56 s for the current fixture
and 14.44 s for the control. DYLAN batch search medians for 500 pre-embedded
queries were 0.136 s at ef 32 and 0.248 s at ef 128, including process startup,
index loading, and output writes. The index file was 4,169,754 bytes and its
batch build took 0.52 s. These times have different interfaces and exclude model
inference; they are not comparable end-to-end latency or throughput claims.

Dataset SHA-256:

- `longmemeval_oracle.json`: `821a2034d219ab45846873dd14c14f12cfe7776e73527a483f9dac095d38620c`
- `longmemeval_embeddings.json`: `e2a6fb9b86fff05685204752b37c5383492937d49487b4ca0734c920c02d321b`

## Reproduce

With the authors' CLI built separately, the existing retrieval benchmark artifacts,
and Python 3, run:

```bash
python3 scripts/benchmark_agent_me_dylan.py \
  --agent-me "$PWD" \
  --builder /path/to/ai_corpus_semantic_index.py \
  --dylan /path/to/dylan \
  --corpus /path/to/longmemeval_oracle.json \
  --embeddings /path/to/longmemeval_embeddings.json
```

The runner creates a temporary SQLite corpus and index, never starts Agent Me,
and prints aggregate metrics. The public artifacts are not included in Agent Me.
The runner uses the current builder schema and creates a legacy `detail=column`
control; no existing index or source file is modified.

## Next experiment

First verify FTS ranking on a representative, consented index and deployed
SQLite version; evaluate a rebuilt index in isolation, including size and search
cost. Then compare fixed FTS, exact vectors, DYLAN, and a hybrid on a held-out,
consented trace-specific relevance set, with realistic project/tool/outcome
filters and authorization. Measure relevance, neighbor recall, build and update
costs, memory, and per-query end-to-end latency including embedding. DYLAN is an
indexing method and cannot correct weak embeddings; the lexical control wins on
this particular proxy. Do not infer production quality or deployment readiness
from this run.
