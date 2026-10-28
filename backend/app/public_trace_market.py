"""Process boundary for a hosted trace-intake service, separate from the owner's agent."""

from __future__ import annotations

import sqlite3

from .config import Settings
from .trace_market_store import SubmissionStore


def public_route(path: str) -> bool:
    if path in {"/health", "/ready", "/api/v1/trace-market/status"}:
        return True
    return any(
        path == prefix or path.startswith(prefix + "/")
        for prefix in ("/api/v1/trace-submissions", "/api/v1/buyer/trace-submissions")
    )


def validate_public_config(config: Settings) -> None:
    if (
        config.personal_enabled
        or not config.trace_submissions_enabled
        or len(config.trace_buyer_token) < 32
        or any("*" in origin for origin in config.allowed_origins)
    ):
        raise RuntimeError(
            "Cannot start public trace intake: disable personal mode, enable submissions, "
            "configure a buyer key, and use exact CORS origins."
        )


def verify_public_storage(config: Settings) -> None:
    """Readiness requires writable durable intake storage, without loading owner knowledge."""
    validate_public_config(config)
    try:
        store = SubmissionStore(
            config.trace_submission_data_dir, config.trace_submission_storage_limit_bytes
        )
        with store.transaction() as db:
            db.execute("SELECT 1").fetchone()
    except (OSError, sqlite3.Error) as exc:
        raise RuntimeError(
            "Cannot start public trace intake: submission storage is unavailable."
        ) from exc
