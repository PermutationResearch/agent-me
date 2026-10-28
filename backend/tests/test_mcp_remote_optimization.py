"""Remote processing remains bound to explicit consent for the reviewed selection."""

import json

import pytest
from test_mcp_optimization import request_files
from test_optimization_engine import DeterministicModel

from app.mcp_optimization import run_request


@pytest.mark.parametrize(
    "changes",
    [
        {},
        {"confirm_remote_processing": True},
        {"confirm_remote_processing": True, "expected_sha256": "0" * 64},
    ],
)
def test_remote_job_without_matching_selection_consent_never_constructs_model(
    tmp_path, monkeypatch, changes
):
    def forbidden(*args, **kwargs):
        raise AssertionError("No remote model may be constructed without selection consent.")

    monkeypatch.setenv("OPENROUTER_API_KEY", "fixture-key")
    monkeypatch.delenv("AGENT_ME_OPENROUTER_KEY_FILE", raising=False)
    monkeypatch.setattr("app.openrouter_optimization.OpenRouterFreeModel", forbidden)
    request, output, _ = request_files(
        tmp_path, provider="openrouter", model="fixture/model:free", **changes
    )
    assert run_request(request, output) == 1
    result = json.loads(output.read_text())
    assert result["status"] == "failed"
    assert "exact SHA-256" in result["error"]


def test_approved_remote_job_runs_real_gepa_with_only_selected_evidence(tmp_path, monkeypatch):
    prompts = []
    closed = []

    class RemoteFixture(DeterministicModel):
        def __init__(self, model, key):
            super().__init__()
            assert model == "fixture/model:free"
            assert key == "fixture-key"

        def preflight(self):
            return {"free_only": True}

        def __call__(self, prompt, **kwargs):
            prompts.append(prompt)
            return super().__call__(prompt, **kwargs)

        def report(self):
            return {
                "free_only": True,
                "usage": {"reported_cost": "0"},
                "requested_model": "fixture/model:free",
            }

        def close(self):
            closed.append(True)

    monkeypatch.setattr("app.openrouter_optimization.OpenRouterFreeModel", RemoteFixture)
    monkeypatch.setenv("OPENROUTER_API_KEY", "fixture-key")
    monkeypatch.delenv("AGENT_ME_OPENROUTER_KEY_FILE", raising=False)
    request, output, pack_path = request_files(
        tmp_path, provider="openrouter", model="fixture/model:free", confirm_remote_processing=True
    )
    payload = json.loads(request.read_text())
    payload["expected_sha256"] = json.loads(pack_path.read_text())["integrity"]["sha256"]
    request.write_text(json.dumps(payload))
    before = pack_path.read_bytes()
    assert run_request(request, output) == 0
    result = json.loads(output.read_text())
    assert result["status"] == "completed"
    assert result["execution"]["remote"] is True
    assert result["execution"]["approved_sha256"] == payload["expected_sha256"]
    assert result["execution"]["usage"]["reported_cost"] == "0"
    assert result["result"]["promotion_performed"] is False
    assert prompts and all("unselected-marker" not in prompt for prompt in prompts)
    assert pack_path.read_bytes() == before
    assert closed == [True]
