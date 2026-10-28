"""Behavioral checks for a public intake process with no personal/runtime APIs."""

import json
from pathlib import Path

import httpx
import pytest

import app.main as main
from app.config import Settings, get_settings

BASE = "/api/v1/trace-submissions"
BUYER = "/api/v1/buyer/trace-submissions"
RECEIPT = {"Authorization": "Bearer " + "r" * 43}
BUYER_AUTH = {"Authorization": "Bearer " + "b" * 40}


def public_config(tmp_path, **overrides):
    return Settings(
        _env_file=None,
        trace_market_public=True,
        trace_submissions_enabled=True,
        trace_buyer_token="b" * 40,
        trace_submission_data_dir=str(tmp_path / "market"),
        cors_origins="https://agent.example",
        knowledge_dir=str(tmp_path / "owner-knowledge-must-not-be-loaded"),
        **overrides,
    )


@pytest.fixture
async def public_market(tmp_path, monkeypatch):
    config = public_config(tmp_path)
    monkeypatch.setattr(main, "settings", config)
    main.app.dependency_overrides[get_settings] = lambda: config
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=main.app), base_url="https://agent.example"
    ) as client:
        yield client, config
    main.app.dependency_overrides.clear()


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", "/api/v1/profile"),
        ("POST", "/api/v1/chat"),
        ("POST", "/api/v1/collaborate"),
        ("GET", "/api/v1/personal/status"),
        ("GET", "/api/v1/personal/optimization/status"),
        ("GET", "/docs"),
        ("GET", "/redoc"),
        ("GET", "/openapi.json"),
    ],
)
async def test_public_process_has_no_personal_or_example_api(public_market, method, path):
    client, config = public_market
    # Even accidental runtime mutation must not make the public boundary expose private routes.
    config.personal_enabled = True
    config.personal_token = "owner-code"
    response = await client.request(method, path, json={} if method == "POST" else None)
    assert response.status_code == 404, response.text
    assert response.headers["cache-control"] == "no-store"
    assert response.json() == {"detail": "Not found."}


async def test_public_health_and_readiness_use_submission_storage(public_market):
    client, config = public_market
    assert (await client.get("/health")).status_code == 200
    ready = await client.get("/ready")
    assert ready.status_code == 200, ready.text
    assert ready.json() == {"status": "ready", "service": "trace-submissions"}
    assert ready.headers["cache-control"] == "no-store"
    assert (Path(config.trace_submission_data_dir) / "submissions.sqlite3").exists()
    config.trace_buyer_token = ""
    failed = await client.get("/ready")
    assert failed.status_code == 503
    assert failed.json() == {"status": "not_ready", "service": "trace-submissions"}
    assert not (await client.get("/api/v1/trace-market/status")).json()["enabled"]
    assert (await client.post(BASE, headers=RECEIPT, json={})).status_code == 503


@pytest.mark.parametrize("bad_setting", ["personal", "buyer", "disabled", "wildcard"])
async def test_public_startup_refuses_unsafe_or_unreviewable_config(
    tmp_path, monkeypatch, bad_setting
):
    config = public_config(tmp_path)
    if bad_setting == "personal":
        config.personal_enabled = True
    elif bad_setting == "buyer":
        config.trace_buyer_token = "short"
    elif bad_setting == "disabled":
        config.trace_submissions_enabled = False
    else:
        config.cors_origins = "*"
    monkeypatch.setattr(main, "settings", config)
    with pytest.raises(RuntimeError, match="public trace intake"):
        async with main.lifespan(main.app):
            pass


async def test_public_readiness_fails_when_storage_is_not_a_directory(public_market, tmp_path):
    client, config = public_market
    blocked = tmp_path / "not-a-directory"
    blocked.write_text("not database storage")
    config.trace_submission_data_dir = str(blocked)
    response = await client.get("/ready")
    assert response.status_code == 503
    assert str(blocked) not in response.text


async def test_public_submission_survives_a_new_lifespan_without_exposing_tokens(public_market):
    client, config = public_market
    pack = json.loads(Path(__file__).with_name("trace_pack_fixture.json").read_text())
    response = await client.post(
        BASE,
        headers=RECEIPT,
        json={
            "pack": pack,
            "title": "Public fictional submission",
            "contributor_alias": "",
            "confirm_submission": True,
        },
    )
    assert response.status_code == 201, response.text
    sid = response.json()["submission"]["id"]
    async with main.lifespan(main.app):
        assert (await client.get(BASE + "/" + sid, headers=RECEIPT)).json()["event_count"] == 1
    async with main.lifespan(main.app):
        assert (await client.get(BUYER, headers=BUYER_AUTH)).json()["total"] == 1
    database = Path(config.trace_submission_data_dir) / "submissions.sqlite3"
    assert database.stat().st_mode & 0o777 == 0o600
