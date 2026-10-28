import hashlib
import json
import sqlite3

from test_personal import make_corpus

from app.corpus import CorpusIndex


def work_index(
    tmp_path, conversations, *, excerpt_chars=640, scope="all_events", role_counts=False
):
    path = tmp_path / "work.sqlite3"
    make_corpus(path)
    with sqlite3.connect(path) as db:
        db.execute("UPDATE metadata SET value=? WHERE key='document_scope'", (json.dumps(scope),))
        document_id = 3
        for conversation, texts in conversations.items():
            db.execute(
                "INSERT INTO conversations VALUES(?,?,?,?,?,?,?)",
                (conversation, "fixture", None, None, None, len(texts), "{}"),
            )
            for ordinal, entry in enumerate(texts):
                text = entry if isinstance(entry, str) else entry["content"]
                kind = "message" if isinstance(entry, str) else entry.get("kind", "message")
                role = "assistant" if isinstance(entry, str) else entry.get("role", "assistant")
                db.execute(
                    "INSERT INTO documents VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                    (
                        document_id,
                        conversation,
                        ordinal,
                        0,
                        kind,
                        role,
                        None,
                        None,
                        hashlib.sha256(text.encode()).hexdigest(),
                        len(text),
                        text,
                    ),
                )
                db.execute("INSERT INTO document_fts(rowid,text) VALUES(?,?)", (document_id, text))
                document_id += 1
        if role_counts:
            counts = dict(db.execute("SELECT role,count(*) FROM documents GROUP BY role"))
            db.execute("INSERT INTO metadata VALUES(?,?)", ("roles", json.dumps(counts)))
    return CorpusIndex(
        str(path),
        hashlib.sha256(path.read_bytes()).hexdigest(),
        max_excerpt_chars=excerpt_chars,
        include_work=True,
    )


def test_unicode_query_retains_french_words(tmp_path):
    index = work_index(tmp_path, {"french": ["Économie et décision du projet."]})
    results = index.search("économie")
    assert [result["conversation_id"] for result in results] == ["french"]


def test_work_search_includes_owner_commands_while_owner_review_excludes_them(tmp_path):
    index = work_index(
        tmp_path,
        {
            "command": [{"kind": "command", "role": "user", "content": "/ship-archive"}],
            "injected": [{"kind": "command", "role": "harness", "content": "/ship-archive"}],
        },
        scope="owner_messages_only",
    )
    results = index.search("ship-archive")
    assert [result["conversation_id"] for result in results] == ["command"]
    assert results[0]["kind"] == "command"
    owner_review = CorpusIndex(str(index.path), index.expected_sha256)
    assert owner_review.search("ship-archive") == []


def test_work_status_counts_owner_commands_from_verified_role_metadata(tmp_path):
    index = work_index(
        tmp_path,
        {"command": [{"kind": "command", "role": "user", "content": "/ship-archive"}]},
        role_counts=True,
    )
    # The base fixture has one owner message; the command is a second owner document.
    assert index.status()["owner_documents"] == 2


def test_matching_term_near_chunk_end_is_in_bounded_excerpt(tmp_path):
    text = "Unrelated filler. " * 85 + "This is the terminalneedle result."
    index = work_index(tmp_path, {"tail": [text]}, excerpt_chars=160)
    [result] = index.search("terminalneedle")
    assert "terminalneedle" in result["excerpt"]
    assert len(result["excerpt"]) <= 160


def test_excerpt_digest_describes_the_returned_excerpt(tmp_path):
    index = work_index(tmp_path, {"long": ["needle evidence " * 100]}, excerpt_chars=160)
    [result] = index.search("needle")
    assert result["excerpt_sha256"] == hashlib.sha256(result["excerpt"].encode()).hexdigest()


def test_long_conversation_does_not_hide_other_matching_conversations(tmp_path):
    index = work_index(
        tmp_path,
        {
            "many": ["needle " * 100 + str(number) for number in range(40)],
            "other": [
                "needle is mentioned in another independent project with a different outcome"
            ],
        },
    )
    results = index.search("needle", limit=2)
    assert {result["conversation_id"] for result in results} == {"many", "other"}
