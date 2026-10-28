"""Explicit contributor submission and separate buyer review API."""

from __future__ import annotations

import re
import secrets
import sqlite3
from typing import Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response
from pydantic import BaseModel, ConfigDict, Field, StrictBool, field_validator

from .config import Settings, get_settings
from .trace_market_store import STATUSES, MarketError, SubmissionStore
from .trace_pack import MAX_EVENTS, InvalidPack, PackTooLarge, validate_pack

router = APIRouter(prefix="/api/v1", tags=["Trace market"])
RECEIPT_SCHEMA = "agent-me.submission-receipt.v1"
RECEIPT_PATTERN = re.compile(r"[A-Za-z0-9_-]{43,128}\Z")
Use = Literal["stack_optimization", "evaluation", "small_model_training"]


class StrictRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class SubmissionRequest(StrictRequest):
    pack: dict
    title: str = Field(min_length=1, max_length=120)
    contributor_alias: str = Field(default="", max_length=80)
    confirm_submission: StrictBool

    @field_validator("title")
    @classmethod
    def title_not_blank(cls, value):
        if not value.strip():
            raise ValueError("Enter a title.")
        return value


class ReviewRequest(StrictRequest):
    status: Literal["under_review", "declined"]
    note: str = Field(default="", max_length=4000)


class OfferRequest(StrictRequest):
    amount_minor: int = Field(ge=1, le=1_000_000_000)
    currency: Literal["CAD", "USD", "EUR", "GBP"]
    proposed_uses: list[Use] = Field(min_length=1, max_length=3)
    message: str = Field(default="", max_length=4000)

    @field_validator("proposed_uses")
    @classmethod
    def unique_uses(cls, value):
        if len(set(value)) != len(value):
            raise ValueError("Choose each proposed use once.")
        return value


class ResponseRequest(StrictRequest):
    offer_id: str = Field(min_length=1, max_length=100)
    decision: Literal["accept", "decline"]


class EmptyRequest(StrictRequest):
    pass


def market_enabled(config: Settings) -> bool:
    return config.trace_submissions_enabled and len(config.trace_buyer_token) >= 32


def enabled_config(config: Settings = Depends(get_settings)) -> Settings:
    if not market_enabled(config):
        raise HTTPException(503, "Trace submissions are not currently available.")
    return config


def bearer(authorization: str | None) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "A valid access code is required.")
    return authorization[7:]


def contributor_auth(
    authorization: str | None = Header(default=None),
    config: Settings = Depends(enabled_config),
) -> str:
    code = bearer(authorization)
    if not RECEIPT_PATTERN.fullmatch(code) or secrets.compare_digest(
        code.encode(), config.trace_buyer_token.encode()
    ):
        raise HTTPException(401, "A valid private receipt code is required.")
    return code


def buyer_auth(
    authorization: str | None = Header(default=None),
    config: Settings = Depends(enabled_config),
) -> Settings:
    if not secrets.compare_digest(
        bearer(authorization).encode(), config.trace_buyer_token.encode()
    ):
        raise HTTPException(401, "A valid buyer access key is required.")
    return config


def store(config: Settings) -> SubmissionStore:
    return SubmissionStore(
        config.trace_submission_data_dir, config.trace_submission_storage_limit_bytes
    )


def invoke(action, *args, **kwargs):
    try:
        return action(*args, **kwargs)
    except MarketError as exc:
        raise HTTPException(exc.status, exc.detail) from None
    except (OSError, sqlite3.Error):
        raise HTTPException(503, "Submission storage is temporarily unavailable.") from None


@router.get("/trace-market/status")
def status(config: Settings = Depends(get_settings)):
    enabled = market_enabled(config)
    return {
        "enabled": enabled,
        "max_pack_bytes": config.trace_submission_max_bytes,
        "max_events": MAX_EVENTS,
        "receipt_schema": RECEIPT_SCHEMA,
        "reason": None if enabled else "Trace submissions are not currently available.",
    }


@router.post("/trace-submissions", status_code=201)
def submit(
    payload: SubmissionRequest,
    response: Response,
    receipt: str = Depends(contributor_auth),
    config: Settings = Depends(enabled_config),
):
    if payload.confirm_submission is not True:
        raise HTTPException(422, "Confirm that you want to send this selected pack to Agent-Me.")
    try:
        pack = validate_pack(payload.pack, config.trace_submission_max_bytes)
    except PackTooLarge:
        raise HTTPException(413, "Selected pack exceeds the configured size limit.") from None
    except InvalidPack as exc:
        raise HTTPException(422, str(exc)) from None
    detail, created = invoke(
        store(config).submit, pack, payload.title, payload.contributor_alias, receipt
    )
    response.status_code = 201 if created else 200
    return {"submission": detail, "receipt_schema": RECEIPT_SCHEMA}


@router.get("/trace-submissions/{sid}")
def contributor_detail(
    sid: str,
    receipt: str = Depends(contributor_auth),
    config: Settings = Depends(enabled_config),
):
    return invoke(store(config).detail, sid, receipt)


@router.get("/trace-submissions/{sid}/pack")
def contributor_pack(
    sid: str,
    receipt: str = Depends(contributor_auth),
    config: Settings = Depends(enabled_config),
):
    return invoke(store(config).pack, sid, receipt)


@router.post("/trace-submissions/{sid}/respond")
def respond(
    sid: str,
    payload: ResponseRequest,
    receipt: str = Depends(contributor_auth),
    config: Settings = Depends(enabled_config),
):
    return invoke(store(config).respond, sid, receipt, payload.offer_id, payload.decision)


@router.post("/trace-submissions/{sid}/withdraw")
def withdraw(
    sid: str,
    payload: EmptyRequest,
    receipt: str = Depends(contributor_auth),
    config: Settings = Depends(enabled_config),
):
    return invoke(store(config).withdraw, sid, receipt)


@router.get("/buyer/trace-submissions")
def buyer_listing(
    status: str = "",
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=30, ge=1, le=100),
    config: Settings = Depends(buyer_auth),
):
    if status and status not in STATUSES:
        raise HTTPException(422, "Choose a supported submission status.")
    return invoke(store(config).listing, status, offset, limit)


@router.get("/buyer/trace-submissions/{sid}")
def buyer_detail(sid: str, config: Settings = Depends(buyer_auth)):
    return invoke(store(config).detail, sid, buyer=True)


@router.get("/buyer/trace-submissions/{sid}/events")
def buyer_events(
    sid: str,
    query: str = Query(default="", max_length=500),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=25, ge=1, le=100),
    config: Settings = Depends(buyer_auth),
):
    pack = invoke(store(config).pack, sid)
    needle = query.casefold().strip()
    events = [
        event for event in pack["events"] if not needle or needle in event["content"].casefold()
    ]
    return {
        "events": events[offset : offset + limit],
        "total": len(events),
        "offset": offset,
        "limit": limit,
    }


@router.get("/buyer/trace-submissions/{sid}/pack")
def buyer_pack(sid: str, config: Settings = Depends(buyer_auth)):
    return invoke(store(config).pack, sid)


@router.post("/buyer/trace-submissions/{sid}/review")
def review(sid: str, payload: ReviewRequest, config: Settings = Depends(buyer_auth)):
    return invoke(store(config).review, sid, payload.status, payload.note)


@router.post("/buyer/trace-submissions/{sid}/offers")
def offer(sid: str, payload: OfferRequest, config: Settings = Depends(buyer_auth)):
    return invoke(store(config).offer, sid, payload.model_dump())
