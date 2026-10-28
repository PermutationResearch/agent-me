import importlib
import importlib.util
import json

import pytest


def engine():
    assert importlib.util.find_spec("app.optimization_engine"), "GEPA engine is not connected"
    return importlib.import_module("app.optimization_engine")


class DeterministicModel:
    def __init__(self):
        self.reflections = []

    def __call__(self, prompt, *, json_output=False):
        if prompt.startswith("TASK_RESPONSE\n"):
            payload = json.loads(prompt.split("\n", 1)[1])
            return (
                "grounded response"
                if "Cite evidence" in payload["artifact"]
                else "unsupported response"
            )
        if prompt.startswith("JUDGE_RESPONSE\n"):
            payload = json.loads(prompt.split("\n", 1)[1])
            good = payload["answer"] == "grounded response"
            return json.dumps(
                {"score": 0.9 if good else 0.2, "feedback": "Cite evidence to ground the response."}
            )
        self.reflections.append(prompt)
        return "```\nCite evidence and state uncertainty.\n```"


def dataset():
    def case(key):
        return {
            "id": key,
            "question": key,
            "context": [{"excerpt": "historical evidence", "role": "assistant"}],
        }

    return {
        "splits": {
            "train": [case("training-one"), case("training-two"), case("training-three")],
            "validation": [case("validation-one")],
            "test": [case("HELDOUT-MARKER")],
        }
    }


@pytest.mark.skipif(importlib.util.find_spec("gepa") is None, reason="GEPA extra is not installed")
def test_real_gepa_improves_candidate_without_reflecting_on_heldout_cases():
    model = DeterministicModel()
    result = engine().execute(
        seed="Be helpful.",
        objective="Ground answers.",
        dataset=dataset(),
        max_metric_calls=10,
        model=model,
    )
    assert result["best_artifact"] == "Cite evidence and state uncertainty."
    assert result["baseline_test_score"] == 0.2
    assert result["candidate_test_score"] == 0.9
    assert result["improved"] is True
    assert result["scoring"] == "model_judge"
    assert model.reflections
    assert all("HELDOUT-MARKER" not in prompt for prompt in model.reflections)
    assert result["model_calls"] > result["metric_calls"] > 0


@pytest.mark.parametrize(
    "payload",
    ["{}", '{"score": 2, "feedback": "x"}', '{"score": NaN, "feedback": "x"}', "not json"],
)
def test_invalid_judgments_fail_instead_of_inventing_success(payload):
    module = engine()
    with pytest.raises(ValueError, match="judge"):
        module.parse_judgment(payload)


@pytest.mark.skipif(importlib.util.find_spec("gepa") is None, reason="GEPA extra is not installed")
def test_search_stays_within_metric_budget_across_full_validation_batches():
    data = dataset()
    data["splits"]["validation"] = [
        dict(data["splits"]["validation"][0], id=f"val-{n}") for n in range(4)
    ]
    result = engine().execute(
        seed="Be helpful.",
        objective="Ground answers.",
        dataset=data,
        max_metric_calls=16,
        model=DeterministicModel(),
    )
    assert result["metric_calls"] <= 16


@pytest.mark.skipif(importlib.util.find_spec("gepa") is None, reason="GEPA extra is not installed")
def test_budget_must_cover_baseline_and_one_complete_search_proposal():
    data = dataset()
    data["splits"]["validation"] = [
        dict(data["splits"]["validation"][0], id=f"val-{n}") for n in range(12)
    ]
    with pytest.raises(ValueError, match="at least 30"):
        engine().execute(
            seed="Be helpful.",
            objective="Ground answers.",
            dataset=data,
            max_metric_calls=8,
            model=DeterministicModel(),
        )


@pytest.mark.skipif(importlib.util.find_spec("gepa") is None, reason="GEPA extra is not installed")
def test_original_retention_has_no_copied_candidate_score():
    class WorseRewrite:
        def __call__(self, prompt, *, json_output=False):
            if prompt.startswith("TASK_RESPONSE\n"):
                return json.loads(prompt.split("\n", 1)[1])["artifact"]
            if prompt.startswith("JUDGE_RESPONSE\n"):
                good = json.loads(prompt.split("\n", 1)[1])["answer"] == "Strong original."
                return json.dumps({"score": 0.8 if good else 0.2, "feedback": "Keep grounding."})
            return "```\nWorse rewrite.\n```"

    result = engine().execute(
        seed="Strong original.",
        objective="Ground answers.",
        dataset=dataset(),
        max_metric_calls=10,
        model=WorseRewrite(),
    )
    assert result["comparison_status"] == "original_retained"
    assert result["baseline_test_score"] == 0.8
    assert result["candidate_test_score"] is None
    assert result["improved"] is False
    assert result["search_summary"]["proposals_generated"] == 1
    assert result["search_summary"]["rejected"] == 1
    assert result["search_audit"]["held_out"]["candidate"] == []
    assert "Original retained" in result["recommendation"]


@pytest.mark.skipif(importlib.util.find_spec("gepa") is None, reason="GEPA extra is not installed")
def test_validation_uses_its_own_example_after_training_rewrite():
    class SplitSpecific:
        def __init__(self):
            self.judged = []

        def __call__(self, prompt, *, json_output=False):
            if prompt.startswith("TASK_RESPONSE\n"):
                payload = json.loads(prompt.split("\n", 1)[1])
                return json.dumps(
                    {"artifact": payload["artifact"], "question": payload["question"]}
                )
            if prompt.startswith("JUDGE_RESPONSE\n"):
                answer = json.loads(json.loads(prompt.split("\n", 1)[1])["answer"])
                self.judged.append(answer)
                rewritten = answer["artifact"] == "Rewritten."
                training = answer["question"].startswith("training-")
                score = (0.9 if rewritten else 0.2) if training else (0.1 if rewritten else 0.8)
                return json.dumps({"score": score, "feedback": "Respect task-specific evidence."})
            return "```\nRewritten.\n```"

    model = SplitSpecific()
    result = engine().execute(
        seed="Original.",
        objective="Ground answers.",
        dataset=dataset(),
        max_metric_calls=10,
        model=model,
    )
    assert any(
        row == {"artifact": "Rewritten.", "question": "validation-one"} for row in model.judged
    ), "Validation must evaluate its own task, not cached training"
    assert result["best_artifact"] == "Original."
    assert result["comparison_status"] == "original_retained"
    assert result["search_summary"]["cache_enabled"] is False
