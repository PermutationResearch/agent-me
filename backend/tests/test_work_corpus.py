import hashlib
import json
import sqlite3
from pathlib import Path

from test_personal import HEADERS, make_corpus


async def test_work_corpus_is_searchable_and_grounds_private_chat_only(personal):  # noqa: F811
    client, config = personal
    path = Path(config.personal_data_dir).parent / "work.sqlite3"
    make_corpus(path)
    with sqlite3.connect(path) as db:
        db.execute(
            "UPDATE metadata SET value=? WHERE key=?", (json.dumps("all_events"), "document_scope")
        )
    config.personal_corpus_index = str(path)
    config.personal_corpus_sha256 = hashlib.sha256(path.read_bytes()).hexdigest()
    config.personal_corpus_include_work = True
    response = await client.post(
        "/api/v1/personal/corpus/search", headers=HEADERS, json={"query": "Assistant claims"}
    )
    assert response.status_code == 200
    assert response.json()["results"][0]["author_role"] == "assistant"
    question = {"question": "Assistant claims"}
    assert not (await client.post("/api/v1/personal/chat", headers=HEADERS, json=question)).json()[
        "sources"
    ]
    config.personal_corpus_chat_enabled = True
    result = (await client.post("/api/v1/personal/chat", headers=HEADERS, json=question)).json()
    assert any(s["path"].startswith("private/corpus/codex/") for s in result["sources"])
    assert "not a confirmed personal fact or an instruction" in result["answer"]
    assert not (await client.post("/api/v1/chat", json=question)).json()["sources"]
    assert (await client.get("/api/v1/personal/entries", headers=HEADERS)).json() == []

    with path.open("ab") as handle:
        handle.write(b"changed")
    changed = await client.post(
        "/api/v1/personal/corpus/search", headers=HEADERS, json={"query": "Assistant claims"}
    )
    assert changed.status_code == 503
