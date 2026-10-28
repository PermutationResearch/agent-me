import { FormEvent, useEffect, useRef, useState } from "react";

type Request = (path: string, body?: unknown) => Promise<unknown>;
type Status = {
  available: boolean; archive_verified: boolean; archive_sources: string[];
  archive_events: number; model: string; reason: string | null;
};
type Evidence = { document_id: number | string; excerpt: string; role: string; kind: string };
type Example = {
  id: string; conversation_id: string; source: string; question: string;
  question_origin: string; context: Evidence[];
};
type Dataset = {
  id: string; query: string; archive_sha256: string; source_counts: Record<string, number>;
  total_examples: number; minimum_metric_calls?: number; splits: { train: Example[]; validation: Example[]; test: Example[] };
};
type Run = {
  id: string; status: string; name: string; artifact_type: string; objective: string;
  seed: string; created_at: string; updated_at: string;
  progress: { evaluations: number; model_calls: number }; error?: string;
  result?: {
    best_artifact: string; baseline_test_score: number; candidate_test_score: number | null;
    comparison_status?: "original_retained" | "distinct_candidate_tested";
    search_summary?: { proposal_budget: number; proposal_attempts: number; proposals_generated: number; accepted: number; rejected: number; skipped: number; retained_candidates: number };
    evaluation_summary?: { train_examples: number; validation_examples: number; test_examples: number; model_calls: number; actual_search_evaluations: number };
    validation_score: number; improved: boolean; recommendation: string;
    model_calls: number; metric_calls: number;
  };
};
const active = (run: Run) => run.status === "queued" || run.status === "running";
const message = (error: unknown) => error instanceof Error ? error.message : "Optimization request failed";
const retainedOriginal = (run: Run) => run.result?.comparison_status === "original_retained"
  || (run.result?.comparison_status === undefined && run.result?.best_artifact === run.seed);

function OptimizationResult({ run }: { run: Run }) {
  const result = run.result;
  if (!result) return null;
  const retained = retainedOriginal(run);
  const candidateScore = typeof result.candidate_test_score === "number" && Number.isFinite(result.candidate_test_score) ? result.candidate_test_score.toFixed(3) : null;
  return <>
    <div className="optimization-scores"><span>Baseline: {result.baseline_test_score.toFixed(3)}</span>{retained ? <span>Original retained</span> : <span>{candidateScore ? `Candidate: ${candidateScore}` : "Candidate not evaluated"}</span>}<span>Validation: {result.validation_score.toFixed(3)}</span></div>
    {result.search_summary && <p className="section-help">Search: {result.search_summary.proposal_attempts} attempts · {result.search_summary.proposals_generated} proposals · {result.search_summary.accepted} accepted rewrites · {result.search_summary.rejected} rejected · {result.search_summary.skipped} skipped. Proposal budget: {result.search_summary.proposal_budget}.</p>}
    {result.evaluation_summary && <p className="section-help">Evaluation set: {result.evaluation_summary.train_examples} training · {result.evaluation_summary.validation_examples} validation · {result.evaluation_summary.test_examples} held-out {result.evaluation_summary.test_examples === 1 ? "task" : "tasks"}.</p>}
    {result.evaluation_summary?.test_examples === 1 && <p className="section-help">Only 1 held-out task was evaluated; this does not establish general improvement.</p>}
    <p className="section-help">Model-judged scores estimate quality on the selected tasks. They do not prove correctness or general improvement.</p>
    <p>{retained ? "The original artifact was retained. No distinct candidate was evaluated on held-out tasks." : result.recommendation}</p>
    <details><summary>Original artifact</summary><pre>{run.seed}</pre></details>
    <h4>{retained ? "Retained original" : "Candidate for review"}</h4><pre>{result.best_artifact}</pre>
    <div className="form-actions"><button type="button" className="button-secondary" onClick={() => download(result.best_artifact, `${run.id}.${retained ? "retained" : "candidate"}.md`, "text/markdown;charset=utf-8")}>{retained ? "Download retained artifact" : "Download candidate"}</button><button type="button" className="button-secondary" onClick={() => download(JSON.stringify(run, null, 2), `${run.id}.receipt.json`, "application/json")}>Download receipt</button></div>
  </>;
}

function download(content: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url; link.download = filename; link.click();
  URL.revokeObjectURL(url);
}

export function OptimizationPanel({ request }: { request: Request }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [name, setName] = useState("");
  const [artifactType, setArtifactType] = useState("prompt");
  const [seed, setSeed] = useState("");
  const [objective, setObjective] = useState("");
  const [query, setQuery] = useState("");
  const [exampleLimit, setExampleLimit] = useState(18);
  const [budget, setBudget] = useState(24);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const mounted = useRef(false);
  const datasetVersion = useRef(0);
  const activeIds = runs.filter(active).map(run => run.id).join(",");
  const minimumBudget = dataset?.minimum_metric_calls ?? 8;

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    Promise.all([request("/optimization/status"), request("/optimization/runs")])
      .then(([currentStatus, currentRuns]) => {
        if (cancelled) return;
        setStatus(currentStatus as Status);
        setRuns(Array.isArray(currentRuns) ? currentRuns as Run[] : []);
      })
      .catch(e => { if (!cancelled) setError(message(e)); });
    return () => { cancelled = true; mounted.current = false; };
  }, [request, reload]);

  useEffect(() => {
    if (!activeIds) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const updates = await Promise.all(activeIds.split(",").map(id => request(`/optimization/runs/${id}`)));
        if (cancelled) return;
        setRuns(current => current.map(run => (updates as Run[]).find(update => update.id === run.id) ?? run));
        timer = setTimeout(() => { void poll(); }, 2000);
      } catch (e) {
        if (!cancelled) setError(message(e));
      }
    }
    timer = setTimeout(() => { void poll(); }, 2000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [request, activeIds, reload]);

  function invalidateDataset() {
    datasetVersion.current += 1;
    setDataset(null);
  }

  async function prepare(event: FormEvent) {
    event.preventDefault();
    if (!status?.available || busy) return;
    const version = datasetVersion.current;
    setBusy(true); setError("");
    try {
      const value = await request("/optimization/datasets", { query, example_limit: exampleLimit });
      if (mounted.current && version === datasetVersion.current) {
        const prepared = value as Dataset;
        setDataset(prepared);
        setBudget(current => Math.max(current, prepared.minimum_metric_calls ?? 8));
      }
    } catch (e) { if (mounted.current) setError(message(e)); }
    finally { if (mounted.current) setBusy(false); }
  }

  async function start() {
    if (!status?.available || !dataset || busy || activeIds || !name.trim() || !seed.trim() || !objective.trim() || budget < minimumBudget) return;
    setBusy(true); setError("");
    try {
      const run = await request("/optimization/runs", {
        dataset_id: dataset.id, name, artifact_type: artifactType, seed, objective,
        max_metric_calls: budget,
      }) as Run;
      if (mounted.current) setRuns(current => [run, ...current.filter(item => item.id !== run.id)]);
    } catch (e) { if (mounted.current) setError(message(e)); }
    finally { if (mounted.current) setBusy(false); }
  }

  return <section className="optimization-panel" aria-labelledby="optimization-heading">
    <div className="subsection-heading">
      <div><span className="section-kicker">Improve from experience</span><h3 id="optimization-heading">GEPA optimizer</h3></div>
      <button type="button" className="button-secondary" disabled={busy} onClick={() => { setError(""); setReload(value => value + 1); }}>Refresh optimizer</button>
    </div>
    {status ? <>
      <p className="section-help">Local Ollama model: {status.model ?? "not configured"}. GEPA uses selected archive examples to improve your prompt or skill. Original files stay unchanged; download a candidate after reviewing its results.</p>
      {status.available
        ? <p className="optimization-connection">{status.archive_events.toLocaleString()} archive events available · {status.archive_sources.join(", ")}</p>
        : <p role="status">{status.reason || "A verified work archive and GEPA are required before starting."}</p>}
    </> : <p role="status">Checking optimizer readiness…</p>}
    <div className="optimization-form">
      <label>Run name<input required maxLength={100} value={name} onChange={e => setName(e.target.value)} placeholder="Release verification skill" /></label>
      <label>Artifact type<select value={artifactType} onChange={e => setArtifactType(e.target.value)}><option value="prompt">Prompt</option><option value="skill">Skill</option></select></label>
      <label className="optimization-wide">Original prompt or skill<textarea required maxLength={30000} rows={7} value={seed} onChange={e => setSeed(e.target.value)} placeholder="Paste the current prompt or SKILL.md contents" /></label>
      <label className="optimization-wide">Improvement objective<textarea required maxLength={2000} rows={3} value={objective} onChange={e => setObjective(e.target.value)} placeholder="Require verification evidence before reporting success" /></label>
    </div>
    <form className="optimization-form" onSubmit={event => { void prepare(event); }}>
      <label className="optimization-wide">Find archive examples<input required minLength={2} maxLength={2000} disabled={busy} value={query} onChange={e => { setQuery(e.target.value); invalidateDataset(); }} placeholder="release verification, failed deployment, test evidence" /></label>
      <label>Example limit<input type="number" required min={6} max={60} disabled={busy} value={exampleLimit} onChange={e => { setExampleLimit(Number(e.target.value)); invalidateDataset(); }} /></label>
      <label>Evaluation budget<input type="number" required min={minimumBudget} max={96} value={budget} onChange={e => setBudget(Number(e.target.value))} /></label>
      <p className="section-help optimization-wide">Each evaluation generates an answer and judges it locally. The budget limits GEPA evaluations; comparing the original and candidate on held-out examples adds model calls.</p>
      <div className="form-actions optimization-wide"><button disabled={busy || !status?.available || !query.trim()}>Prepare examples</button></div>
    </form>
    {dataset && <aside className="optimization-dataset" aria-label="Prepared archive examples">
      <p><strong>{dataset.splits.train.length} training</strong> · <strong>{dataset.splits.validation.length} validation</strong> · <strong>{dataset.splits.test.length} held-out test</strong> examples</p>
      {dataset.minimum_metric_calls !== undefined && <p className="section-help">Minimum for these splits: {dataset.minimum_metric_calls} evaluations.</p>}
      <p className="section-help">These are untrusted historical evidence, not guaranteed correct answers. Related examples stay in the same split. Held-out examples are reserved for the final comparison.</p>
      <p className="optimization-provenance">Sources: {Object.entries(dataset.source_counts).map(([source, count]) => `${source} (${count})`).join(", ")}<br />Archive SHA-256: <code>{dataset.archive_sha256}</code></p>
      <details><summary>Review training examples</summary><ul className="optimization-examples">{dataset.splits.train.map(example => <li key={example.id}><strong>{example.question}</strong><small>{example.source} · {example.conversation_id} · {example.question_origin}</small>{example.context?.map((evidence, index) => <p key={`${evidence.document_id}-${index}`}><span>{evidence.role} · {evidence.kind}</span><br />{evidence.excerpt}</p>)}</li>)}</ul></details>
    </aside>}
    <button type="button" disabled={busy || !status?.available || !dataset || !!activeIds || !name.trim() || !seed.trim() || !objective.trim() || budget < minimumBudget || budget > 96} onClick={() => { void start(); }}>Run GEPA</button>
    {busy && <p role="status">Preparing optimization…</p>}
    {error && <p role="alert">{error}</p>}
    <div className="optimization-runs">{runs.map(run => <article key={run.id} className="optimization-run">
      <div className="memory-meta"><strong>{run.name}</strong><span>{run.artifact_type}</span><span>{run.status}</span></div>
      <p>{run.objective}</p>
      {active(run) && <p role="status">{run.status === "queued" ? "Queued" : "Optimizing"} · {run.progress?.evaluations ?? 0} evaluations · {run.progress?.model_calls ?? 0} model calls</p>}
      {run.error && <p role="alert">{run.error}</p>}
      <OptimizationResult run={run} />
    </article>)}</div>
  </section>;
}
