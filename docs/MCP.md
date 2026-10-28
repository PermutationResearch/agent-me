# Agent-Me MCP

Agent-Me's local stdio MCP lets a compatible agent discover supported history files, extract chosen traces, inspect redacted records, prepare a selected export, estimate its potential value, run GEPA on selected evidence with local Ollama or approved free OpenRouter, and submit that export for review. It uses the **same TypeScript extraction, redaction and portable export code as the website**. It never edits source histories or installs optimized prompts automatically.

This is a source install, not a published npm package. No public hosting is enabled by this implementation. The review endpoint defaults to `http://127.0.0.1:8001`.

## Install and connect

Requires Node.js 22+. From your Agent-Me checkout:

```sh
npm --prefix mcp ci
npm --prefix mcp run build
```

Add this to a client that accepts standard `mcpServers` entries, replacing the absolute path:

```json
{
  "mcpServers": {
    "agent-me": {
      "command": "node",
      "args": ["/absolute/path/to/agent-me/mcp/dist/server.js"]
    }
  }
}
```

For Codex, the equivalent configuration is:

```toml
[mcp_servers.agent_me]
command = "node"
args = ["/absolute/path/to/agent-me/mcp/dist/server.js"]
```

Use the client's MCP settings to add the entry, then reconnect/restart that client as required. OMP/Pi requires an MCP-capable extension or adapter; the server does not assume every OMP/Pi installation natively supports MCP. The build includes the shared frontend adapters, so keep this repository layout when rebuilding. This task does not modify any user's global client configuration.

Suggested opening request:

> Use Agent-Me to find my Claude Code, Codex and OMP/Pi history. Show me the projects and files before extracting them. Help me review and select the records I own and want to include, estimate their potential value, and prepare an export. Ask before sending anything. If I choose optimization, use my selected examples to improve a prompt or skill and show the held-out comparison.

The browser setup guide is at `/mcp`; selected JSON exports can be opened at `/traces` or uploaded at `/submit` for a sale-offer draft. Personal exports cannot be submitted until a new reviewed sale selection is prepared.

## Workflow and tools

| Tool | Result / boundary |
| --- | --- |
| `get_agent_me_status` | Storage, configured review destination, draft rate card and actual GEPA dependency availability. No history scan or model request. |
| `discover_trace_sources` | Bounded filename/size metadata under known history roots or explicitly supplied absolute folders. Does not read file contents. |
| `extract_traces` | Explicit source paths only. Redacted local extraction and ID; sources unchanged. JSON/JSONL/NDJSON, 100 files, 25 MiB/file, 100 MiB/batch. Decompress archives separately. |
| `review_trace_records` | Search/page previews. Supply explicit `event_ids` to review text in chunks using `text_offset` / `text_limit` (20,000 characters max per record). Continue until `next_text_offset` is null. |
| `prepare_trace_export` | Explicit selected IDs, optional edits, personal/sale intent and permitted uses. Requires `confirm_review:true` from the contributor's review. Writes the existing `agent-me.trace-pack.v1` JSON and checksum, without uploading. |
| `estimate_trace_value` | Draft policy version, selected-only eligible/excluded counts, line-item calculation and conditional range. It is not an offer; actual payout can be zero. |
| `start_optimization` | Seed prompt or SKILL.md **text**, objective, installed Ollama model and selected export ID. Starts an owned Python subprocess running actual GEPA. |
| `get_optimization` | Progress or final candidate and held-out proxy scores; `wait_seconds` 0–20 provides an awaitable completion seam. |
| `submit_trace_export` | Only network write. Requires reviewed sale intent, exact export checksum, explicit contributor `confirm_submission:true` and configured destination. Saves receipt before sending. No sale/payment/acceptance. |
| `get_submission_status` | Review status and offers using the private saved receipt. Buyer-only notes are not returned. |

The `agent-me://workflow` resource provides this sequence to the connected agent. Each tool returns structured JSON plus a text representation for broad client compatibility. Errors are reported as MCP tool errors. Tool descriptions and server instructions require contributor decisions; a model's boolean is not independently verified human consent. Clients should retain approval prompts for export/submission tools.

## Privacy and receipts

Extraction/redaction run on the machine hosting this MCP. **Tool results are visible to the MCP client and its configured model**; if that model is remote, reviewed excerpts may be sent to its provider. Choose a local client/model when that is required. The server does not independently upload raw histories. Automated redaction is incomplete by nature; review confidential content, ownership and permissions before export or submission.

Default state: `~/.local/share/agent-me/mcp`. The state root and its artifact directories use mode0700 and JSON files mode0600 on POSIX. Redacted extractions still contain private material. Exports, optimization requests (including seed text), progress and receipt credentials persist there. Keep this directory private and back up receipt files; do not commit it.

Receipt tokens do not appear in MCP tool responses. The returned receipt path contains the website-compatible private receipt file. A separate internal receipt binds retries to the original destination, export, title and alias. If delivery is uncertain, repeat `submit_trace_export` with the same `receipt_id` and original arguments. Do not create a second submission. Backend receipt idempotency resolves retried requests. A completed receipt can be reopened on the website.

Trace hashes detect changed bytes; they do not prove authorship, complete redaction, successful outcomes or sale rights. Historical content is always untrusted reference evidence and is never executed as commands.

## Local optimization

Install the existing Python optimize extra (Python3.11–3.14 for the pinned GEPA version), then run Ollama with an installed model:

```sh
cd backend
uv sync --extra optimize
```

Set `AGENT_ME_OPTIMIZATION_PYTHON` to the absolute Python path in that environment (for a backend-local uv environment, `backend/.venv/bin/python`). Add the environment entry in your MCP client's server configuration. Existing root `.venv/bin/python` is also discovered if present. Set `AGENT_ME_BACKEND_DIR` only when the backend folder is outside its normal repository location.

`start_optimization` receives the installed model name; it does not download or install models. Ollama requests are restricted to a loopback HTTP origin. Unavailable dependencies, missing model/service, insufficient data and insufficient budgets return actionable failures. The status tool checks dependency availability, not that an Ollama model is ready.

The dataset adapter uses only the chosen export. At least six distinct user tasks across three conversations are required. It deduplicates user requests, separates conversations into train/validation/test, excludes harness/system text from the owner-question role, and bounds reference evidence. Held-out conversations never enter reflection. GEPA uses the existing `optimize_anything` engine and performs a frozen held-out comparison. Model-judge scores measure a proxy; they do not prove real tool execution, correctness or future improvement.

Only one optimization runs per server instance. Progress and completion persist locally. Closing the MCP terminates and joins owned work; reopening an interrupted run reports failure rather than leaving it apparently running forever. Candidate files/results are saved for review; adoption is manual.

## Configuration

| Environment | Default |
| --- | --- |
| `AGENT_ME_MCP_DATA_DIR` | `~/.local/share/agent-me/mcp` |
| `AGENT_ME_REVIEW_URL` | `http://127.0.0.1:8001` (origin only; non-loopback requires HTTPS) |
| `AGENT_ME_OPTIMIZATION_PYTHON` | Root `.venv/bin/python` if present, else `python3` |
| `AGENT_ME_BACKEND_DIR` | Checkout `backend/` |
| `AGENT_ME_OLLAMA_URL` | `http://127.0.0.1:11434` (loopback HTTP only) |
| `AGENT_ME_RATE_CARD` | `mcp/rate-card.json` |

Do not change the review destination to a public service until that service is intentionally enabled. The MCP does not deploy it or bypass its submission gate. Estimates use a versioned experimental USD rate card; [the research and arithmetic](TRACE_PRICING.md) distinguish competitor advertisements from our assumptions. No royalty contract or payment system is implied.

## Verification

```sh
npm --prefix mcp run build
# Set this path to a Python environment with backend[optimize] installed:
AGENT_ME_OPTIMIZATION_PYTHON=/absolute/path/to/python npm --prefix mcp test
cd backend
python -m pytest tests/test_mcp_optimization.py tests/test_mcp_optimization_data.py \
  tests/test_trace_market.py tests/test_public_trace_market.py
```

The Node protocol test starts a real stdio MCP client and calls every tool. Temporary loopback fixtures stand in for the model and review service, while GEPA itself is real. The Python tests also exercise GEPA through a temporary Ollama-compatible HTTP fixture. They do not measure quality against a production model or demonstrate buyer demand. A real-model improvement claim requires a separate run on reviewed user data.

## Free OpenRouter optimization

Keep Ollama as the default. For an approved one-off remote session, supply AGENT_ME_OPENROUTER_KEY_FILE only to that MCP process and choose provider=openrouter with the free model in start_optimization. The optional AGENT_ME_OPENROUTER_MODEL selects a free model for that process. Keep keys out of client config values and run artifacts. This installation does not change client defaults or persist OpenRouter credentials in client settings. A configured provider is not permission to upload traces.

Before each remote run, the contributor must approve the exact redacted selection and destination. Call `start_optimization` with `provider:"openrouter"`, `confirm_remote_processing:true` and `expected_sha256` matching the reviewed export. The Python bridge rechecks that hash before making model requests. The key-file path is supplied through client environment configuration; run request files contain no API key. Extraction, exports and results stay on this machine; selected evidence and seed text are sent to OpenRouter and its routed provider. This is remote inference.

Only `:free` catalog models or `openrouter/free` are accepted. Preflight checks current zero pricing and structured-output support; provider price ceilings are zero for prompt, completion and per-request pricing. There is no paid-model fallback. Responses must report zero usage cost; missing/nonzero cost metadata or truncated/invalid judge output stops the run. Free rate limits and outages remain possible. Optional reasoning is disabled only when the catalog explicitly allows it, keeping completion budgets available for the response.

The adapter sends `data_collection:"deny"` and requires parameter support. That requests eligible providers under OpenRouter’s data-policy routing; it is not an independent guarantee of a provider’s policy. Zero-data-retention enforcement is a separate OpenRouter setting and is not claimed here. A generic free router can select different models across calls; pin a successful free model for more comparable evaluations. Results record resolved models, providers, tokens and reported costs.

The current pinned model was chosen using fictional probes. Other free models may be blocked by privacy policy, unavailable or lack structured outputs. The optimizer stops rather than changing account privacy settings or switching to a paid model. Existing Ollama runs remain loopback-only.

Sources checked October 26, 2026: [free variants](https://openrouter.ai/docs/guides/routing/model-variants/free), [provider routing and price/data-policy controls](https://openrouter.ai/docs/guides/routing/provider-selection), [structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs), [reasoning controls](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens).

## Optimization result evidence

A retained original is reported as `comparison_status: "original_retained"`,
with `candidate_test_score: null`; no second held-out comparison occurred.
Distinct candidates receive fresh held-out evaluations, including when scores tie.
`search_summary` reports attempts, generated proposals, decisions and skips;
`evaluation_summary` separates actual evaluator/model calls and split sizes.
Rejected proposals are preserved in a private mode-0600 `.audit.json` beside the
job result. `audit_path` locates it without returning its sensitive contents in
the default MCP response. No prompts or skills are automatically installed.

Evaluation caches are disabled to prevent GEPA 0.1.4 positional training and
validation cache-key collisions. Results produced with that cache enabled need
a fresh run before relying on validation-based selection. A one-task held-out
score is only a diagnostic sample. Increasing a budget permits more attempts; it
does not guarantee improvement or a distinct candidate.
