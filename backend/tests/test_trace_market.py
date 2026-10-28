import hashlib
import json
import sqlite3
from pathlib import Path

import httpx
import pytest

from app.config import Settings, get_settings
from app.main import app

BASE = "/api/v1/trace-submissions"
BUYER = "/api/v1/buyer/trace-submissions"
RECEIPT = {"Authorization": "Bearer " + "r" * 43}
BUYER_AUTH = {"Authorization": "Bearer " + "b" * 40}


def fixture_pack():
    return json.loads(Path(__file__).with_name("trace_pack_fixture.json").read_text())


def seal(pack):
    body = {key: value for key, value in pack.items() if key != "integrity"}
    pack["integrity"]["sha256"] = hashlib.sha256(
        json.dumps(body, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    return pack


@pytest.fixture
async def market(tmp_path):
    config = Settings(
        _env_file=None,
        trace_submissions_enabled=True,
        trace_buyer_token="b" * 40,
        trace_submission_data_dir=str(tmp_path / "market"),
    )
    app.dependency_overrides[get_settings] = lambda: config
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        yield client, config
    app.dependency_overrides.clear()


async def submit(client, headers=None, pack=None, **extra):
    return await client.post(
        BASE,
        headers=headers or RECEIPT,
        json={
            "pack": pack or fixture_pack(),
            "title": "Fictional test run",
            "contributor_alias": "Test contributor",
            "confirm_submission": True,
            **extra,
        },
    )


async def test_status_and_role_isolation(market):
    client, config = market
    status = await client.get("/api/v1/trace-market/status")
    assert status.status_code == 200 and status.json()["enabled"]
    assert status.headers["cache-control"] == "no-store"
    assert (await client.get(BUYER)).status_code == 401
    assert (await client.get(BUYER, headers=RECEIPT)).status_code == 401
    assert (await client.post(BASE, json={})).status_code == 401
    assert not Path(config.trace_submission_data_dir).exists()  # noqa: ASYNC240
    config.trace_buyer_token = ""
    assert not (await client.get("/api/v1/trace-market/status")).json()["enabled"]
    assert (await submit(client)).status_code == 503


async def test_submission_retry_persistence_and_secret_storage(market):
    client, config = market
    response = await submit(client)
    assert response.status_code == 201, response.text
    detail = response.json()["submission"]
    sid = detail["id"]
    assert detail["event_count"] == 1 and detail["status"] == "submitted"
    assert "review_notes" not in detail
    assert (await submit(client)).status_code == 200
    assert (await submit(client)).json()["submission"]["id"] == sid
    assert (await submit(client, title="Different title")).status_code == 409
    assert (await client.get(BASE + "/" + sid, headers=BUYER_AUTH)).status_code == 401
    assert (await client.get(BASE + "/" + sid, headers=RECEIPT)).json() == detail
    stored_pack = (await client.get(BASE + "/" + sid + "/pack", headers=RECEIPT)).json()
    assert stored_pack == fixture_pack() and stored_pack["offer"]["submitted"] is False
    db_path = Path(config.trace_submission_data_dir) / "submissions.sqlite3"
    assert db_path.stat().st_mode & 0o777 == 0o600
    with sqlite3.connect(db_path) as db:
        dumped = "\n".join(db.iterdump())
    assert "r" * 43 not in dumped and "b" * 40 not in dumped
    listing = (await client.get(BUYER, headers=BUYER_AUTH)).json()
    assert listing["total"] == 1 and listing["counts"]["submitted"] == 1


@pytest.mark.parametrize(
    "mutation", ["content", "count", "file", "extra", "personal", "bool", "hash"]
)
async def test_reject_invalid_selected_pack_without_echoing_content(market, mutation):
    client, _ = market
    pack = fixture_pack()
    if mutation == "content":
        pack["events"][0]["content"] = "SecretSensitiveValue"
    elif mutation == "count":
        pack["selection"]["events"] = 2
        seal(pack)
    elif mutation == "file":
        pack["events"][0]["origin"]["file_sha256"] = "0" * 64
        seal(pack)
    elif mutation == "extra":
        pack["events"][0]["raw_attachment"] = "SecretSensitiveValue"
        seal(pack)
    elif mutation == "personal":
        pack["intent"] = "personal_export"
        pack["offer"] = None
        seal(pack)
    elif mutation == "bool":
        pack["privacy"]["manual_review_confirmed"] = 1
        seal(pack)
    else:
        pack["integrity"]["sha256"] = "0" * 64
    response = await submit(client, pack=pack)
    assert response.status_code == 422, response.text
    assert "SecretSensitiveValue" not in response.text
    assert response.headers["cache-control"] == "no-store"
    assert (await client.get(BUYER, headers=BUYER_AUTH)).json()["total"] == 0


async def test_unicode_canonical_pack(market):
    client, _ = market
    pack = fixture_pack()
    pack["events"][0]["content"] = "你好 café 🍃"
    pack["events"][0]["content_sha256"] = hashlib.sha256(
        pack["events"][0]["content"].encode()
    ).hexdigest()
    response = await submit(client, pack=seal(pack))
    assert response.status_code == 201, response.text


async def test_review_offer_response_and_private_notes(market):
    client, _ = market
    sid = (await submit(client)).json()["submission"]["id"]
    path = BUYER + "/" + sid
    review = await client.post(
        path + "/review",
        headers=BUYER_AUTH,
        json={"status": "under_review", "note": "Private reviewer assessment"},
    )
    assert review.status_code == 200 and review.json()["status"] == "under_review"
    contributor = (await client.get(BASE + "/" + sid, headers=RECEIPT)).json()
    assert "Private reviewer assessment" not in json.dumps(contributor)
    events = (await client.get(path + "/events?query=fictional", headers=BUYER_AUTH)).json()
    assert events["total"] == 1
    assert (await client.get(path + "/events?query=missing", headers=BUYER_AUTH)).json()[
        "total"
    ] == 0
    offer = {
        "amount_minor": 1250,
        "currency": "CAD",
        "proposed_uses": ["evaluation"],
        "message": "Fictional proposal only",
    }
    wrong = await client.post(
        path + "/offers",
        headers=BUYER_AUTH,
        json={**offer, "proposed_uses": ["small_model_training"]},
    )
    assert wrong.status_code == 422
    assert (
        await client.post(
            path + "/offers", headers=BUYER_AUTH, json={**offer, "amount_minor": 12.5}
        )
    ).status_code == 422
    first = (await client.post(path + "/offers", headers=BUYER_AUTH, json=offer)).json()
    second = (await client.post(path + "/offers", headers=BUYER_AUTH, json=offer)).json()
    assert second["offers"][0]["status"] == "superseded"
    response_path = BASE + "/" + sid + "/respond"
    assert (
        await client.post(
            response_path,
            headers=RECEIPT,
            json={"offer_id": first["current_offer"]["id"], "decision": "accept"},
        )
    ).status_code == 409
    accepted = await client.post(
        response_path,
        headers=RECEIPT,
        json={"offer_id": second["current_offer"]["id"], "decision": "accept"},
    )
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["status"] == "accepted_pending_agreement"
    assert accepted.json()["payment_status"] == "not_started"
    assert (await client.post(path + "/offers", headers=BUYER_AUTH, json=offer)).status_code == 409


async def test_withdraw_erases_pack_and_closes_offer(market):
    client, config = market
    sid = (await submit(client)).json()["submission"]["id"]
    path = BUYER + "/" + sid
    await client.post(
        path + "/offers",
        headers=BUYER_AUTH,
        json={
            "amount_minor": 100,
            "currency": "USD",
            "proposed_uses": ["evaluation"],
            "message": "",
        },
    )
    withdrawn = await client.post(BASE + "/" + sid + "/withdraw", headers=RECEIPT, json={})
    assert withdrawn.status_code == 200 and withdrawn.json()["status"] == "withdrawn"
    assert withdrawn.json()["current_offer"]["status"] == "declined"
    assert (await client.get(path + "/events", headers=BUYER_AUTH)).status_code == 410
    assert (await client.get(path + "/pack", headers=BUYER_AUTH)).status_code == 410
    assert (await client.get(BASE + "/" + sid + "/pack", headers=RECEIPT)).status_code == 410
    assert (await submit(client)).status_code == 200  # retry never restores withdrawn content
    with sqlite3.connect(Path(config.trace_submission_data_dir) / "submissions.sqlite3") as db:
        assert "Reviewed fictional task" not in "\n".join(db.iterdump())


async def test_size_quota_and_safe_validation_errors(market):
    client, config = market
    config.trace_submission_max_bytes = 1024
    assert (await submit(client)).status_code == 413
    config.trace_submission_max_bytes = 25 * 1024 * 1024
    config.trace_submission_storage_limit_bytes = 100
    assert (await submit(client)).status_code == 503
    response = await client.post(
        BASE, headers=RECEIPT, json={"pack": "SecretSensitiveValue", "confirm_submission": True}
    )
    assert response.status_code == 422 and "SecretSensitiveValue" not in response.text


async def test_submission_upload_limit_does_not_expand_other_routes(market):
    client, _ = market
    pack = fixture_pack()
    content = "Fictional test record. " * 15000
    pack["events"][0]["content"] = content
    pack["events"][0]["content_sha256"] = hashlib.sha256(content.encode()).hexdigest()
    response = await submit(client, pack=seal(pack))
    assert response.status_code == 201, response.text
    other = await client.post("/api/v1/chat", json={"question": content})
    assert other.status_code == 413 and other.headers["cache-control"] == "no-store"


async def test_decline_and_list_filter_pagination(market):
    client, _ = market
    first = (await submit(client)).json()["submission"]["id"]
    second = (await submit(client, headers={"Authorization": "Bearer " + "s" * 43})).json()[
        "submission"
    ]["id"]
    declined = await client.post(
        BUYER + "/" + first + "/review",
        headers=BUYER_AUTH,
        json={"status": "declined", "note": "Not a fit"},
    )
    assert declined.json()["status"] == "declined"
    listing = (await client.get(BUYER + "?status=submitted&limit=1", headers=BUYER_AUTH)).json()
    assert listing["total"] == 1 and listing["submissions"][0]["id"] == second
    assert listing["counts"]["declined"] == 1
    assert (await client.get(BUYER + "?offset=1&limit=1", headers=BUYER_AUTH)).json()[
        "submissions"
    ][0]["id"] == first


async def test_contributor_cannot_access_another_pack_or_buyer_notes(market):
    client, _ = market
    sid = (await submit(client)).json()["submission"]["id"]
    wrong = {"Authorization": "Bearer " + "s" * 43}
    for suffix in ("", "/pack"):
        response = await client.get(BASE + "/" + sid + suffix, headers=wrong)
        assert response.status_code == 401 and response.headers["cache-control"] == "no-store"
    assert (
        await client.post(BASE + "/" + sid + "/withdraw", headers=wrong, json={})
    ).status_code == 401
    assert (await client.get(BUYER + "/" + sid, headers=RECEIPT)).status_code == 401
    assert (await submit(client, headers=BUYER_AUTH)).status_code == 401


async def test_quota_retry_and_withdraw_releases_capacity(market):
    client, config = market
    sid = (await submit(client)).json()["submission"]["id"]
    config.trace_submission_storage_limit_bytes = 2000
    assert (await submit(client)).status_code == 200
    other = {"Authorization": "Bearer " + "s" * 43}
    assert (await submit(client, headers=other)).status_code == 503
    await client.post(BASE + "/" + sid + "/withdraw", headers=RECEIPT, json={})
    assert (await submit(client, headers=other)).status_code == 201
