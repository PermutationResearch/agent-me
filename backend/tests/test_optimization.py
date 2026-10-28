import importlib
import importlib.util

import pytest
from test_personal import HEADERS, personal  # noqa: F401


async def test_optimization_endpoints_require_private_authentication(personal):  # noqa: F811
    client, _ = personal
    for path in ("status", "runs"):
        result = await client.get("/api/v1/personal/optimization/" + path)
        assert result.status_code == 401
    assert (await client.get("/api/v1/optimization/status")).status_code == 404


async def test_optimization_status_explains_missing_verified_work_archive(personal):  # noqa: F811
    client, _ = personal
    response = await client.get("/api/v1/personal/optimization/status", headers=HEADERS)
    assert response.status_code == 200
    value = response.json()
    assert not value["available"]
    assert not value["archive_verified"]
    assert value["reason"]


def manager_module():
    assert importlib.util.find_spec("app.optimization"), "Private GEPA API is missing"
    return importlib.import_module("app.optimization")


def connect_archive(config, tmp_path):
    from test_optimization_data import make_work_corpus

    index = make_work_corpus(tmp_path)
    config.personal_corpus_index = str(index.path)
    config.personal_corpus_sha256 = index.expected_sha256
    config.personal_corpus_include_work = True
    return index


@pytest.mark.skipif(importlib.util.find_spec("gepa") is None, reason="GEPA extra is not installed")
async def test_prepare_run_and_review_candidate_keeps_archive_and_memories(
    personal,  # noqa: F811
    tmp_path,
    monkeypatch,  # noqa: F811
):  # noqa: F811
    import hashlib

    from test_optimization_engine import DeterministicModel

    client, config = personal
    index = connect_archive(config, tmp_path)
    module = manager_module()
    monkeypatch.setattr(module, "model_ready", lambda config: True)
    monkeypatch.setattr(module, "OllamaModel", lambda *args: DeterministicModel())
    prepared = await client.post(
        "/api/v1/personal/optimization/datasets",
        headers=HEADERS,
        json={"query": "verification", "example_limit": 18},
    )
    assert prepared.status_code == 200, prepared.text
    dataset = prepared.json()
    assert set(dataset["source_counts"]) == {
        "claude-code",
        "codex",
        "omp",
        "saved-work",
        "codex-thread-history",
        "omp-history",
    }
    response = await client.post(
        "/api/v1/personal/optimization/runs",
        headers=HEADERS,
        json={
            "dataset_id": dataset["id"],
            "name": "Grounded verification",
            "artifact_type": "skill",
            "seed": "Be helpful.",
            "objective": "Ground answers.",
            "max_metric_calls": 12,
        },
    )
    assert response.status_code == 202, response.text
    run_id = response.json()["id"]
    result = await client.get(
        f"/api/v1/personal/optimization/runs/{run_id}?wait_seconds=20", headers=HEADERS
    )
    run = result.json()
    assert run["status"] == "completed", run
    assert run["result"]["candidate_test_score"] > run["result"]["baseline_test_score"]
    assert run["result"]["best_artifact"] == "Cite evidence and state uncertainty."
    assert run["seed"] == "Be helpful."
    assert not run["result"]["promotion_performed"]
    assert (await client.get("/api/v1/personal/entries", headers=HEADERS)).json() == []
    assert hashlib.sha256(index.path.read_bytes()).hexdigest() == index.expected_sha256
    assert (await client.get("/api/v1/personal/optimization/runs", headers=HEADERS)).json()[
        0
    ] == run
    stored = module.manager(config).root / "runs" / (run_id + ".json")
    assert stored.stat().st_mode & 0o777 == 0o600
    assert result.headers["cache-control"] == "no-store"


@pytest.mark.skipif(importlib.util.find_spec("gepa") is None, reason="GEPA extra is not installed")
async def test_failed_model_is_recorded_without_candidate(personal, tmp_path, monkeypatch):  # noqa: F811
    client, config = personal
    connect_archive(config, tmp_path)
    module = manager_module()
    monkeypatch.setattr(module, "model_ready", lambda config: True)
    monkeypatch.setattr(module, "OllamaModel", lambda *args: lambda *a, **k: "invalid judge output")
    prepared = (
        await client.post(
            "/api/v1/personal/optimization/datasets",
            headers=HEADERS,
            json={"query": "verification"},
        )
    ).json()
    response = await client.post(
        "/api/v1/personal/optimization/runs",
        headers=HEADERS,
        json={
            "dataset_id": prepared["id"],
            "name": "Failure",
            "seed": "Be helpful.",
            "objective": "Ground answers.",
            "max_metric_calls": 12,
        },
    )
    assert response.status_code == 202
    run_id = response.json()["id"]
    run = (
        await client.get(
            f"/api/v1/personal/optimization/runs/{run_id}?wait_seconds=20", headers=HEADERS
        )
    ).json()
    assert run["status"] == "failed"
    assert run["error"] and "result" not in run
    assert not run["promotion_performed"]


async def test_changed_archive_requires_new_examples(personal, tmp_path, monkeypatch):  # noqa: F811
    from test_optimization_data import make_work_corpus

    client, config = personal
    connect_archive(config, tmp_path)
    module = manager_module()
    monkeypatch.setattr(module, "model_ready", lambda config: True)
    prepared = (
        await client.post(
            "/api/v1/personal/optimization/datasets",
            headers=HEADERS,
            json={"query": "verification"},
        )
    ).json()
    new_root = tmp_path / "new"
    new_root.mkdir()
    replacement = make_work_corpus(new_root, n=19)
    config.personal_corpus_index = str(replacement.path)
    config.personal_corpus_sha256 = replacement.expected_sha256
    response = await client.post(
        "/api/v1/personal/optimization/runs",
        headers=HEADERS,
        json={
            "dataset_id": prepared["id"],
            "name": "Stale",
            "seed": "Be helpful.",
            "objective": "Ground answers.",
            "max_metric_calls": 12,
        },
    )
    assert response.status_code == 409
    assert not (await client.get("/api/v1/personal/optimization/runs", headers=HEADERS)).json()


async def test_write_routes_reject_unauthenticated_requests(personal):  # noqa: F811
    client, _ = personal
    for path in ("datasets", "runs"):
        response = await client.post("/api/v1/personal/optimization/" + path, json={})
        assert response.status_code == 401


@pytest.mark.skipif(importlib.util.find_spec("gepa") is None, reason="GEPA extra is not installed")
async def test_second_run_waits_for_owned_job_to_finish(personal, tmp_path, monkeypatch):  # noqa: F811
    import threading

    from test_optimization_engine import DeterministicModel

    client, config = personal
    connect_archive(config, tmp_path)
    module = manager_module()
    release = threading.Event()

    class PausedModel(DeterministicModel):
        def __call__(self, *args, **kwargs):
            assert release.wait(timeout=10)
            return super().__call__(*args, **kwargs)

    monkeypatch.setattr(module, "model_ready", lambda config: True)
    monkeypatch.setattr(module, "OllamaModel", lambda *args: PausedModel())
    dataset_response = await client.post(
        "/api/v1/personal/optimization/datasets", headers=HEADERS, json={"query": "verification"}
    )
    payload = {
        "dataset_id": dataset_response.json()["id"],
        "name": "Owned job",
        "seed": "Be helpful.",
        "objective": "Ground answers.",
        "max_metric_calls": 12,
    }
    first = await client.post("/api/v1/personal/optimization/runs", headers=HEADERS, json=payload)
    assert first.status_code == 202
    try:
        second = await client.post(
            "/api/v1/personal/optimization/runs", headers=HEADERS, json=payload
        )
        assert second.status_code == 409
    finally:
        release.set()
        run = await module.manager(config).wait(first.json()["id"])
    assert run["status"] == "completed"


async def test_insufficient_budget_is_rejected_before_starting_job(personal, tmp_path, monkeypatch):  # noqa: F811
    client, config = personal
    connect_archive(config, tmp_path)
    module = manager_module()
    monkeypatch.setattr(module, "model_ready", lambda config: True)
    prepared = await client.post(
        "/api/v1/personal/optimization/datasets", headers=HEADERS, json={"query": "verification"}
    )
    assert prepared.json()["minimum_metric_calls"] == 12
    response = await client.post(
        "/api/v1/personal/optimization/runs",
        headers=HEADERS,
        json={
            "dataset_id": prepared.json()["id"],
            "name": "Small budget",
            "seed": "Be helpful.",
            "objective": "Ground answers.",
            "max_metric_calls": 8,
        },
    )
    assert response.status_code == 422
    assert not (await client.get("/api/v1/personal/optimization/runs", headers=HEADERS)).json()
