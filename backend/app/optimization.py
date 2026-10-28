"""Authenticated, private GEPA runs. Candidates are proposals, never source edits."""

from __future__ import annotations

import asyncio
import importlib.util
import json
import os
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal
from uuid import uuid4

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from starlette.concurrency import run_in_threadpool

from .config import Settings
from .optimization_engine import OllamaModel, execute, minimum_budget
from .personal import authorize, corpus

router = APIRouter(prefix="/api/v1/personal/optimization", tags=["private optimization"])


def now():
    return datetime.now(UTC).isoformat()


class DatasetRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    query: str = Field(min_length=2, max_length=2000)
    example_limit: int = Field(default=18, ge=6, le=60)


class RunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    dataset_id: str = Field(pattern=r"^[a-f0-9]{32}$")
    name: str = Field(min_length=1, max_length=100)
    artifact_type: Literal["prompt", "skill"] = "prompt"
    seed: str = Field(min_length=1, max_length=30000)
    objective: str = Field(min_length=1, max_length=2000)
    max_metric_calls: int = Field(default=24, ge=8, le=96)


def work_index(config):
    index = corpus(config)
    if not index.include_work or index.metadata["document_scope"] != "all_events":
        raise HTTPException(409, "Wait for the completed, verified work archive to be connected.")
    return index


def model_ready(config):
    try:
        response = httpx.get(config.optimization_ollama_url.rstrip("/") + "/api/tags", timeout=3)
        response.raise_for_status()
        names = {row["name"] for row in response.json()["models"]}
        return config.optimization_model in names
    except (httpx.HTTPError, ValueError, KeyError, TypeError):
        return False


class Manager:
    def __init__(self, root):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.tasks = {}
        for run in self.list_runs():
            if run["status"] in ("queued", "running"):
                run.update(
                    status="interrupted",
                    updated_at=now(),
                    error="Server restarted before this run finished; start a new run.",
                )
                self.save("runs", run)

    def save(self, category, value):
        folder = self.root / category
        folder.mkdir(mode=0o700, exist_ok=True)
        target = folder / (value["id"] + ".json")
        temporary = folder / (value["id"] + ".next")
        fd = os.open(temporary, os.O_CREAT | os.O_TRUNC | os.O_WRONLY, 0o600)
        with os.fdopen(fd, "w") as handle:
            json.dump(value, handle, ensure_ascii=False)
        os.replace(temporary, target)

    def load(self, category, identifier):
        if not re.fullmatch(r"[a-f0-9]{32}", identifier):
            raise HTTPException(404, "Optimization record not found")
        try:
            return json.loads((self.root / category / (identifier + ".json")).read_text())
        except FileNotFoundError as error:
            raise HTTPException(404, "Optimization record not found") from error

    def list_runs(self):
        folder = self.root / "runs"
        return sorted(
            (json.loads(p.read_text()) for p in folder.glob("*.json")),
            key=lambda row: row["created_at"],
            reverse=True,
        )

    def start(self, payload, dataset, config):
        if any(not task.done() for task in self.tasks.values()):
            raise HTTPException(409, "An optimization is already running. Wait for it to finish.")
        run = dict(
            id=uuid4().hex,
            **payload.model_dump(),
            created_at=now(),
            updated_at=now(),
            status="queued",
            progress={"evaluations": 0, "model_calls": 0},
            archive_sha256=dataset["archive_sha256"],
            provider="ollama",
            model=config.optimization_model,
            promotion_performed=False,
            dataset_summary={
                key: dataset[key]
                for key in ("id", "query", "archive_sha256", "source_counts", "total_examples")
            },
            split_ids={
                key: [item["id"] for item in rows] for key, rows in dataset["splits"].items()
            },
        )
        self.save("runs", run)
        self.tasks[run["id"]] = asyncio.create_task(self._run(run, dataset, config))
        return run

    async def _run(self, run, dataset, config):
        def progress(value):
            run.update(status="running", progress=value, updated_at=now())
            self.save("runs", run)

        try:
            result = await run_in_threadpool(
                execute,
                seed=run["seed"],
                objective=run["objective"],
                dataset=dataset,
                max_metric_calls=run["max_metric_calls"],
                model=OllamaModel(config.optimization_ollama_url, config.optimization_model),
                on_progress=progress,
            )
            run.update(status="completed", result=result, updated_at=now())
        except Exception as error:
            run.update(
                status="failed",
                updated_at=now(),
                error=(
                    "Optimization failed. Check Ollama, model output, and the configured budget."
                ),
                error_type=type(error).__name__,
            )
        self.save("runs", run)

    async def wait(self, identifier):
        task = self.tasks.get(identifier)
        if task:
            await asyncio.shield(task)
        return self.load("runs", identifier)


_managers: dict[str, Manager] = {}


def manager(config):
    root = config.personal_optimization_dir or str(Path(config.personal_data_dir) / "optimization")
    if root not in _managers:
        _managers[root] = Manager(root)
    return _managers[root]


async def join_optimizations():
    tasks = [task for owner in _managers.values() for task in owner.tasks.values()]
    if tasks:
        await asyncio.gather(*tasks)


@router.get("/status")
def status(config: Settings = Depends(authorize)):
    dependency = importlib.util.find_spec("gepa") is not None
    archive, reason = None, None
    try:
        archive = work_index(config)
    except HTTPException:
        reason = "Wait for the completed, verified work archive to be connected."
    ready = model_ready(config)
    if not dependency:
        reason = "Install the backend optimize extra (GEPA; Python 3.11–3.14)."
    elif not ready:
        reason = "Start Ollama and install the configured optimization model."
    return {
        "available": bool(dependency and archive and ready),
        "dependency_available": dependency,
        "archive_verified": archive is not None,
        "archive_sources": archive.status()["sources"] if archive else [],
        "archive_events": archive.status()["events"] if archive else 0,
        "provider": "ollama",
        "model": config.optimization_model,
        "reason": reason,
    }


@router.post("/datasets")
def prepare(payload: DatasetRequest, config: Settings = Depends(authorize)):
    from .optimization_data import prepare_dataset

    index = work_index(config)
    try:
        dataset = prepare_dataset(index, payload.query, payload.example_limit)
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
    dataset["minimum_metric_calls"] = minimum_budget(dataset)
    manager(config).save("datasets", dataset)
    return dataset


@router.get("/runs")
def runs(config: Settings = Depends(authorize)):
    return manager(config).list_runs()


@router.post("/runs", status_code=202)
async def start(payload: RunRequest, config: Settings = Depends(authorize)):
    index = await run_in_threadpool(work_index, config)
    if importlib.util.find_spec("gepa") is None or not await run_in_threadpool(model_ready, config):
        raise HTTPException(503, "GEPA or the local optimization model is unavailable.")
    owner = manager(config)
    dataset = owner.load("datasets", payload.dataset_id)
    if dataset["archive_sha256"] != index.expected_sha256:
        raise HTTPException(409, "The archive changed. Prepare new examples before optimizing.")
    required = minimum_budget(dataset)
    if payload.max_metric_calls < required:
        raise HTTPException(422, f"This dataset requires at least {required} metric calls.")
    return owner.start(payload, dataset, config)


@router.get("/runs/{identifier}")
async def run_status(identifier: str, config: Settings = Depends(authorize), wait_seconds: int = 0):
    owner = manager(config)
    owner.load("runs", identifier)
    if wait_seconds:
        try:
            return await asyncio.wait_for(
                owner.wait(identifier), timeout=min(max(wait_seconds, 1), 20)
            )
        except TimeoutError:
            pass
    return owner.load("runs", identifier)
