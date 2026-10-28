# Improve prompts and skills with GEPA

The private workspace's **GEPA optimizer** prepares relevant historical examples,
optimizes pasted prompt or SKILL.md text, and offers a candidate and a JSON receipt
for review. Source prompts, skills, and confirmed memories are never overwritten.

## Setup

Use Python 3.11–3.14 and install the backend's optional optimizer:

```bash
cd backend
uv sync --extra optimize
```

Start Ollama and install the configured model, for example `ollama pull qwen2.5:7b`.
The optimizer has a separate model setting from private chat:

```text
OPTIMIZATION_OLLAMA_URL=http://127.0.0.1:11434
OPTIMIZATION_MODEL=qwen2.5:7b
PERSONAL_OPTIMIZATION_DIR=/absolute/private/directory/optimization
```

If no optimization directory is specified, receipts are stored inside
`PERSONAL_DATA_DIR/optimization`. For encrypted storage, point it inside the
mounted history vault. Directories are private and JSON files use mode 0600.
Keep the vault mounted when either the corpus or receipts are stored there.
Private routes require the existing owner token and use `Cache-Control: no-store`.
Deploy one backend worker per private workspace; one optimization runs at a time.

Optimization remains unavailable until a completed all-events work index is
connected with `PERSONAL_CORPUS_INCLUDE_WORK=true`, its expected SHA-256 matches,
and the local model and optional GEPA package are available. It cannot read an
in-progress import. By default, no external provider is contacted;
Ollama's configured endpoint receives the selected evidence and candidate text.

## Workflow

1. Unlock the private workspace. Paste the current prompt or skill and specify
   its improvement objective.
2. Search for relevant archive examples, selecting 6–60 tasks. The search can
   draw from every imported source category. Each run uses a bounded sample,
   not every event in a single model context.
3. Review the training examples, source counts, archive digest, and split sizes.
   Exact normalized owner requests are deduplicated across conversation mirrors;
   conversation/task groups belong to one split. Histories without an authenticated
   owner request use your current query as the task and retain their original roles.
4. Choose the evaluation budget and run GEPA. The minimum covers baseline
   validation and one complete proposal. A conservative proposal cap keeps full
   batches within the search metric budget. Reflection and final held-out checks
   add model calls; all calls and progress are recorded, with a separate hard cap.
5. Review the candidate against the original and the held-out score comparison.
   Download the candidate Markdown and JSON receipt if useful. Applying it to a
   real source file or installing a skill is a separate action.

GEPA sees training and validation cases. Test cases stay outside its search and
reflection; after candidate selection freezes, baseline and candidate are compared
on the same held-out tasks. If the original is retained, only its baseline is
evaluated: `comparison_status` is `original_retained` and `candidate_test_score`
is null. The UI also recognizes original retention in older receipts by exact
artifact equality. A distinct candidate can legitimately tie the baseline.

Search receipts report proposal attempts, generated rewrites, accepted/rejected
rewrites, skipped iterations and the proposal budget. These differ from the
retained candidate pool, which excludes rejected proposals. A single held-out
task is a diagnostic sample, not reliable evidence of general improvement.

Evaluation caching is disabled. GEPA 0.1.4 uses overlapping positional IDs for
plain-list training and validation loaders, allowing cached training scores to
replace validation scores. Earlier runs with that cache enabled cannot establish
correct validation-based candidate selection; rerun them with fresh evaluations.
The private search audit preserves proposed artifacts, rejection decisions,
per-case feedback and held-out responses. Model-call counts are recorded
separately from GEPA callback counts. Historical outputs remain visible as
reference evidence to the generator, so this is a simulation rather than a
blind answer-reconstruction benchmark.

Each evaluation simulates an answer using the candidate, then asks the local model
to judge that answer against the task, objective, and historical reference evidence.
Scores are **model-judge proxies**, not proof of factual correctness, actual tool
execution, successful deployments, or generalized skill improvement. Historical
assistant/tool output is untrusted reference material, never a verified gold answer.
Binary assets contribute their indexed references, not image/audio understanding.
Invalid judgments fail the run instead of receiving an invented score.

Progress, selected datasets, split IDs, archive SHA, model, candidates, and held-out
comparisons persist in the private directory. Failed runs retain an error receipt;
unfinished receipts from a restarted server are marked interrupted. Graceful
shutdown joins owned jobs. Start a fresh run to retry; jobs are not silently resumed.

## API and checks

Authenticated endpoints are under `/api/v1/personal/optimization`:
`GET /status`, `POST /datasets`, `GET /runs`, `POST /runs`, and
`GET /runs/{id}`. The latter accepts `wait_seconds=1..20` as an awaitable
completion probe. Dataset and run request models reject unknown fields.

```bash
cd backend
uv run --extra dev --extra optimize pytest tests/test_optimization.py \
  tests/test_optimization_data.py tests/test_optimization_engine.py
```

The engine regression uses the real GEPA library with a deterministic substitute
for the external model, checks actual candidate improvement, and checks that
held-out markers never appear in reflection.
