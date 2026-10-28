import json

import httpx
import pytest

from app.openrouter_optimization import OpenRouterFreeModel, available, load_openrouter_key

MODEL = "test/structured-model:free"
KEY = "secret-test-credential"


def catalog(**changes):
    return {
        "data": [
            {
                "id": MODEL,
                "pricing": {"prompt": "0", "completion": "0"},
                "supported_parameters": ["response_format", "structured_outputs", "temperature"],
                **changes,
            }
        ]
    }


def completion(**changes):
    return {
        "model": "test/structured-model",
        "provider": "Fixture Provider",
        "choices": [{"message": {"content": "A fictional answer."}, "finish_reason": "stop"}],
        "usage": {
            "cost": 0,
            "prompt_tokens": 5,
            "completion_tokens": 10,
            "total_tokens": 15,
        },
        **changes,
    }


def service(response=None, models=None, status=200):
    requests = []

    def handle(request):
        requests.append(request)
        if request.method == "GET":
            return httpx.Response(200, json=models if models is not None else catalog())
        return httpx.Response(status, json=response if response is not None else completion())

    client = httpx.Client(transport=httpx.MockTransport(handle))
    return OpenRouterFreeModel(MODEL, KEY, client=client), requests, client


def test_free_inference_uses_verified_zero_price_route_and_metadata_only_accounting():
    model, requests, client = service()
    try:
        assert model("PRIVATE-FICTIONAL-TASK") == "A fictional answer."
        assert model("Second task") == "A fictional answer."
        assert [(r.method, r.url.path) for r in requests] == [
            ("GET", "/api/v1/models"),
            ("POST", "/api/v1/chat/completions"),
            ("POST", "/api/v1/chat/completions"),
        ]
        assert all(r.url.host == "openrouter.ai" and r.url.scheme == "https" for r in requests)
        sent = json.loads(requests[1].content)
        assert sent["model"] == MODEL
        assert "models" not in sent and "plugins" not in sent and "tools" not in sent
        assert sent["provider"] == {
            "max_price": {"prompt": 0, "completion": 0, "request": 0},
            "data_collection": "deny",
            "require_parameters": True,
            "allow_fallbacks": True,
        }
        assert requests[1].headers["Authorization"] == "Bearer " + KEY
        report = model.report()
        assert report["resolved_models"] == ["test/structured-model"]
        assert report["providers"] == ["Fixture Provider"]
        assert report["completed_model_calls"] == report["model_calls"] == 2
        assert report["usage"] == {
            "prompt_tokens": 10,
            "completion_tokens": 20,
            "total_tokens": 30,
            "reported_cost": "0",
            "currency": "USD",
        }
        assert "PRIVATE-FICTIONAL-TASK" not in json.dumps(report)
        assert KEY not in json.dumps(report)
    finally:
        client.close()


@pytest.mark.parametrize(
    "model", ["test/paid", "openrouter/auto", "test/free", "https://evil/free"]
)
def test_paid_or_arbitrary_routes_are_rejected_before_model_access(model):
    with pytest.raises(ValueError, match="paid models are disabled"):
        OpenRouterFreeModel(model, KEY)


@pytest.mark.parametrize(
    "changes",
    [
        {"pricing": {"prompt": "0.01", "completion": "0"}},
        {"pricing": {"prompt": "0", "completion": "1"}},
        {"pricing": {"prompt": "NaN", "completion": "0"}},
        {"pricing": {"prompt": "0", "completion": "0", "request": "0.01"}},
        {"pricing": {}},
        {"id": "other/model:free"},
        {"supported_parameters": ["response_format"]},
    ],
)
def test_repricing_or_missing_schema_support_stops_before_private_prompt_is_sent(changes):
    model, requests, client = service(models=catalog(**changes))
    try:
        with pytest.raises(ValueError, match="no prompt was sent"):
            model("PRIVATE-FICTIONAL-TASK")
        assert len(requests) == 1 and requests[0].method == "GET"
        assert model.report()["model_calls"] == 0
    finally:
        client.close()


def test_judge_uses_shared_json_schema_and_preserves_valid_score_text():
    content = json.dumps({"score": 0.8, "feedback": "The answer cites fictional evidence."})
    model, requests, client = service(
        completion(choices=[{"message": {"content": content}, "finish_reason": "stop"}])
    )
    try:
        assert model("Fictional judge", json_output=True) == content
        shape = json.loads(requests[-1].content)["response_format"]
        assert shape["type"] == "json_schema"
        assert shape["json_schema"]["strict"] is True
        schema = shape["json_schema"]["schema"]
        assert schema["required"] == ["score", "feedback"]
        assert schema["additionalProperties"] is False
        assert schema["properties"]["score"]["maximum"] == 1
        assert schema["properties"]["feedback"]["maxLength"] == 1000
    finally:
        client.close()


@pytest.mark.parametrize("cost", [None, "0.01", "NaN", False])
def test_unconfirmed_or_nonzero_cost_stops_without_fallback_or_retry(cost):
    model, requests, client = service(completion(usage={"cost": cost}))
    try:
        with pytest.raises(RuntimeError, match="confirm zero cost"):
            model("Fictional task")
        assert len(requests) == 2
        assert model.report()["model_calls"] == 1
        assert model.report()["completed_model_calls"] == 0
    finally:
        client.close()


@pytest.mark.parametrize(
    "text",
    [
        "not-json",
        '{"score": 2, "feedback": "Bad score"}',
        '{"rating": 0.5, "feedback": "Wrong field"}',
        json.dumps({"score": 0.5, "feedback": "Too long " * 200}),
        '{"score": 0.5, "feedback": "Extra field", "extra": true}',
    ],
)
def test_invalid_judges_are_not_repaired_or_assumed_successful(text):
    model, requests, client = service(
        completion(choices=[{"message": {"content": text}, "finish_reason": "stop"}])
    )
    try:
        with pytest.raises(ValueError):
            model("Fictional judge", json_output=True)
        assert len(requests) == 2
        assert model.report()["completed_model_calls"] == 0
    finally:
        client.close()


@pytest.mark.parametrize("finished", ["length", "content_filter", "tool_calls"])
def test_truncated_refused_or_unrequested_tool_output_is_rejected(finished):
    model, requests, client = service(
        completion(choices=[{"message": {"content": "partial"}, "finish_reason": finished}])
    )
    try:
        with pytest.raises(ValueError, match="truncated or refused"):
            model("Fictional task")
        assert len(requests) == 2
    finally:
        client.close()


@pytest.mark.parametrize("status", [401, 403, 429, 500])
def test_api_failures_do_not_echo_credentials_or_private_provider_errors(status):
    model, requests, client = service(
        {"error": {"message": KEY + " PRIVATE-FICTIONAL-TASK"}}, status=status
    )
    try:
        with pytest.raises(RuntimeError) as error:
            model("Fictional task")
        assert KEY not in str(error.value) and "PRIVATE-FICTIONAL-TASK" not in str(error.value)
        assert len(requests) == 2
    finally:
        client.close()


def test_key_file_has_precedence_without_returning_secret_from_availability(monkeypatch, tmp_path):
    key_file = tmp_path / "private-key"
    key_file.write_text("file-test-key\n")
    key_file.chmod(0o600)
    monkeypatch.setenv("AGENT_ME_OPENROUTER_KEY_FILE", str(key_file))
    monkeypatch.setenv("OPENROUTER_API_KEY", "env-test-key")
    assert load_openrouter_key() == "file-test-key"
    assert available()["available"] is True
    assert "file-test-key" not in json.dumps(available())
    monkeypatch.setenv("AGENT_ME_OPENROUTER_KEY_FILE", str(tmp_path / "missing"))
    assert available()["available"] is False
    with pytest.raises(ValueError, match="key file"):
        load_openrouter_key()


@pytest.mark.parametrize("mandatory", [False, True, None])
def test_optional_reasoning_is_disabled_only_when_the_catalog_explicitly_allows_it(mandatory):
    models = catalog(
        supported_parameters=["response_format", "structured_outputs", "reasoning"],
        reasoning={"mandatory": mandatory},
    )
    model, requests, client = service(models=models)
    try:
        model("Fictional task")
        payload = json.loads(requests[-1].content)
        if mandatory is False:
            assert payload["reasoning"] == {"enabled": False, "exclude": True}
            assert model.report()["reasoning_disabled"] is True
        else:
            assert "reasoning" not in payload
            assert model.report()["reasoning_disabled"] is False
        assert "reasoning_effort" not in payload
    finally:
        client.close()


def test_unknown_router_or_unsupported_model_does_not_receive_reasoning_disable_controls():
    model, requests, client = service(models=catalog(reasoning={"mandatory": False}))
    try:
        model("Fictional task")
        assert "reasoning" not in json.loads(requests[-1].content)
    finally:
        client.close()


def test_opt_in_private_error_audit_preserves_status_without_public_or_credential_leaks(
    monkeypatch, tmp_path
):
    target = tmp_path / "private-errors" / "provider.json"
    monkeypatch.setenv("AGENT_ME_OPENROUTER_ERROR_FILE", str(target))
    private = "PRIVATE-FICTIONAL-REFERENCE"
    model, requests, client = service(
        {"error": {"message": private + " echoed credential " + KEY}}, status=400
    )
    try:
        with pytest.raises(RuntimeError, match="HTTP 400") as error:
            model("A different private request")
        assert private not in str(error.value) and KEY not in str(error.value)
        audit = json.loads(target.read_text())
        assert audit["status"] == 400 and private in audit["body"]
        assert KEY not in target.read_text() and "redacted credential" in audit["body"]
        assert set(audit) == {"status", "body"}
        assert "Authorization" not in target.read_text()
        assert "A different private request" not in target.read_text()
        assert target.stat().st_mode & 0o777 == 0o600
        assert target.parent.stat().st_mode & 0o777 == 0o700
        assert len(requests) == 2
    finally:
        client.close()


def test_private_error_audit_is_disabled_by_default(monkeypatch, tmp_path):
    monkeypatch.delenv("AGENT_ME_OPENROUTER_ERROR_FILE", raising=False)
    monkeypatch.chdir(tmp_path)
    model, _, client = service({"error": {"message": "private error"}}, status=400)
    try:
        with pytest.raises(RuntimeError, match="HTTP 400"):
            model("Fictional task")
        assert list(tmp_path.iterdir()) == []
    finally:
        client.close()


def test_private_audit_write_failure_cannot_replace_provider_status(monkeypatch, tmp_path):
    blocked = tmp_path / "blocked"
    blocked.write_text("Existing local file")
    monkeypatch.setenv("AGENT_ME_OPENROUTER_ERROR_FILE", str(blocked / "provider.json"))
    model, _, client = service({"error": {"message": "private error"}}, status=400)
    try:
        with pytest.raises(RuntimeError, match="HTTP 400"):
            model("Fictional task")
        assert blocked.read_text() == "Existing local file"
    finally:
        client.close()
