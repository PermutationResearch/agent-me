import hashlib
import json
import sqlite3
from pathlib import Path

import httpx
import pytest

from app.config import Settings, get_settings
from app.main import app
from app.corpus import CorpusIndex
from app.personal import Entry, Store


@pytest.fixture
async def personal(tmp_path):
    knowledge = tmp_path / "public"
    knowledge.mkdir()
    config = Settings(
        _env_file=None,
        personal_enabled=True,
        personal_token="t" * 40,
        personal_data_dir=str(tmp_path / "private"),
        knowledge_dir=str(knowledge),
    )
    app.dependency_overrides[get_settings] = lambda: config
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        yield client, config
    app.dependency_overrides.clear()


HEADERS = {"Authorization": "Bearer " + "t" * 40}


def make_corpus(path: Path) -> str:
    with sqlite3.connect(path) as db:
        db.executescript(
            """
            CREATE TABLE metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
            CREATE TABLE conversations(
                conversation_id TEXT PRIMARY KEY, source TEXT NOT NULL, title TEXT,
                created_at TEXT, updated_at TEXT, event_count INTEGER NOT NULL,
                provenance_json TEXT NOT NULL
            ) WITHOUT ROWID;
            CREATE TABLE documents(
                document_id INTEGER PRIMARY KEY, conversation_id TEXT NOT NULL,
                ordinal INTEGER NOT NULL, chunk_index INTEGER NOT NULL,
                kind TEXT NOT NULL, role TEXT NOT NULL, timestamp TEXT,
                tool_name TEXT, content_sha256 TEXT NOT NULL,
                char_count INTEGER NOT NULL, excerpt TEXT NOT NULL
            );
            CREATE VIRTUAL TABLE document_fts USING fts5(
                text, content='', detail=column, tokenize='unicode61 remove_diacritics 2'
            );
            """
        )
        metadata = {
            "schema": "hsm.ai_corpus_semantic_index.v1",
            "trust": "untrusted_corpus",
            "read_only_intent": True,
            "promotion_side_effects": False,
            "document_scope": "owner_messages_only",
            "counts": {"records": 1, "events": 2},
            "sources": [
                {
                    "source": "normalized-jsonl",
                    "embedded_sources": ["codex"],
                }
            ],
        }
        db.executemany(
            "INSERT INTO metadata VALUES(?,?)",
            [(key, json.dumps(value)) for key, value in metadata.items()],
        )
        db.execute(
            "INSERT INTO conversations VALUES(?,?,?,?,?,?,?)",
            ("conv_fixture", "codex", None, None, None, 2, "{}"),
        )
        for document_id, role, excerpt in (
            (1, "user", "Owner prefers focused semantic verification."),
            (2, "assistant", "Assistant claims a private identity secret."),
        ):
            db.execute(
                "INSERT INTO documents VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                (
                    document_id,
                    "conv_fixture",
                    document_id,
                    0,
                    "message",
                    role,
                    "2026-01-01T00:00:00Z",
                    None,
                    hashlib.sha256(excerpt.encode()).hexdigest(),
                    len(excerpt),
                    excerpt,
                ),
            )
            db.execute("INSERT INTO document_fts(rowid,text) VALUES(?,?)", (document_id, excerpt))
    path.chmod(0o600)
    return hashlib.sha256(path.read_bytes()).hexdigest()


async def test_auth_and_disabled(personal):
    client, config = personal
    for path in ("entries", "history", "export"):
        assert (await client.get(f"/api/v1/personal/{path}")).status_code == 401
    assert not Path(config.personal_data_dir).exists()  # noqa: ASYNC240
    config.personal_enabled = False
    assert (await client.get("/api/v1/personal/entries", headers=HEADERS)).status_code == 404


async def test_confirm_edit_delete_and_public_isolation(personal):
    client, config = personal
    base = "/api/v1/personal"
    response = await client.post(
        base + "/entries",
        headers=HEADERS,
        json={"kind": "fact", "key": "project", "content": "SecretOrchid"},
    )
    item = response.json()
    assert item["status"] == "pending"
    query = {"question": "SecretOrchid"}
    assert not (await client.post(base + "/chat", json=query, headers=HEADERS)).json()["sources"]
    await client.post(base + f"/entries/{item['id']}/confirm", headers=HEADERS, json={})
    assert (
        "SecretOrchid"
        in (await client.post(base + "/chat", json=query, headers=HEADERS)).json()["answer"]
    )
    assert not (await client.post("/api/v1/chat", json=query)).json()["sources"]
    # A new Store instance sees persisted confirmed data.
    assert Store(config.personal_data_dir).entries()[0]["status"] == "confirmed"
    await client.post(
        base + f"/entries/{item['id']}/edit",
        headers=HEADERS,
        json={"kind": "fact", "key": "project", "content": "NewOrchid"},
    )
    assert not (await client.post(base + "/chat", json=query, headers=HEADERS)).json()["sources"]
    await client.post(base + f"/entries/{item['id']}/confirm", headers=HEADERS, json={})
    await client.post(base + f"/entries/{item['id']}/delete", headers=HEADERS, json={})
    assert not (await client.post(base + "/chat", json=query, headers=HEADERS)).json()["sources"]
    exported = (await client.get(base + "/export", headers=HEADERS)).json()
    assert exported["entries"] == [] and exported["history"]
    await client.post(base + "/history/clear", headers=HEADERS, json={})
    assert (await client.get(base + "/history", headers=HEADERS)).json() == []


async def test_candidate_and_explicit_conflict(personal):
    client, _ = personal
    base = "/api/v1/personal"
    await client.post(base + "/chat", headers=HEADERS, json={"question": "记住：先给结论"})
    items = (await client.get(base + "/entries", headers=HEADERS)).json()
    first = items[0]
    assert first["content"] == "先给结论" and first["source"].startswith("turn:")
    await client.post(base + f"/entries/{first['id']}/confirm", headers=HEADERS, json={})
    await client.post(base + "/chat", headers=HEADERS, json={"question": "记住：先给细节"})
    second = (await client.get(base + "/entries", headers=HEADERS)).json()[1]
    url = base + f"/entries/{second['id']}/confirm"
    assert (await client.post(url, headers=HEADERS, json={})).status_code == 409
    assert (
        await client.post(url, headers=HEADERS, json={"replace_ids": ["wrong"]})
    ).status_code == 409
    assert (
        await client.post(url, headers=HEADERS, json={"replace_ids": [first["id"]]})
    ).status_code == 200
    assert len((await client.get(base + "/entries", headers=HEADERS)).json()) == 1


async def test_richer_candidate_kinds_remain_pending(personal):
    client, _ = personal
    base = "/api/v1/personal/entries"
    for kind in ("project", "skill", "working_pattern"):
        response = await client.post(
            base,
            headers=HEADERS,
            json={"kind": kind, "key": f"{kind}.example", "content": "Review me"},
        )
        assert response.status_code == 200
        assert response.json()["status"] == "pending"


async def test_private_markdown_and_validation(personal):
    client, config = personal
    root = Path(config.personal_data_dir) / "knowledge"
    root.mkdir(parents=True)
    (root / "local.md").write_text("# Private\n\nSecretTulip", encoding="utf-8")
    result = await client.post(
        "/api/v1/personal/chat", headers=HEADERS, json={"question": "SecretTulip"}
    )
    assert result.json()["sources"][0]["path"].startswith("private/knowledge/")
    assert not (await client.post("/api/v1/chat", json={"question": "SecretTulip"})).json()[
        "sources"
    ]
    assert (
        await client.post(
            "/api/v1/personal/entries", headers=HEADERS, json={"key": " ", "content": "x"}
        )
    ).status_code == 422


def test_preferences_survive_and_deleted_not_retrieved(tmp_path):
    db = Store(str(tmp_path))
    item = db.add(Entry(kind="preference", key="response.style", content="Be concise"))
    assert db.context("unrelated") == []
    db.confirm(item["id"], [])
    assert Store(str(tmp_path)).context("unrelated")
    db.delete(item["id"])
    assert not db.context("unrelated")


async def test_private_provider_receives_only_current_confirmed_context(personal, monkeypatch):
    import app.personal as personal_module

    client, config = personal
    captured = []

    async def fake_answer(**kwargs):
        captured.append(kwargs)
        return "Generated answer", "openai-compatible"

    monkeypatch.setattr(personal_module, "generate_answer", fake_answer)
    db = Store(config.personal_data_dir)
    pending = db.add(Entry(kind="fact", key="private.fact", content="PendingSecret"))
    approved = db.add(Entry(kind="preference", key="response.style", content="Short paragraphs"))
    db.confirm(approved["id"], [])
    db.save_chat("OldSecret", "Old answer")
    response = await client.post(
        "/api/v1/personal/chat", headers=HEADERS, json={"question": "PendingSecret"}
    )
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    context = "\n".join(m.excerpt for m in captured[0]["matches"])
    assert "Short paragraphs" in context
    assert "PendingSecret" not in context
    assert "OldSecret" not in context
    assert captured[0]["history"] == []
    db.delete(pending["id"])
    db.delete(approved["id"])
    await client.post("/api/v1/personal/chat", headers=HEADERS, json={"question": "paragraphs"})
    assert not captured[-1]["matches"]


async def test_private_corpus_search_is_verified_owner_only_and_review_only(personal):
    client, config = personal
    corpus_path = Path(config.personal_data_dir).parent / "semantic.sqlite3"
    config.personal_corpus_index = str(corpus_path)
    config.personal_corpus_sha256 = make_corpus(corpus_path)

    status = (await client.get("/api/v1/personal/corpus/status", headers=HEADERS)).json()
    assert status["verified"] is True
    assert status["read_only"] is True
    assert status["review_only"] is True
    assert status["promotion_performed"] is False
    assert status["sources"] == ["codex"]

    owner = await client.post(
        "/api/v1/personal/corpus/search",
        headers=HEADERS,
        json={"query": "semantic verification"},
    )
    assert owner.status_code == 200
    result = owner.json()["results"][0]
    assert result["author_role"] == "owner"
    assert result["instruction_authority"] == "none"
    assert result["review_only"] is True
    assert "Owner prefers" in result["excerpt"]

    assistant = await client.post(
        "/api/v1/personal/corpus/search",
        headers=HEADERS,
        json={"query": "identity secret"},
    )
    assert assistant.json()["results"] == []
    # Opening/searching the immutable corpus does not create SQLite sidecars.
    assert not corpus_path.with_suffix(".sqlite3-wal").exists()
    assert not corpus_path.with_suffix(".sqlite3-shm").exists()


async def test_private_corpus_fails_closed_on_digest_mismatch(personal):
    client, config = personal
    corpus_path = Path(config.personal_data_dir).parent / "semantic.sqlite3"
    make_corpus(corpus_path)
    config.personal_corpus_index = str(corpus_path)
    config.personal_corpus_sha256 = "0" * 64
    response = await client.get("/api/v1/personal/corpus/status", headers=HEADERS)
    assert response.status_code == 503
    assert response.json()["detail"] == "Private corpus verification failed"
