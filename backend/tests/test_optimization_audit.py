import json

import pytest
from gepa.optimize_anything import (
    EngineConfig,
    GEPAConfig,
    ReflectionConfig,
    TrackingConfig,
    optimize_anything,
)

from app.optimization_audit import SearchAudit


class QuietLogger:
    def log(self, message):
        pass


def run_search(seed_score, proposal_score, proposals=1, *, cache=False):
    train = [{"id": f"train-{index}"} for index in range(3)]
    validation = [{"id": "validation-one"}]
    actual_evaluations = []
    audit = SearchAudit(
        "original",
        {row["id"] for row in train},
        {"validation-one"},
        validation_order=["validation-one"],
    )

    def evaluator(candidate, example):
        actual_evaluations.append((candidate["artifact"], example["id"]))
        score = seed_score if candidate["artifact"] == "original" else proposal_score
        return score, {"Feedback": f"feedback for {example['id']}"}

    result = optimize_anything(
        seed_candidate={"artifact": "original"},
        evaluator=evaluator,
        dataset=train,
        valset=validation,
        objective="Improve the instruction.",
        config=GEPAConfig(
            engine=EngineConfig(
                max_metric_calls=30,
                max_candidate_proposals=proposals,
                parallel=False,
                use_cloudpickle=False,
                cache_evaluation=cache,
                cache_evaluation_storage="memory" if cache else "auto",
                capture_stdio=False,
                display_progress_bar=False,
                seed=42,
            ),
            reflection=ReflectionConfig(
                reflection_lm=lambda prompt: "```\nrewritten instruction\n```",
                reflection_minibatch_size=3,
            ),
            tracking=TrackingConfig(logger=QuietLogger()),
            callbacks=[audit],
        ),
    )
    return result, audit.report(), actual_evaluations


def test_rejected_rewrite_is_preserved_with_case_feedback_and_mean_scores():
    result, report, _ = run_search(0.75, 0.25)
    assert result.candidates == [{"artifact": "original"}]
    assert report["proposal_attempts"] == report["proposals_generated"] == 1
    assert report["rejected"] == 1
    assert report["accepted"] == 0
    (proposal,) = report["proposals"]
    assert proposal["artifact"] == "rewritten instruction"
    assert proposal["distinct_from_seed"] is True
    assert len(proposal["artifact_sha256"]) == 64
    assert proposal["decision"] == "rejected"
    assert proposal["reason"]
    assert proposal["parent_train_sum"] == 2.25
    assert proposal["parent_train_mean"] == 0.75
    assert proposal["proposal_train_sum"] == 0.75
    assert proposal["proposal_train_mean"] == 0.25
    assert {row["case_id"] for row in proposal["evaluations"]} == {
        "train-0",
        "train-1",
        "train-2",
    }
    assert all(
        row["feedback"] == f"feedback for {row['case_id']}" for row in proposal["evaluations"]
    )
    assert {row["role"] for row in proposal["evaluations"]} == {"parent", "proposal"}
    assert all(row["split"] == "train" for row in proposal["evaluations"])
    json.dumps(report, allow_nan=False)


def test_accepted_rewrite_keeps_validation_scores_separate_from_training():
    result, report, actual_evaluations = run_search(0.25, 0.75)
    assert result.best_candidate == {"artifact": "rewritten instruction"}
    assert ("rewritten instruction", "validation-one") in actual_evaluations
    assert report["accepted"] == 1
    (proposal,) = report["proposals"]
    validation = [row for row in proposal["evaluations"] if row["split"] == "validation"]
    assert validation == [
        {
            "role": "validation",
            "split": "validation",
            "case_id": "validation-one",
            "score": 0.75,
            "feedback": "feedback for validation-one",
        }
    ]
    assert proposal["proposal_train_mean"] == 0.75
    assert report["seed_validation"][0]["score"] == 0.25


def test_callback_counts_include_cache_hits_and_are_not_actual_evaluator_calls():
    _, report, actual_evaluations = run_search(0.75, 0.25, proposals=2, cache=True)
    assert report["proposals_generated"] == 2
    assert report["rejected"] == 2
    callback_scores = report["callback_evaluation_scores"] + report["callback_validation_scores"]
    assert callback_scores == 13
    assert len(actual_evaluations) == 7
    assert callback_scores > len(actual_evaluations)
    assert report["gepa_metric_calls"] == 13


@pytest.mark.parametrize("value", [None, {}, {"artifact": None}])
def test_missing_proposal_artifact_is_not_counted_as_generated(value):
    audit = SearchAudit("original", set(), set())
    audit.on_proposal_start({"iteration": 1})
    audit.on_proposal_end({"iteration": 1, "new_instructions": value})
    assert audit.report()["proposal_attempts"] == 1
    assert audit.report()["proposals_generated"] == 0
