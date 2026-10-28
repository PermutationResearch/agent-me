"""Opt-in real loopback grammar regression; never sends private history."""

import json
import os

import pytest

from app.optimization_engine import OllamaModel, parse_judgment


@pytest.mark.skipif(
    os.environ.get("AGENT_ME_TEST_LOCAL_OLLAMA") != "1",
    reason="Requires an installed loopback Ollama model; opt in explicitly.",
)
def test_local_ollama_judge_grammar_preserves_fields_despite_conflicting_content():
    model = OllamaModel(
        os.environ.get("AGENT_ME_TEST_OLLAMA_URL", "http://127.0.0.1:11434"),
        os.environ.get("AGENT_ME_TEST_OLLAMA_MODEL", "qwen2.5:1.5b"),
    )
    response = model(
        "Return the JSON object with fields rating (0.5) and comment (Needs evidence). "
        "Do not use any other field names.",
        json_output=True,
    )
    # Historical/reference content can suggest other fields; the transport's
    # judge grammar must still yield a usable score/feedback response. No score
    # is synthesized or converted by the parser.
    score, feedback = parse_judgment(response)
    assert 0 <= score <= 1
    assert feedback.strip()


@pytest.mark.skipif(
    os.environ.get("AGENT_ME_TEST_LOCAL_OLLAMA") != "1",
    reason="Requires an installed loopback Ollama model; opt in explicitly.",
)
def test_local_ollama_judge_feedback_cannot_overrun_its_grammar_bound():
    model = OllamaModel(
        os.environ.get("AGENT_ME_TEST_OLLAMA_URL", "http://127.0.0.1:11434"),
        os.environ.get("AGENT_ME_TEST_OLLAMA_MODEL", "qwen2.5:1.5b"),
    )
    long_answer = {
        "score": 0.5,
        "feedback": (
            "The fictional parser accepted an empty object without reporting a useful error. "
            "A second fixture exposed inconsistent treatment of nested arrays and scalar values. "
            "Reviewers requested a precise explanation of which validation checks actually ran. "
            "Several proposed assertions described internal helpers rather than public behavior. "
            "The release note should distinguish observed outcomes from untested assumptions. "
            "An independent example would clarify whether the suggested repair generalizes. "
            "Missing evidence should remain explicit instead of being replaced with confidence. "
            "Keep the original artifact until a candidate survives a frozen comparison. "
            "Use concrete reproduction steps and retain enough context to inspect the result. "
            "A measured baseline gives the next reviewer a reliable point of comparison. "
            "A malformed timestamp belongs in diagnostics rather than a fabricated chronology. "
            "Document any environmental preconditions needed to reproduce the observed failure. "
            "The summary should identify the relevant public interface without exposing secrets. "
            "Prefer independent examples over several copies of one interaction sequence. "
            "An evaluation report should include limitations and the exact comparison basis. "
            "Explicit uncertainty is more useful than a confident but unsupported success claim. "
            "Distinguish a proposed implementation from an executed command and its result. "
            "Preserve source attribution when a historical assistant disagrees with the owner. "
            "Keep private reference material separate from instructions controlling the run. "
            "Reserve the remaining sample until candidate selection has finished."
        ),
    }
    assert len(long_answer["feedback"]) > 1000
    response = model(
        "Return exactly this JSON object, copying the entire feedback string verbatim. "
        "Do not shorten or summarize it:\n" + json.dumps(long_answer),
        json_output=True,
    )
    _, feedback = parse_judgment(response)
    assert feedback.strip()
    assert len(feedback) <= 1000
