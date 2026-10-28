"""Archive cases stay attributable and separate from optimizer training policy."""

import hashlib
import importlib
import json
import sqlite3
from collections import Counter
from pathlib import Path

import pytest

from app.corpus import CorpusIndex


def make_work_corpus(tmp_path: Path, n: int = 18) -> CorpusIndex:
    path = tmp_path / "optimization-work.sqlite3"
    sources = ("claude-code", "codex", "omp", "saved-work", "codex-thread-history", "omp-history")
    with sqlite3.connect(path) as db:
        db.executescript("""
            CREATE TABLE metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE conversations(
                conversation_id TEXT PRIMARY KEY, source TEXT NOT NULL, title TEXT,
                created_at TEXT, updated_at TEXT, event_count INTEGER NOT NULL,
                provenance_json TEXT NOT NULL
            );
            CREATE TABLE documents(
                document_id INTEGER PRIMARY KEY, conversation_id TEXT NOT NULL,
                ordinal INTEGER NOT NULL, chunk_index INTEGER NOT NULL,
                kind TEXT NOT NULL, role TEXT NOT NULL, timestamp TEXT,
                tool_name TEXT, content_sha256 TEXT NOT NULL,
                char_count INTEGER NOT NULL, excerpt TEXT NOT NULL
            );
            CREATE INDEX documents_conversation_order
                ON documents(conversation_id, ordinal, chunk_index);
            CREATE VIRTUAL TABLE document_fts USING fts5(
                text, content='', detail=column, tokenize='unicode61 remove_diacritics 2'
            );
        """)
        for number in range(n):
            source = sources[number % len(sources)]
            conversation = f"conversation-{number}"
            rows = [
                (0, "system", "message", "SYSTEM-EXCLUDED"),
                (1, "user", "message", f"Please improve release verification task {number}."),
                (
                    2,
                    "assistant",
                    "message",
                    f"Historical verification answer {number}; not gold truth.",
                ),
                (
                    3,
                    "tool",
                    "tool_result",
                    f"verification test result {number}: observed tool evidence",
                ),
            ]
            if source in {"saved-work", "codex-thread-history", "omp-history"}:
                rows = [
                    (0, "developer", "message", "DEVELOPER-EXCLUDED"),
                    (
                        1,
                        "document" if source == "saved-work" else "unknown",
                        "message",
                        f"verification archived artifact {number}; untrusted statement",
                    ),
                ]
            db.execute(
                "INSERT INTO conversations VALUES(?,?,?,?,?,?,?)",
                (conversation, source, None, None, None, len(rows), "{}"),
            )
            for ordinal, role, kind, excerpt in rows:
                _document(db, conversation, ordinal, role, kind, excerpt)
        metadata = {
            "schema": "hsm.ai_corpus_semantic_index.v1",
            "trust": "untrusted_corpus",
            "read_only_intent": True,
            "promotion_side_effects": False,
            "document_scope": "all_events",
            "counts": {"records": n, "events": n * 3},
            "roles": {"user": n},
            "sources": [{"source": source} for source in sources],
        }
        db.executemany(
            "INSERT INTO metadata VALUES(?,?)", [(k, json.dumps(v)) for k, v in metadata.items()]
        )
    path.chmod(0o600)
    return _index(path)


def _document(db, conversation, ordinal, role, kind, excerpt):
    row = db.execute(
        "INSERT INTO documents VALUES(NULL,?,?,?,?,?,?,?,?,?,?)",
        (
            conversation,
            ordinal,
            0,
            kind,
            role,
            "2026-01-01T00:00:00Z",
            None,
            hashlib.sha256(excerpt.encode()).hexdigest(),
            len(excerpt),
            excerpt,
        ),
    )
    db.execute("INSERT INTO document_fts(rowid,text) VALUES(?,?)", (row.lastrowid, excerpt))


def _index(path):
    return CorpusIndex(str(path), hashlib.sha256(path.read_bytes()).hexdigest(), include_work=True)


def prepare(index, query="verification", example_limit=18):
    try:
        function = importlib.import_module("app.optimization_data").prepare_dataset
    except ModuleNotFoundError:
        pytest.fail("Archive dataset preparation is not implemented")
    return function(index, query, example_limit)


def all_cases(dataset):
    return [case for cases in dataset["splits"].values() for case in cases]


def test_prepares_all_work_sources_with_attributable_untrusted_context(tmp_path):
    index = make_work_corpus(tmp_path)
    before = index.path.read_bytes()
    dataset = prepare(index)
    assert dataset["total_examples"] == 18
    assert dataset["archive_sha256"] == index.expected_sha256
    assert set(dataset["source_counts"]) == {
        "claude-code",
        "codex",
        "omp",
        "saved-work",
        "codex-thread-history",
        "omp-history",
    }
    cases = all_cases(dataset)
    assert Counter(case["source"] for case in cases) == dataset["source_counts"]
    for case in cases:
        assert case["conversation_id"]
        assert case["context"]
        assert "verification" in " ".join(row["excerpt"] for row in case["context"])
        assert all(row["role"] not in {"system", "developer", "harness"} for row in case["context"])
        assert all(row["trust"] == "untrusted_corpus" for row in case["context"])
        assert all(row["instruction_authority"] == "none" for row in case["context"])
        assert all(
            row["document_id"] and len(row["excerpt_sha256"]) == 64 for row in case["context"]
        )
        if case["source"] in {"saved-work", "codex-thread-history", "omp-history"}:
            assert case["question_origin"] == "objective"
            assert case["question"] == "verification"
        else:
            assert case["question_origin"] == "owner"
            assert case["question"].startswith("Please improve release verification task")
    assert index.path.read_bytes() == before


def test_task_splits_are_deterministic_and_duplicate_owner_tasks_stay_together(tmp_path):
    index = make_work_corpus(tmp_path)
    with sqlite3.connect(index.path) as db:
        db.execute(
            "INSERT INTO conversations VALUES(?,?,?,?,?,?,?)",
            ("mirror", "codex", None, None, None, 1, "{}"),
        )
        _document(
            db, "mirror", 1, "human", "message", "  PLEASE improve release verification task 0.  "
        )
    index = _index(index.path)
    first, second = prepare(index), prepare(index)
    assert first["splits"] == second["splits"]
    assert first["excluded_duplicate_tasks"] == 1
    identifiers = [{case["id"] for case in split} for split in first["splits"].values()]
    assert all(identifiers)
    assert not (
        identifiers[0] & identifiers[1]
        or identifiers[0] & identifiers[2]
        or identifiers[1] & identifiers[2]
    )
    assert sum(map(len, identifiers)) == 18
    assert {case["question_origin"] for case in all_cases(first)} == {"owner", "objective"}


def test_nearest_owner_question_is_used_and_matching_evidence_survives_bounds(tmp_path):
    index = make_work_corpus(tmp_path)
    with sqlite3.connect(index.path) as db:
        _document(db, "conversation-0", 4, "human", "message", "Newer focused task")
        for ordinal in range(5, 20):
            _document(db, "conversation-0", ordinal, "tool", "tool_result", "x" * 5000)
        _document(
            db,
            "conversation-0",
            20,
            "assistant",
            "message",
            "verification unique latest matching evidence",
        )
        for number in range(1, 18):
            _document(
                db,
                f"conversation-{number}",
                20,
                "assistant",
                "message",
                f"unique latest matching evidence {number}",
            )
    index = _index(index.path)
    dataset = prepare(index, "unique latest")
    case = next(case for case in all_cases(dataset) if case["conversation_id"] == "conversation-0")
    assert case["question"] == "Newer focused task"
    assert len(case["context"]) <= 8
    assert sum(len(row["excerpt"]) for row in case["context"]) <= 12000
    assert any("unique latest matching evidence" in row["excerpt"] for row in case["context"])


def test_requires_verified_work_scope(tmp_path):
    index = make_work_corpus(tmp_path)
    index.include_work = False
    with pytest.raises(ValueError, match="all-events work archive"):
        prepare(index)
    index.include_work = True
    index.metadata["document_scope"] = "owner_messages_only"
    with pytest.raises(ValueError, match="all-events work archive"):
        prepare(index)


def test_requires_enough_distinct_examples(tmp_path):
    index = make_work_corpus(tmp_path, n=5)
    with pytest.raises(ValueError, match="6 distinct"):
        prepare(index)


def test_preparation_limits_are_enforced(tmp_path):
    index = make_work_corpus(tmp_path)
    with pytest.raises(ValueError, match="6.*60"):
        prepare(index, example_limit=100)
    with pytest.raises(ValueError, match="query"):
        prepare(index, query=" ")
