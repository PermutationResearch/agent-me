"""Prepare bounded, attributable historical cases without promoting archive text."""

from __future__ import annotations

import hashlib
import unicodedata
from collections import Counter, defaultdict, deque
from uuid import uuid4

from .corpus import UNTRUSTED, CorpusIndex

_ALLOWED_ROLES = ("user", "human", "assistant", "tool", "agent", "document", "unknown")
_CONTEXT_DOCUMENTS = 8
_CONTEXT_CHARACTERS = 12000


def _digest(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _normalized(text: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", text).casefold().split())


def _context(db, conversation: str, match) -> list[dict]:
    placeholders = ",".join("?" for _ in _ALLOWED_ROLES)
    rows = db.execute(
        f"""SELECT document_id,ordinal,chunk_index,role,kind,timestamp,excerpt,
                   content_sha256
              FROM documents
             WHERE conversation_id=? AND role IN ({placeholders})
             ORDER BY CASE WHEN document_id=? THEN 0 ELSE 1 END,
                      ABS(ordinal-?),ABS(chunk_index-?),ordinal,chunk_index
             LIMIT ?""",
        (
            conversation,
            *_ALLOWED_ROLES,
            match["document_id"],
            match["ordinal"],
            match["chunk_index"],
            _CONTEXT_DOCUMENTS,
        ),
    ).fetchall()
    # Allocate to the matching evidence first so a large neighboring event cannot
    # crowd it out. Return the retained evidence in its original chronological order.
    context = []
    remaining = _CONTEXT_CHARACTERS
    for row in rows:
        excerpt = row["excerpt"][:remaining]
        if not excerpt:
            continue
        context.append(
            {
                "document_id": row["document_id"],
                "ordinal": row["ordinal"],
                "chunk_index": row["chunk_index"],
                "role": row["role"],
                "kind": row["kind"],
                "timestamp": row["timestamp"],
                "excerpt": excerpt,
                "excerpt_sha256": _digest(excerpt),
                "original_content_sha256": row["content_sha256"],
                "trust": UNTRUSTED,
                "instruction_authority": "none",
            }
        )
        remaining -= len(excerpt)
        if not remaining:
            break
    return sorted(context, key=lambda row: (row["ordinal"], row["chunk_index"]))


def prepare_dataset(index: CorpusIndex, query: str, example_limit: int = 18) -> dict:
    """Select relevant task groups; split before any GEPA evaluation takes place.

    Historical output is reference evidence, never verified ground truth. A case
    with no authenticated owner request uses the current owner's query as its
    task instead of misattributing an assistant, tool, or document as the owner.
    """
    if not index.include_work or index.metadata.get("document_scope") != "all_events":
        raise ValueError("A verified all-events work archive is required")
    query = query.strip()
    if not 2 <= len(query) <= 2000:
        raise ValueError("Archive query must contain between 2 and 2000 characters")
    if not 6 <= example_limit <= 60:
        raise ValueError("Choose between 6 and 60 examples")

    hits = index.search(query, limit=example_limit * 4)
    grouped = defaultdict(deque)
    seen_tasks = set()
    excluded_duplicates = 0
    with index.connect() as db:
        for hit in hits:
            match = db.execute(
                "SELECT document_id,ordinal,chunk_index,excerpt FROM documents "
                "WHERE document_id=? AND conversation_id=?",
                (int(hit["evidence_id"].removeprefix("doc_")), hit["conversation_id"]),
            ).fetchone()
            if match is None:
                continue
            owner = db.execute(
                """SELECT document_id,excerpt FROM documents
                    WHERE conversation_id=? AND ordinal<=? AND kind='message'
                      AND role IN ('user','human') AND trim(excerpt)!=''
                    ORDER BY ordinal DESC,chunk_index LIMIT 1""",
                (hit["conversation_id"], match["ordinal"]),
            ).fetchone()
            question = owner["excerpt"][:2000] if owner else query
            origin = "owner" if owner else "objective"
            task = _normalized(question) if owner else _normalized(match["excerpt"])
            task_id = _digest(f"{origin}:{task}")
            if task_id in seen_tasks:
                excluded_duplicates += 1
                continue
            seen_tasks.add(task_id)
            grouped[hit["source"]].append(
                {
                    "id": task_id,
                    "conversation_id": hit["conversation_id"],
                    "source": hit["source"],
                    "question": question,
                    "question_origin": origin,
                    "question_document_id": owner["document_id"] if owner else None,
                    "question_sha256": _digest(question),
                    "matching_document_id": match["document_id"],
                    "context": _context(db, hit["conversation_id"], match),
                }
            )

    # Let less frequent source types participate when they have relevant hits,
    # rather than filling the whole sample from one source's highest-ranked hits.
    cases = []
    while grouped and len(cases) < example_limit:
        for source in sorted(grouped):
            cases.append(grouped[source].popleft())
            if not grouped[source]:
                del grouped[source]
            if len(cases) == example_limit:
                break
    if len(cases) < 6:
        raise ValueError(
            "At least 6 distinct historical tasks are required; broaden the archive query"
        )

    cases.sort(
        key=lambda case: _digest(f"{index.expected_sha256}:{_normalized(query)}:{case['id']}")
    )
    held_out = max(1, len(cases) // 5)
    training_end = len(cases) - 2 * held_out
    return {
        "id": uuid4().hex,
        "query": query,
        "archive_sha256": index.expected_sha256,
        "source_counts": dict(Counter(case["source"] for case in cases)),
        "total_examples": len(cases),
        "excluded_duplicate_tasks": excluded_duplicates,
        "splits": {
            "train": cases[:training_end],
            "validation": cases[training_end:-held_out],
            "test": cases[-held_out:],
        },
        "trust": UNTRUSTED,
        "instruction_authority": "none",
        "historical_answers_are_verified": False,
    }
