import json
import os
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest
from test_mcp_optimization_data import selected_pack
from test_optimization_engine import DeterministicModel

from app.mcp_optimization import availability, run_request
from app.mcp_optimization_data import prepare_pack_dataset
from app.optimization_engine import execute


def request_files(tmp_path, **updates):
    pack_path = tmp_path / "selected.json"
    pack_path.write_text(json.dumps(selected_pack(personal=True)))
    request = {
        "pack_path": str(pack_path),
        "seed": "Be helpful.",
        "objective": "Ground answers in the selected evidence.",
        "max_metric_calls": 12,
        "ollama_url": "http://127.0.0.1:11434",
        "model": "fixture-model",
        **updates,
    }
    request_path = tmp_path / "request.json"
    request_path.write_text(json.dumps(request))
    return request_path, tmp_path / "result.json", pack_path


def test_invalid_job_records_actionable_error_without_overwriting_inputs(tmp_path):
    request, output, pack = request_files(tmp_path, max_metric_calls=1)
    before = pack.read_bytes()
    assert run_request(request, output) == 1
    result = json.loads(output.read_text())
    assert result["status"] == "failed"
    assert "at least" in result["error"]
    assert output.stat().st_mode & 0o777 == 0o600
    assert pack.read_bytes() == before
    assert run_request(request, pack) == 1
    assert pack.read_bytes() == before
    request_before = request.read_bytes()
    assert run_request(request, request) == 1
    assert request.read_bytes() == request_before


def test_remote_model_url_is_rejected_before_any_execution(tmp_path):
    request, output, _ = request_files(tmp_path, ollama_url="https://example.com")
    assert run_request(request, output) == 1
    assert "local HTTP Ollama" in json.loads(output.read_text())["error"]


@pytest.mark.skipif(not availability()["available"], reason="GEPA extra is not installed")
def test_real_gepa_uses_selected_cases_with_no_held_out_conversations_in_reflection():
    data = prepare_pack_dataset(selected_pack(personal=True))
    model = DeterministicModel()
    result = execute(
        seed="Be helpful.",
        objective="Ground answers.",
        dataset=data,
        max_metric_calls=12,
        model=model,
    )
    assert result["best_artifact"] == "Cite evidence and state uncertainty."
    assert result["improved"] is True
    assert result["promotion_performed"] is False
    assert model.reflections
    heldout = [case["question"] for case in data["splits"]["test"]]
    assert all(question not in prompt for prompt in model.reflections for question in heldout)


@pytest.mark.skipif(not availability()["available"], reason="GEPA extra is not installed")
def test_cli_runs_real_gepa_through_local_ollama_http_and_leaves_source_untouched(tmp_path):
    model, requests = DeterministicModel(), []

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            requests.append(body)
            prompt = body["messages"][-1]["content"]
            text = model(prompt, json_output=body.get("format") == "json")
            payload = json.dumps({"message": {"content": text}}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever)
    thread.start()
    try:
        request, output, pack = request_files(
            tmp_path, ollama_url=f"http://127.0.0.1:{server.server_port}"
        )
        before = pack.read_bytes()
        completed = subprocess.run(
            [
                sys.executable,
                "-m",
                "app.mcp_optimization",
                "--request",
                str(request),
                "--output",
                str(output),
            ],
            env={**os.environ, "PYTHONPATH": str(Path(__file__).parents[1])},
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )
        assert completed.returncode == 0, completed.stderr
        assert completed.stdout == "", "Optimization must not corrupt MCP stdio or leak trace text."
        result = json.loads(output.read_text())
        assert result["status"] == "completed"
        assert result["result"]["improved"] is True
        assert result["result"]["promotion_performed"] is False
        assert result["dataset_summary"]["total_examples"] == 6
        assert result["dataset_summary"]["split_conversations"] == {
            "train": 1,
            "validation": 1,
            "test": 1,
        }
        assert requests and all(row["model"] == "fixture-model" for row in requests)
        assert pack.read_bytes() == before
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
    assert not thread.is_alive()


def test_check_reports_real_optimizer_availability_without_model_request():
    completed = subprocess.run(
        [sys.executable, "-m", "app.mcp_optimization", "--check"],
        env={**os.environ, "PYTHONPATH": str(Path(__file__).parents[1])},
        capture_output=True,
        text=True,
        check=False,
    )
    assert completed.returncode == 0
    value = json.loads(completed.stdout)
    assert value["available"] is availability()["available"]
    assert value["model_execution"] == "local_ollama"
