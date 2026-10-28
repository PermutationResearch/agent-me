"""Private, JSON-safe search evidence collected through GEPA's public callbacks."""

from __future__ import annotations

import copy
import hashlib
import math
from collections import defaultdict, deque


def _number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value) if math.isfinite(value) else None


def _feedback(value):
    if isinstance(value, dict):
        text = value.get("Feedback", value.get("feedback"))
        return text if isinstance(text, str) else None
    if isinstance(value, (list, tuple)):
        for item in reversed(value):
            text = _feedback(item)
            if text is not None:
                return text
    return None


class SearchAudit:
    """Retain generated rewrites even when GEPA excludes them from its candidate pool.

    Callback evaluation counts include cache hits. They are deliberately not labeled
    model calls or actual evaluator calls. Reflection prompts are never retained.
    """

    def __init__(self, seed, train_ids, validation_ids, *, validation_order=None):
        self.seed = seed
        self.train_ids = set(train_ids)
        self.validation_ids = set(validation_ids)
        self.validation_order = list(validation_order or [])
        self._iterations = {}
        self._starts = defaultdict(deque)
        self._attempts = 0
        self._skips = []
        self._evaluation_batches = 0
        self._evaluation_scores = 0
        self._validation_scores = 0
        self._seed_validation = []
        self._gepa_metric_calls = None

    def _row(self, iteration):
        if iteration not in self._iterations:
            self._iterations[iteration] = {
                "iteration": iteration,
                "artifact": None,
                "artifact_sha256": None,
                "distinct_from_seed": False,
                "decision": "pending",
                "reason": None,
                "parent_train_sum": None,
                "proposal_train_sum": None,
                "parent_train_mean": None,
                "proposal_train_mean": None,
                "evaluations": [],
            }
        return self._iterations[iteration]

    def on_proposal_start(self, event):
        self._attempts += 1
        self._row(event.get("iteration"))

    def on_proposal_end(self, event):
        row = self._row(event.get("iteration"))
        instructions = event.get("new_instructions")
        artifact = instructions.get("artifact") if isinstance(instructions, dict) else None
        if isinstance(artifact, str):
            row["artifact"] = artifact
            row["artifact_sha256"] = hashlib.sha256(artifact.encode()).hexdigest()
            row["distinct_from_seed"] = artifact != self.seed

    def on_evaluation_start(self, event):
        key = (event.get("iteration"), event.get("candidate_idx"))
        inputs = event.get("inputs") or []
        # Copy IDs only: the example's private question/context belongs in its source dataset.
        ids = [
            str(item.get("id", "unknown")) if isinstance(item, dict) else "unknown"
            for item in inputs
        ]
        self._starts[key].append(ids)

    def on_evaluation_end(self, event):
        iteration = event.get("iteration")
        key = (iteration, event.get("candidate_idx"))
        ids = self._starts[key].popleft() if self._starts[key] else []
        scores = event.get("scores") or []
        trajectories = event.get("trajectories") or []
        outputs = event.get("outputs") or []
        self._evaluation_batches += 1
        self._evaluation_scores += len(scores)
        row = self._row(iteration)
        role = "proposal" if event.get("candidate_idx") is None else "parent"
        valid_scores = []
        for index, value in enumerate(scores):
            score = _number(value)
            if score is None:
                continue
            case_id = ids[index] if index < len(ids) else "unknown"
            split = (
                "train"
                if case_id in self.train_ids
                else "validation"
                if case_id in self.validation_ids
                else "unknown"
            )
            source = trajectories[index] if index < len(trajectories) else None
            feedback = _feedback(source)
            if feedback is None and index < len(outputs):
                feedback = _feedback(outputs[index])
            row["evaluations"].append(
                {
                    "role": role,
                    "split": split,
                    "case_id": case_id,
                    "score": score,
                    "feedback": feedback,
                }
            )
            if split == "train":
                valid_scores.append(score)
        if valid_scores:
            row[f"{role}_train_sum"] = sum(valid_scores)
            row[f"{role}_train_mean"] = sum(valid_scores) / len(valid_scores)

    def on_candidate_rejected(self, event):
        row = self._row(event.get("iteration"))
        row["decision"] = "rejected"
        reason = event.get("reason")
        row["reason"] = reason if isinstance(reason, str) else None
        # GEPA reports minibatch SUMS here; retain independently of per-case means.
        row["parent_train_sum"] = _number(event.get("old_score"))
        row["proposal_train_sum"] = _number(event.get("new_score"))

    def on_candidate_accepted(self, event):
        row = self._row(event.get("iteration"))
        row["decision"] = "accepted"
        row["candidate_idx"] = event.get("new_candidate_idx")
        row["proposal_train_sum"] = _number(event.get("new_score"))

    def on_valset_evaluated(self, event):
        records = []
        scores = event.get("scores_by_val_id") or {}
        outputs = event.get("outputs_by_val_id") or {}
        for key, value in scores.items():
            score = _number(value)
            if score is None:
                continue
            if str(key) in self.validation_ids:
                case_id = str(key)
            elif isinstance(key, int) and 0 <= key < len(self.validation_order):
                case_id = self.validation_order[key]
            else:
                case_id = f"validation-index:{key}"
            records.append(
                {
                    "role": "validation",
                    "split": "validation",
                    "case_id": case_id,
                    "score": score,
                    "feedback": _feedback(outputs.get(key)),
                }
            )
        self._validation_scores += len(records)
        if event.get("candidate_idx") == 0:
            self._seed_validation = records
        else:
            self._row(event.get("iteration"))["evaluations"].extend(records)

    def on_evaluation_skipped(self, event):
        reason = event.get("reason")
        row = self._row(event.get("iteration"))
        row["decision"] = "skipped"
        row["reason"] = reason if isinstance(reason, str) else None
        self._skips.append(
            {
                "iteration": event.get("iteration"),
                "reason": reason if isinstance(reason, str) else None,
            }
        )

    def on_optimization_end(self, event):
        self._gepa_metric_calls = event.get("total_metric_calls")

    def report(self):
        rows = list(self._iterations.values())
        return copy.deepcopy(
            {
                "proposal_attempts": self._attempts,
                "proposals_generated": sum(row["artifact"] is not None for row in rows),
                "accepted": sum(row["decision"] == "accepted" for row in rows),
                "rejected": sum(row["decision"] == "rejected" for row in rows),
                "skipped": len(self._skips),
                "proposals": rows,
                "skips": self._skips,
                "seed_validation": self._seed_validation,
                "callback_evaluation_batches": self._evaluation_batches,
                "callback_evaluation_scores": self._evaluation_scores,
                "callback_validation_scores": self._validation_scores,
                "gepa_metric_calls": self._gepa_metric_calls,
            }
        )
