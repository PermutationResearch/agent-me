import { spawn, execFile, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { parseTracePack } from "../../frontend/src/tracePack";
import { Store } from "./storage";

const execute = promisify(execFile);
type Job = { execution?: Record<string, unknown>; status: "running" | "completed" | "failed"; progress?: unknown; result?: Record<string, unknown>; error?: string; dataset_summary?: unknown };
export type OptimizeInput = { export_id: string; seed: string; objective: string; model?: string; provider?: "ollama" | "openrouter"; confirm_remote_processing?: boolean; expected_sha256?: string; max_metric_calls?: number };

/** Owns subprocesses until completion. Closing the MCP joins or terminates its active job. */
export class Optimizer {
  private starting = false;
  private closed = false;
  private readonly active = new Map<string, { child: ChildProcess; completion: Promise<void> }>();
  readonly backend: string;
  readonly python: string;
  readonly ollamaUrl: string;
  readonly provider: "ollama" | "openrouter";
  readonly openrouterModel: string;
  constructor(private readonly store: Store, options: { backend?: string; python?: string; ollamaUrl?: string; provider?: string; openrouterModel?: string } = {}) {
    const provider = options.provider ?? process.env.AGENT_ME_OPTIMIZATION_PROVIDER ?? "ollama";
    if (provider !== "ollama" && provider !== "openrouter") throw new Error("Choose ollama or openrouter as the optimization provider.");
    this.provider = provider;
    this.openrouterModel = options.openrouterModel ?? process.env.AGENT_ME_OPENROUTER_MODEL ?? "dots-studio/dots-3-note-preview:free";
    this.backend = options.backend ?? fileURLToPath(new URL("../../backend", import.meta.url));
    const bundled = fileURLToPath(new URL("../../.venv/bin/python", import.meta.url));
    this.python = options.python ?? (existsSync(bundled) ? bundled : "python3");
    this.ollamaUrl = options.ollamaUrl ?? "http://127.0.0.1:11434";
    const url = new URL(this.ollamaUrl);
    if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("The local optimizer requires a loopback Ollama origin.");
  }
  private env() { return { ...process.env, PYTHONPATH: this.backend, PYTHONUNBUFFERED: "1", AGENT_ME_OPTIMIZATION_PROVIDER: this.provider }; }
  async status() {
    try {
      const { stdout } = await execute(this.python, ["-m", "app.mcp_optimization", "--check"], { cwd: this.backend, env: this.env(), timeout: 15000, maxBuffer: 10000 });
      return { ...JSON.parse(stdout), ollama_url: this.ollamaUrl, default_provider: this.provider, openrouter_model: this.openrouterModel, remote_destination: "https://openrouter.ai/api/v1", active_jobs: this.active.size, model_requirement: "Ollama needs an installed local model. OpenRouter needs a configured key, a free model and explicit consent for the exact selected export.", promotion_performed: false };
    } catch {
      return { available: false, active_jobs: this.active.size, next_step: "Install backend optimization dependencies with uv sync --extra optimize in backend/, then set AGENT_ME_OPTIMIZATION_PYTHON to that environment's Python. Start Ollama and install a model separately.", promotion_performed: false };
    }
  }
  async start(input: OptimizeInput) {
    if (this.closed) throw new Error("The MCP server is closing. Reconnect before starting an optimization.");
    if (this.starting || this.active.size) throw new Error("An optimization is already running. Await get_optimization before starting another.");
    this.starting = true;
    try {
    if (!input.seed.trim() || input.seed.length > 30000 || !input.objective.trim() || input.objective.length > 2000) throw new Error("Provide a seed within 30,000 characters and an objective within 2,000.");
    const provider = input.provider ?? this.provider;
    const model = input.model ?? (provider === "openrouter" ? this.openrouterModel : "qwen2.5:1.5b");
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(model)) throw new Error("Choose a model name.");
    if (!(await this.status()).available) throw new Error("GEPA is unavailable. Run get_agent_me_status for setup instructions.");
    const pack = await parseTracePack(await this.store.read("exports", input.export_id));
    if (provider === "openrouter") {
      if (model !== "openrouter/free" && !model.endsWith(":free")) throw new Error("OpenRouter optimization accepts free models only; no paid fallback is allowed.");
      if (input.confirm_remote_processing !== true || input.expected_sha256 !== pack.integrity.sha256) throw new Error("Confirm sending this selected export to OpenRouter and its provider with the exact expected_sha256. No remote request was made.");
    }
    const job_id = `opt_${randomUUID()}`;
    const output_path = await this.store.save<Job>("optimization-results", job_id, { status: "running", progress: { phase: "starting" } });
    const request_path = await this.store.save("optimization-requests", job_id, {
      pack_path: this.store.path("exports", input.export_id), seed: input.seed, objective: input.objective,
      max_metric_calls: input.max_metric_calls ?? 24, ollama_url: this.ollamaUrl, model, provider,
      ...(provider === "openrouter" ? { confirm_remote_processing: true, expected_sha256: input.expected_sha256 } : {}),
    });
    if (this.closed) throw new Error("The MCP closed before optimization started. No model work was launched.");
    const child = spawn(this.python, ["-m", "app.mcp_optimization", "--request", request_path, "--output", output_path], { cwd: this.backend, env: this.env(), stdio: "ignore" });
    const completion = new Promise<void>(resolve => {
      let processError = false;
      child.once("error", () => { processError = true; });
      child.once("close", async code => {
        try {
          const result = await this.store.read<Job>("optimization-results", job_id);
          if (processError || result.status === "running") await this.store.save("optimization-results", job_id, { ...result, status: "failed", error: `Optimization process stopped before completion (exit ${code}). Check the Python environment and selected model provider.` });
          else if (result.status === "completed" && typeof result.result?.best_artifact === "string") await this.store.save("optimization-candidates", job_id, { artifact: result.result.best_artifact, promotion_performed: false });
        } catch { /* get() reports an unreadable result; child is still joined. */ }
        finally { this.active.delete(job_id); resolve(); }
      });
    });
    this.active.set(job_id, { child, completion });
    return { job_id, path: output_path, status: "running", model, provider, remote: provider === "openrouter", data_destination: provider === "openrouter" ? "https://openrouter.ai/api/v1" : this.ollamaUrl, next_step: "Await get_optimization with this job_id. Results are candidates for review; source prompts and skills are never replaced." };
    } finally { this.starting = false; }
  }
  async get(job_id: string, wait_seconds = 0) {
    if (!Number.isInteger(wait_seconds) || wait_seconds < 0 || wait_seconds > 20) throw new Error("Wait between 0 and 20 seconds.");
    const active = this.active.get(job_id);
    if (active && wait_seconds) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([active.completion, new Promise<void>(resolve => { timer = setTimeout(resolve, wait_seconds * 1000); })]);
      if (timer) clearTimeout(timer);
    }
    const result = await this.store.read<Job>("optimization-results", job_id);
    if (result.status === "running" && !this.active.has(job_id)) {
      result.status = "failed"; result.error = "The MCP stopped during this optimization. Start a new run; no candidate was installed.";
      await this.store.save("optimization-results", job_id, result);
    }
    return { job_id, path: this.store.path("optimization-results", job_id), ...result, promotion_performed: false };
  }
  async close() {
    this.closed = true;
    const jobs = [...this.active.values()];
    for (const job of jobs) job.child.kill("SIGTERM");
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([Promise.all(jobs.map(job => job.completion)), new Promise<void>(resolve => { timer = setTimeout(resolve, 2000); })]);
    if (timer) clearTimeout(timer);
    for (const job of this.active.values()) job.child.kill("SIGKILL");
    await Promise.all(jobs.map(job => job.completion));
  }
}
