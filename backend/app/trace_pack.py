"""Validate the portable selected-only browser export without changing its bytes/fields."""

from __future__ import annotations

import hashlib
import json
import re
from collections import Counter
from typing import Any

USES = {"stack_optimization", "evaluation", "small_model_training"}
ROLES = {
    "user",
    "human",
    "assistant",
    "tool",
    "agent",
    "harness",
    "system",
    "developer",
    "document",
    "unknown",
}
HASH = re.compile(r"[a-f0-9]{64}\Z")
MAX_EVENTS = 50_000


class InvalidPack(ValueError):
    pass


class PackTooLarge(ValueError):
    pass


def require(condition: bool, message: str = "Invalid trace pack fields.") -> None:
    if not condition:
        raise InvalidPack(message)


def obj(value: Any, fields: set[str] | None = None) -> dict:
    require(type(value) is dict)
    if fields is not None:
        require(set(value) == fields)
    return value


def text(value: Any, maximum: int = 200, *, empty: bool = False) -> bool:
    return type(value) is str and len(value) <= maximum and (empty or bool(value.strip()))


def count(value: Any, minimum: int = 0) -> bool:
    return type(value) is int and minimum <= value <= 9_007_199_254_740_991


def canonical(value: Any) -> str:
    # JS sorts UTF-16 code units; all normal schema keys are ASCII, but source keys can be Unicode.
    if isinstance(value, dict):
        keys = sorted(value, key=lambda key: key.encode("utf-16-be", errors="surrogatepass"))
        return "{" + ",".join(canonical(key) + ":" + canonical(value[key]) for key in keys) + "}"
    if isinstance(value, list):
        return "[" + ",".join(canonical(item) for item in value) + "]"
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def validate_pack(value: Any, maximum: int, *, allow_personal: bool = False) -> dict:
    """Validate integrity; local optimization may explicitly permit personal exports.

    Submission callers remain sale-only by default. Hashes detect changes, never
    authorship or whether redaction is sufficient.
    """
    try:
        return _validate(value, maximum, allow_personal=allow_personal)
    except (TypeError, UnicodeError, OverflowError, RecursionError) as exc:
        raise InvalidPack("Invalid trace pack encoding.") from exc


def _validate(value: Any, maximum: int, *, allow_personal: bool = False) -> dict:
    pack = obj(
        value,
        {
            "schema",
            "id",
            "created_at",
            "intent",
            "offer",
            "selection",
            "privacy",
            "files",
            "events",
            "integrity",
        },
    )
    require(pack["schema"] == "agent-me.trace-pack.v1", "Unsupported trace pack version.")
    require(text(pack["id"], 100) and text(pack["created_at"], 100))
    require(
        pack["intent"] == "sale_offer" or (allow_personal and pack["intent"] == "personal_export"),
        "Prepare a sale-offer pack before submitting.",
    )
    privacy = obj(
        pack["privacy"], {"automatic_redaction", "manual_review_confirmed", "attachments_included"}
    )
    require(
        privacy["automatic_redaction"] is True
        and privacy["manual_review_confirmed"] is True
        and privacy["attachments_included"] is False
    )
    if pack["intent"] == "personal_export":
        require(pack["offer"] is None, "Personal exports cannot contain a sale offer.")
    else:
        offer = obj(pack["offer"], {"recipient", "status", "submitted", "requested_uses", "note"})
        require(
            offer["recipient"] == "Agent-Me"
            and offer["status"] == "draft"
            and offer["submitted"] is False
        )
        uses = offer["requested_uses"]
        require(type(uses) is list and 1 <= len(uses) <= 3)
        require(all(type(use) is str and use in USES for use in uses))
        require(len(set(uses)) == len(uses) and text(offer["note"], 1000, empty=True))
    files = pack["files"]
    require(type(files) is list and 1 <= len(files) <= MAX_EVENTS)
    expected_files = {}
    for value in files:
        file = obj(value, {"sha256", "format", "selected_events"})
        require(type(file["sha256"]) is str and HASH.fullmatch(file["sha256"]) is not None)
        require(file["sha256"] not in expected_files and text(file["format"]))
        require(count(file["selected_events"], 1))
        expected_files[file["sha256"]] = file["selected_events"]
    events = pack["events"]
    require(type(events) is list and 1 <= len(events) <= MAX_EVENTS)
    ids, conversations = set(), set()
    observed_files, sources = Counter(), Counter()
    for value in events:
        event = obj(
            value,
            {
                "id",
                "source",
                "conversation_id",
                "kind",
                "role",
                "timestamp",
                "tool_name",
                "content",
                "origin",
                "content_sha256",
                "edited",
                "trust",
                "instruction_authority",
            },
        )
        require(all(text(event[field]) for field in ("id", "source", "conversation_id", "kind")))
        require(event["id"] not in ids)
        ids.add(event["id"])
        require(type(event["role"]) is str and event["role"] in ROLES)
        require(event["timestamp"] is None or text(event["timestamp"]))
        require(event["tool_name"] is None or text(event["tool_name"]))
        require(text(event["content"], 2_000_000))
        require(
            type(event["edited"]) is bool
            and event["trust"] == "untrusted_trace"
            and event["instruction_authority"] == "none"
        )
        require(
            type(event["content_sha256"]) is str
            and HASH.fullmatch(event["content_sha256"]) is not None
        )
        require(
            hashlib.sha256(event["content"].encode()).hexdigest() == event["content_sha256"],
            "Trace content hash integrity check failed.",
        )
        origin = obj(event["origin"], {"file_sha256", "line", "item"})
        require(type(origin["file_sha256"]) is str and origin["file_sha256"] in expected_files)
        require(count(origin["line"], 1) and count(origin["item"]))
        observed_files[origin["file_sha256"]] += 1
        sources[event["source"]] += 1
        conversations.add(event["source"] + ":" + event["conversation_id"])
    require(
        dict(observed_files) == expected_files, "Trace file counts do not match selected events."
    )
    selection = obj(pack["selection"], {"events", "conversations", "sources"})
    require(count(selection["events"], 1) and selection["events"] == len(events))
    require(
        count(selection["conversations"], 1) and selection["conversations"] == len(conversations)
    )
    source_counts = obj(selection["sources"])
    require(all(count(n, 1) for n in source_counts.values()) and source_counts == dict(sources))
    integrity = obj(pack["integrity"], {"algorithm", "sha256"})
    require(
        integrity["algorithm"] == "sha256"
        and type(integrity["sha256"]) is str
        and HASH.fullmatch(integrity["sha256"]) is not None
    )
    body = {key: value for key, value in pack.items() if key != "integrity"}
    require(
        hashlib.sha256(canonical(body).encode()).hexdigest() == integrity["sha256"],
        "Trace pack hash integrity check failed.",
    )
    # Match browser export size, including human-readable indentation.
    if len(json.dumps(pack, ensure_ascii=False, indent=2).encode()) > maximum:
        raise PackTooLarge("Trace pack exceeds the configured size limit.")
    return pack
