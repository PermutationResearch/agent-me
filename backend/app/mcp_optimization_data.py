"""Build conversation-disjoint GEPA cases from a reviewed, selected-only export."""

from __future__ import annotations

import hashlib
import unicodedata
from collections import Counter, defaultdict, deque

from .trace_pack import validate_pack

MAX_PACK_BYTES = 25 * 1024 * 1024


def _digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def _normalized(value: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", value).casefold().split())


def prepare_pack_dataset(pack: dict, example_limit: int = 18) -> dict:
    """Split conversations before evaluation; historical answers are not gold labels.

    Only selected user/human messages start tasks. Harness/system/developer text
    remains attributed untrusted reference material. A task's context ends at the
    next user message, so unrelated future requests cannot leak into the case.
    Duplicate normalized requests are removed across the entire selection before
    assigning conversations to train, validation, and a frozen held-out test.
    """
    if type(example_limit) is not int or not 6 <= example_limit <= 60:
        raise ValueError("Choose between 6 and 60 examples.")
    pack = validate_pack(pack, MAX_PACK_BYTES, allow_personal=True)
    conversations = defaultdict(list)
    for event in pack["events"]:
        conversations[(event["source"], event["conversation_id"])].append(event)

    seen, duplicates, grouped = set(), 0, {}
    # Stable sampling follows content identity, not wall-clock export creation.
    for key, events in conversations.items():
        cases = deque()
        starts = [i for i, event in enumerate(events) if event["role"] in ("user", "human")]
        for position, start in enumerate(starts):
            owner = events[start]
            task_id = _digest(_normalized(owner["content"]))
            if task_id in seen:
                duplicates += 1
                continue
            seen.add(task_id)
            end = starts[position + 1] if position + 1 < len(starts) else len(events)
            context, remaining = [], 12000
            for event in events[start:end][:8]:
                excerpt = event["content"][:remaining]
                if not excerpt:
                    continue
                context.append(
                    {
                        "document_id": event["id"],
                        "role": event["role"],
                        "kind": event["kind"],
                        "timestamp": event["timestamp"],
                        "excerpt": excerpt,
                        "excerpt_sha256": _digest(excerpt),
                        "original_content_sha256": event["content_sha256"],
                        "trust": "untrusted_trace",
                        "instruction_authority": "none",
                    }
                )
                remaining -= len(excerpt)
            question = owner["content"][:2000]
            cases.append(
                {
                    "id": task_id,
                    "conversation_id": ":".join(key),
                    "source": key[0],
                    "question": question,
                    "question_origin": "owner",
                    "question_document_id": owner["id"],
                    "question_sha256": _digest(question),
                    "context": context,
                }
            )
        if cases:
            grouped[key] = cases

    # Round-robin so one long conversation cannot crowd out independent groups.
    grouped = dict(sorted(grouped.items(), key=lambda row: _digest(":".join(row[0]))))
    selected = defaultdict(list)
    count = 0
    while grouped and count < example_limit:
        for key in list(grouped):
            selected[key].append(grouped[key].popleft())
            count += 1
            if not grouped[key]:
                del grouped[key]
            if count == example_limit:
                break
    if count < 6 or len(selected) < 3:
        raise ValueError(
            "Select at least 6 distinct user tasks across at least 3 conversations. "
            "Include their assistant/tool replies for useful reference evidence."
        )
    keys = list(selected)
    held_out = max(1, len(keys) // 5)
    training_end = len(keys) - 2 * held_out
    groups = {
        "train": keys[:training_end],
        "validation": keys[training_end:-held_out],
        "test": keys[-held_out:],
    }
    splits = {
        name: [case for key in group for case in selected[key]] for name, group in groups.items()
    }
    return {
        "id": _digest(pack["integrity"]["sha256"] + f":{example_limit}"),
        "pack_sha256": pack["integrity"]["sha256"],
        "source_counts": dict(
            Counter(case["source"] for cases in splits.values() for case in cases)
        ),
        "total_examples": count,
        "conversation_count": len(selected),
        "excluded_duplicate_tasks": duplicates,
        "split_conversations": {name: len(group) for name, group in groups.items()},
        "splits": splits,
        "trust": "untrusted_trace",
        "instruction_authority": "none",
        "historical_answers_are_verified": False,
    }
