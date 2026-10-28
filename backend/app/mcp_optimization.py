"""Awaitable GEPA bridge with local Ollama and explicitly approved free OpenRouter."""

from __future__ import annotations

import argparse
import contextlib
import importlib.metadata
import importlib.util
import json
import os
import sys
import tempfile
from pathlib import Path
from urllib.parse import urlparse

from .mcp_optimization_data import MAX_PACK_BYTES, prepare_pack_dataset


def availability() -> dict:
    available = all(importlib.util.find_spec(name) is not None for name in ("gepa", "httpx"))
    from .openrouter_optimization import available as openrouter_available

    return {
        "available": available,
        "gepa_version": importlib.metadata.version("gepa") if available else None,
        "python": sys.version.split()[0],
        "model_execution": "openrouter_free"
        if os.environ.get("AGENT_ME_OPTIMIZATION_PROVIDER") == "openrouter"
        else "local_ollama",
        "openrouter_key_present": openrouter_available()["available"],
        "setup": (
            "Install backend[optimize]. Use installed Ollama or configure an OpenRouter key "
            "for approved free-model runs."
        ),
    }


def write_status(path: Path, value: dict) -> None:
    """Atomic private progress keeps interrupted jobs readable by the MCP host."""
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    handle = tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False)
    temporary = Path(handle.name)
    try:
        with handle:
            os.chmod(temporary, 0o600)
            json.dump(value, handle, ensure_ascii=False, allow_nan=False)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def _read_json(path: Path, maximum: int) -> dict:
    if path.stat().st_size > maximum:
        raise ValueError("Optimization input exceeds its size limit.")
    with path.open(encoding="utf-8") as handle:
        value = json.load(handle)
    if type(value) is not dict:
        raise ValueError("Optimization input must be a JSON object.")
    return value


def run_request(request_path: Path, output_path: Path) -> int:
    summary = None
    execution = None
    remote_model = None
    try:
        request = _read_json(request_path, 100_000)
        allowed = {
            "pack_path",
            "seed",
            "objective",
            "max_metric_calls",
            "ollama_url",
            "model",
            "example_limit",
            "provider",
            "confirm_remote_processing",
            "expected_sha256",
        }
        if set(request) - allowed:
            raise ValueError("Unexpected optimization request fields.")
        pack_path = Path(request["pack_path"]).expanduser().resolve()
        if output_path.resolve() in (request_path.resolve(), pack_path):
            raise ValueError("Output must be a separate file; inputs are never overwritten.")
        seed, objective = request["seed"], request["objective"]
        if not isinstance(seed, str) or not 2 <= len(seed.strip()) <= 30000:
            raise ValueError("Seed prompt or skill must contain 2 to 30000 characters.")
        if not isinstance(objective, str) or not 2 <= len(objective.strip()) <= 2000:
            raise ValueError("Objective must contain 2 to 2000 characters.")
        maximum = request.get("max_metric_calls", 24)
        if type(maximum) is not int or not 1 <= maximum <= 200:
            raise ValueError("Metric-call budget must be between 1 and 200.")
        provider = request.get("provider", "ollama")
        if provider not in ("ollama", "openrouter"):
            raise ValueError("Choose ollama or openrouter optimization.")
        model = request["model"]
        if not isinstance(model, str) or not 1 <= len(model.strip()) <= 200:
            raise ValueError("Choose a model name.")
        url = request.get("ollama_url", "http://127.0.0.1:11434")
        parsed = urlparse(url)
        if (
            parsed.scheme != "http"
            or parsed.hostname not in ("localhost", "127.0.0.1", "::1")
            or parsed.username
            or parsed.password
            or parsed.query
            or parsed.fragment
            or parsed.path not in ("", "/")
        ):
            raise ValueError("Optimization requires a local HTTP Ollama endpoint.")
        pack = _read_json(pack_path, MAX_PACK_BYTES)
        if provider == "openrouter" and (
            request.get("confirm_remote_processing") is not True
            or request.get("expected_sha256") != pack.get("integrity", {}).get("sha256")
        ):
            raise ValueError(
                "Confirm sending this selected export to OpenRouter and its provider "
                "with its exact SHA-256."
            )
        dataset = prepare_pack_dataset(pack, request.get("example_limit", 18))
        summary = {key: value for key, value in dataset.items() if key != "splits"}
        from .optimization_engine import OllamaModel, execute, minimum_budget

        required = minimum_budget(dataset)
        summary["minimum_metric_calls"] = required
        if maximum < required:
            raise ValueError(f"This selection requires at least {required} metric calls.")
        if not availability()["available"]:
            raise ValueError("Install the backend optimize extra to enable real GEPA optimization.")

        if provider == "openrouter":
            from .openrouter_optimization import OpenRouterFreeModel, load_openrouter_key

            remote_model = OpenRouterFreeModel(model, load_openrouter_key())
            remote_model.preflight()
            model_client = remote_model
            execution = {
                "provider": "openrouter",
                "remote": True,
                "model": model,
                "destination": "https://openrouter.ai/api/v1",
                "approved_sha256": request["expected_sha256"],
            }
        else:
            model_client = OllamaModel(url, model)
            execution = {"provider": "ollama", "remote": False, "model": model, "destination": url}

        def progress(value: dict) -> None:
            write_status(
                output_path,
                {
                    "status": "running",
                    "progress": value,
                    "dataset_summary": summary,
                    "execution": execution,
                },
            )

        progress({"phase": "starting", "evaluations": 0, "model_calls": 0})
        # Third-party stdout can contain candidate text and corrupt stdio MCP.
        with open(os.devnull, "w") as quiet, contextlib.redirect_stdout(quiet):
            result = execute(
                seed=seed,
                objective=objective,
                dataset=dataset,
                max_metric_calls=maximum,
                model=model_client,
                on_progress=progress,
            )
        audit = result.pop("search_audit", None)
        if audit is not None:
            audit_path = output_path.with_suffix(".audit.json")
            write_status(audit_path, audit)
            result["audit_path"] = str(audit_path)
        write_status(
            output_path,
            {
                "status": "completed",
                "result": result,
                "dataset_summary": summary,
                "execution": {**execution, **(remote_model.report() if remote_model else {})},
            },
        )
        if remote_model:
            remote_model.close()
        return 0
    except (KeyError, TypeError):
        error = "Invalid optimization request; supply an export, seed, objective, and model."
    except (ValueError, RuntimeError) as exc:
        error = str(exc)
    except (OSError, ImportError):
        error = (
            "Could not read inputs or load the optimizer; check local paths and backend[optimize]."
        )
    except Exception:
        error = "Optimization stopped unexpectedly; no candidate was installed."
    # Do not overwrite an input even when validation fails before starting.
    if output_path.resolve() == request_path.resolve():
        return 1
    if "pack_path" in locals() and output_path.resolve() == pack_path:
        return 1
    write_status(
        output_path,
        {
            "status": "failed",
            "error": error,
            "dataset_summary": summary,
            "execution": {**(execution or {}), **(remote_model.report() if remote_model else {})},
        },
    )
    if remote_model:
        remote_model.close()
    return 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--request", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if args.check:
        print(json.dumps(availability()))
        return 0
    if args.request is None or args.output is None:
        parser.error("--request and --output are required")
    return run_request(args.request, args.output)


if __name__ == "__main__":
    raise SystemExit(main())
