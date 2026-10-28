"""Private SQLite intake. Trace content is data and is never executed or promoted."""

from __future__ import annotations

import hashlib
import json
import secrets
import sqlite3
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path

from .trace_pack import canonical

STATUSES = (
    "submitted",
    "under_review",
    "offered",
    "accepted_pending_agreement",
    "declined",
    "withdrawn",
)


class MarketError(Exception):
    def __init__(self, status: int, detail: str):
        self.status = status
        self.detail = detail
        super().__init__(detail)


def now() -> str:
    return datetime.now(UTC).isoformat()


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class SubmissionStore:
    def __init__(self, directory: str, quota: int):
        self.path = Path(directory) / "submissions.sqlite3"
        self.quota = quota

    @contextmanager
    def transaction(self):
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        db = sqlite3.connect(self.path, timeout=15)
        self.path.chmod(0o600)
        db.row_factory = sqlite3.Row
        try:
            db.execute("PRAGMA secure_delete=ON")
            db.execute("""CREATE TABLE IF NOT EXISTS submissions (
                id TEXT PRIMARY KEY, receipt_hash TEXT NOT NULL UNIQUE,
                payload_hash TEXT NOT NULL, summary_json TEXT NOT NULL,
                pack_json TEXT, pack_bytes INTEGER NOT NULL,
                offers_json TEXT NOT NULL, notes_json TEXT NOT NULL,
                contributor_note TEXT NOT NULL)""")
            db.commit()
            db.execute("BEGIN IMMEDIATE")
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    @staticmethod
    def _row(db, sid: str):
        row = db.execute("SELECT * FROM submissions WHERE id=?", (sid,)).fetchone()
        if row is None:
            raise MarketError(404, "Submission not found.")
        return row

    @staticmethod
    def _receipt(row, receipt: str | None):
        if receipt is not None and not secrets.compare_digest(
            row["receipt_hash"], token_hash(receipt)
        ):
            raise MarketError(401, "A valid private receipt code is required.")

    @staticmethod
    def _detail(row, buyer=False):
        result = json.loads(row["summary_json"])
        result["offers"] = json.loads(row["offers_json"])
        result["contributor_note"] = row["contributor_note"]
        if buyer:
            result["review_notes"] = json.loads(row["notes_json"])
        return result

    @staticmethod
    def _save(db, row, detail, notes=None):
        summary = {
            k: v
            for k, v in detail.items()
            if k not in {"offers", "review_notes", "contributor_note"}
        }
        db.execute(
            "UPDATE submissions SET summary_json=?,offers_json=?,notes_json=? WHERE id=?",
            (
                json.dumps(summary),
                json.dumps(detail["offers"]),
                json.dumps(notes if notes is not None else json.loads(row["notes_json"])),
                row["id"],
            ),
        )

    def submit(self, pack, title, alias, receipt):
        payload = {
            "pack": pack,
            "title": title,
            "contributor_alias": alias,
            "confirm_submission": True,
        }
        digest = hashlib.sha256(canonical(payload).encode()).hexdigest()
        encoded = json.dumps(pack, ensure_ascii=False, separators=(",", ":"))
        byte_count = len(encoded.encode())
        with self.transaction() as db:
            old = db.execute(
                "SELECT * FROM submissions WHERE receipt_hash=?", (token_hash(receipt),)
            ).fetchone()
            if old:
                if old["payload_hash"] != digest:
                    raise MarketError(
                        409, "This receipt code already belongs to a different submission."
                    )
                return self._detail(old), False
            used = db.execute("SELECT COALESCE(SUM(pack_bytes),0) FROM submissions").fetchone()[0]
            if used + byte_count > self.quota:
                raise MarketError(503, "Submission storage is full. Please try again later.")
            sid = "sub_" + secrets.token_urlsafe(18)
            created = now()
            detail = {
                "id": sid,
                "title": title,
                "contributor_alias": alias,
                "status": "submitted",
                "created_at": created,
                "updated_at": created,
                "pack_sha256": pack["integrity"]["sha256"],
                "event_count": pack["selection"]["events"],
                "conversation_count": pack["selection"]["conversations"],
                "sources": pack["selection"]["sources"],
                "requested_uses": pack["offer"]["requested_uses"],
                "current_offer": None,
                "payment_status": "not_started",
            }
            db.execute(
                "INSERT INTO submissions VALUES(?,?,?,?,?,?,?,?,?)",
                (
                    sid,
                    token_hash(receipt),
                    digest,
                    json.dumps(detail),
                    encoded,
                    byte_count,
                    "[]",
                    "[]",
                    pack["offer"]["note"],
                ),
            )
            return self._detail(self._row(db, sid)), True

    def detail(self, sid, receipt=None, *, buyer=False):
        with self.transaction() as db:
            try:
                row = self._row(db, sid)
            except MarketError:
                if receipt is not None:
                    raise MarketError(
                        401, "A valid submission ID and receipt code are required."
                    ) from None
                raise
            self._receipt(row, receipt)
            return self._detail(row, buyer)

    def pack(self, sid, receipt=None):
        with self.transaction() as db:
            row = self._row(db, sid)
            self._receipt(row, receipt)
            if row["pack_json"] is None:
                raise MarketError(410, "This pack was withdrawn and its content removed.")
            return json.loads(row["pack_json"])

    def listing(self, status, offset, limit):
        with self.transaction() as db:
            summaries = [
                json.loads(row[0])
                for row in db.execute("SELECT summary_json FROM submissions ORDER BY rowid DESC")
            ]
        counts = {value: sum(item["status"] == value for item in summaries) for value in STATUSES}
        filtered = [item for item in summaries if not status or item["status"] == status]
        return {
            "submissions": filtered[offset : offset + limit],
            "total": len(filtered),
            "counts": counts,
        }

    def review(self, sid, status, note):
        with self.transaction() as db:
            row = self._row(db, sid)
            detail = self._detail(row, buyer=True)
            if detail["status"] not in {"submitted", "under_review"}:
                raise MarketError(409, "This submission cannot be reviewed in its current state.")
            detail["status"], detail["updated_at"] = status, now()
            notes = detail["review_notes"]
            if note.strip():
                notes.append(
                    {"id": "note_" + secrets.token_urlsafe(12), "note": note, "created_at": now()}
                )
            self._save(db, row, detail, notes)
            return self._detail(self._row(db, sid), buyer=True)

    def offer(self, sid, proposal):
        with self.transaction() as db:
            row = self._row(db, sid)
            detail = self._detail(row, buyer=True)
            if detail["status"] not in {"submitted", "under_review", "offered"}:
                raise MarketError(
                    409, "This submission cannot receive an offer in its current state."
                )
            if not set(proposal["proposed_uses"]).issubset(detail["requested_uses"]):
                raise MarketError(
                    422, "Proposed uses must stay within the contributor's selected uses."
                )
            for offer in detail["offers"]:
                if offer["status"] == "open":
                    offer["status"] = "superseded"
            offer = {
                **proposal,
                "id": "offer_" + secrets.token_urlsafe(18),
                "status": "open",
                "created_at": now(),
            }
            detail["offers"].append(offer)
            detail["current_offer"] = offer
            detail["status"], detail["updated_at"] = "offered", now()
            self._save(db, row, detail)
            return self._detail(self._row(db, sid), buyer=True)

    def respond(self, sid, receipt, offer_id, decision):
        with self.transaction() as db:
            row = self._row(db, sid)
            self._receipt(row, receipt)
            detail = self._detail(row)
            current = detail["current_offer"]
            if (
                detail["status"] != "offered"
                or not current
                or current["id"] != offer_id
                or current["status"] != "open"
            ):
                raise MarketError(409, "This offer is no longer open. Refresh your submission.")
            state = "accepted" if decision == "accept" else "declined"
            for offer in detail["offers"]:
                if offer["id"] == offer_id:
                    offer["status"] = state
                    detail["current_offer"] = offer
            detail["status"] = "accepted_pending_agreement" if decision == "accept" else "declined"
            detail["updated_at"] = now()
            self._save(db, row, detail)
            return self._detail(self._row(db, sid))

    def withdraw(self, sid, receipt):
        with self.transaction() as db:
            row = self._row(db, sid)
            self._receipt(row, receipt)
            detail = self._detail(row)
            for offer in detail["offers"]:
                if offer["status"] in {"open", "accepted"}:
                    offer["status"] = "declined"
            if detail["offers"]:
                detail["current_offer"] = detail["offers"][-1]
            detail["status"], detail["updated_at"] = "withdrawn", now()
            self._save(db, row, detail)
            db.execute("UPDATE submissions SET pack_json=NULL,pack_bytes=0 WHERE id=?", (sid,))
            return self._detail(self._row(db, sid))
