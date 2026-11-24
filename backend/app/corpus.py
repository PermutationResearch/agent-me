"""Verified, immutable access to a private external semantic corpus."""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
import stat
import unicodedata
from contextlib import contextmanager
from functools import cached_property, lru_cache
from pathlib import Path

INDEX_SCHEMA = "hsm.ai_corpus_semantic_index.v1"
UNTRUSTED = "untrusted_corpus"
OWNER_ROLES = ("user", "human")
_TOKENS = re.compile(r"[^\W_]{2,}")


def _fold_for_match(text: str) -> tuple[str, list[int]]:
    characters, offsets = [], []
    for offset, character in enumerate(text):
        for folded in unicodedata.normalize("NFKD", character).casefold():
            if not unicodedata.combining(folded):
                characters.append(folded)
                offsets.append(offset)
    return "".join(characters), offsets


def _bounded_excerpt(text: str, terms: list[str], limit: int) -> str:
    if len(text) <= limit:
        return text
    folded, offsets = _fold_for_match(text)
    wanted = {_fold_for_match(term)[0] for term in terms}
    for match in _TOKENS.finditer(folded):
        if match.group() in wanted:
            first, last = offsets[match.start()], offsets[match.end() - 1] + 1
            padding = max(0, limit - (last - first)) // 2
            start = min(max(0, first - padding), len(text) - limit)
            return text[start : start + limit]
    return text[:limit]


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _identity(path: Path) -> tuple[int, int, int, int, int]:
    value = path.stat()
    return (
        value.st_dev,
        value.st_ino,
        value.st_size,
        value.st_mtime_ns,
        stat.S_IMODE(value.st_mode),
    )


class CorpusIndex:
    """Read-only retrieval over owner messages or explicitly enabled work evidence."""

    def __init__(
        self,
        path: str,
        expected_sha256: str,
        max_excerpt_chars: int = 640,
        include_work: bool = False,
    ):
        self.include_work = include_work
        self.path = Path(path).expanduser()
        self.expected_sha256 = expected_sha256.casefold()
        self.max_excerpt_chars = max_excerpt_chars
        self._verify_file()
        with self.connect() as db:
            metadata = {
                row["key"]: json.loads(row["value"])
                for row in db.execute("SELECT key,value FROM metadata")
            }
            fts = db.execute(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name='document_fts'"
            ).fetchone()
        sql = fts["sql"] if fts else None
        if sql is None:
            self.fts_ranking = "unknown"
        elif re.search(r"\bcontent\s*=\s*(['\"])\1", sql, re.IGNORECASE) and re.search(
            r"\bdetail\s*=\s*['\"]?(column|none)\b", sql, re.IGNORECASE
        ):
            self.fts_ranking = "legacy_unranked"
        else:
            self.fts_ranking = "ranked"
        required = {
            "schema": INDEX_SCHEMA,
            "trust": UNTRUSTED,
            "read_only_intent": True,
            "promotion_side_effects": False,
        }
        if any(metadata.get(key) != value for key, value in required.items()):
            raise ValueError("Corpus index trust contract is invalid")
        allowed_scopes = (
            {"owner_messages_only", "all_events"} if include_work else {"owner_messages_only"}
        )
        if metadata.get("document_scope") not in allowed_scopes:
            raise ValueError("Corpus index document scope is invalid")
        self.metadata = metadata

    def _verify_file(self) -> None:
        if self.path.is_symlink() or not self.path.is_file():
            raise ValueError("Corpus index must be a regular non-symlink file")
        mode = stat.S_IMODE(self.path.stat().st_mode)
        if mode != 0o600:
            raise ValueError("Corpus index permissions must be exactly 0600")
        if not re.fullmatch(r"[a-f0-9]{64}", self.expected_sha256):
            raise ValueError("Expected corpus SHA-256 is required")
        if _sha256(self.path) != self.expected_sha256:
            raise ValueError("Corpus index SHA-256 does not match configuration")

    @contextmanager
    def connect(self):
        uri = self.path.resolve().as_uri() + "?mode=ro&immutable=1"
        db = sqlite3.connect(uri, uri=True)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA query_only=ON")
        try:
            yield db
        finally:
            db.close()

    @cached_property
    def owner_documents(self) -> int:
        roles = self.metadata.get("roles")
        if self.metadata["document_scope"] == "all_events" and isinstance(roles, dict):
            return sum(int(roles.get(role, 0)) for role in OWNER_ROLES)
        with self.connect() as db:
            return int(
                db.execute(
                    "SELECT COUNT(*) FROM documents WHERE kind='message' AND role IN (?,?)",
                    OWNER_ROLES,
                ).fetchone()[0]
            )

    def status(self) -> dict:
        counts = self.metadata.get("counts") or {}
        owner_documents = self.owner_documents
        return {
            "configured": True,
            "verified": True,
            "schema": INDEX_SCHEMA,
            "trust": UNTRUSTED,
            "read_only": True,
            "review_only": True,
            "promotion_performed": False,
            "fts_ranking": self.fts_ranking,
            "conversations": int(counts.get("records", 0)),
            "events": int(counts.get("events", 0)),
            "owner_documents": int(owner_documents),
            "document_scope": self.metadata["document_scope"],
            "includes_work": self.include_work,
            "sources": sorted(
                {
                    source
                    for item in self.metadata.get("sources", [])
                    for source in (
                        item.get("embedded_sources")
                        or ([item.get("source")] if item.get("source") else [])
                    )
                    if source != "normalized-jsonl"
                }
            ),
        }

    def search(self, query: str, limit: int = 10) -> list[dict]:
        stop_words = {
            "the",
            "and",
            "with",
            "what",
            "when",
            "where",
            "how",
            "did",
            "does",
            "do",
            "we",
            "our",
            "you",
            "your",
            "from",
            "for",
            "about",
            "in",
            "is",
            "are",
            "an",
            "can",
            "could",
            "me",
            "my",
            "on",
            "to",
            "of",
            "it",
        }
        terms = list(
            dict.fromkeys(
                token.casefold()
                for token in _TOKENS.findall(unicodedata.normalize("NFKC", query))
                if token.casefold() not in stop_words
            )
        )
        if not terms or limit < 1:
            return []
        compiled = " OR ".join('"{}"'.format(term.replace('"', '""')) for term in terms[:32])
        before = _identity(self.path)
        roles = (
            ("user", "human", "assistant", "tool", "agent", "document", "unknown")
            if self.include_work
            else OWNER_ROLES
        )

        def placeholders(values):
            return ",".join("?" for _ in values)

        scope = f"d.role IN ({placeholders(roles)})"
        if not self.include_work:
            scope = "d.kind='message' AND " + scope
        results = []
        seen = set()
        with self.connect() as db:
            cursor = db.execute(
                f"""SELECT d.document_id,d.conversation_id,c.source,d.timestamp,d.role,d.kind,
                          d.excerpt,document_fts.rank AS rank
                     FROM document_fts
                     JOIN documents d ON d.document_id=document_fts.rowid
                     JOIN conversations c ON c.conversation_id=d.conversation_id
                    WHERE document_fts MATCH ?
                      AND {scope}
                    ORDER BY document_fts.rank""",
                (compiled, *roles),
            )
            try:
                for row in cursor:
                    if row["conversation_id"] in seen:
                        continue
                    seen.add(row["conversation_id"])
                    excerpt = _bounded_excerpt(row["excerpt"], terms, self.max_excerpt_chars)
                    results.append(
                        {
                            "evidence_id": f"doc_{row['document_id']}",
                            "conversation_id": row["conversation_id"],
                            "source": row["source"],
                            "timestamp": row["timestamp"],
                            "excerpt": excerpt,
                            "excerpt_sha256": hashlib.sha256(excerpt.encode("utf-8")).hexdigest(),
                            "trust": UNTRUSTED,
                            "author_role": ("owner" if row["role"] in OWNER_ROLES else row["role"]),
                            "kind": row["kind"],
                            "review_only": True,
                            "instruction_authority": "none",
                        }
                    )
                    if len(results) >= limit:
                        break
            finally:
                cursor.close()
        if before != _identity(self.path):
            raise RuntimeError("Read-only corpus search observed an index change")
        return results


@lru_cache(maxsize=4)
def _verified_index(path, expected_sha256, max_excerpt_chars, include_work, identity):
    # Cache the costly digest verification only for this exact file identity.
    return CorpusIndex(path, expected_sha256, max_excerpt_chars, include_work)


def verified_index(path, expected_sha256, max_excerpt_chars=640, include_work=False):
    candidate = Path(path).expanduser()
    if candidate.is_symlink():
        raise ValueError("Corpus index must be a regular non-symlink file")
    return _verified_index(
        str(candidate), expected_sha256, max_excerpt_chars, include_work, _identity(candidate)
    )
