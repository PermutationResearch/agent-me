#!/usr/bin/env python3
"""Start the local trace review service without opening the personal archive."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def available(port: int) -> bool:
    with socket.socket() as probe:
        try:
            probe.bind(("127.0.0.1", port))
        except OSError:
            return False
    return True


def launch(command: list[str], cwd: Path, log: Path, env: dict[str, str]) -> subprocess.Popen:
    fd = os.open(log, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    with os.fdopen(fd, "ab") as output:
        return subprocess.Popen(command, cwd=cwd, env=env, stdin=subprocess.DEVNULL,
                                stdout=output, stderr=output, start_new_session=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state-dir", type=Path, default=ROOT / "private" / "trace-market")
    parser.add_argument("--backend-port", type=int, default=8001)
    parser.add_argument("--frontend-port", type=int, default=5181)
    args = parser.parse_args()
    state = args.state_dir.expanduser().resolve()
    python = ROOT / ".venv" / "bin" / "python"
    if not python.exists():
        parser.error("Install the backend .venv before starting the review service.")
    if not all(available(port) for port in (args.backend_port, args.frontend_port)):
        parser.error("A requested port is already in use. Stop its owned runtime or choose other ports.")
    state.mkdir(parents=True, exist_ok=True, mode=0o700)
    config = state / "market.env"
    key_file = state / "buyer-access-key.txt"
    if not config.exists():
        key = secrets.token_urlsafe(48)
        settings = {"TRACE_SUBMISSIONS_ENABLED": "true", "TRACE_SUBMISSION_DATA_DIR": str(state / "data"),
                    "TRACE_BUYER_TOKEN": key, "PERSONAL_ENABLED": "false", "LLM_BASE_URL": "",
                    "LLM_API_KEY": "", "LLM_MODEL": "", "CORS_ORIGINS": f"http://localhost:{args.frontend_port},http://127.0.0.1:{args.frontend_port}"}
        with os.fdopen(os.open(config, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as output:
            output.write("".join(f"{name}={json.dumps(value)}\n" for name, value in settings.items()))
        with os.fdopen(os.open(key_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as output:
            output.write(key + "\n")
    elif not key_file.exists():
        parser.error("Existing config has no operator key file. Restore it or inspect market.env; refusing to replace credentials.")
    # Prevent inherited personal/provider settings from changing the intake process.
    env = {name: value for name, value in os.environ.items() if not name.startswith(("PERSONAL_", "LLM_", "TRACE_SUBMISSION", "TRACE_BUYER"))}
    env["PYTHONUNBUFFERED"] = "1"
    backend = launch([str(python), "-m", "uvicorn", "app.main:app", "--app-dir", "backend",
                      "--env-file", str(config), "--host", "127.0.0.1", "--port", str(args.backend_port)], ROOT, state / "backend.log", env)
    front_env = {**env, "VITE_API_PROXY_TARGET": f"http://127.0.0.1:{args.backend_port}"}
    frontend = launch(["npm", "run", "dev", "--", "--host", "127.0.0.1", "--port", str(args.frontend_port), "--strictPort"], ROOT / "frontend", state / "frontend.log", front_env)
    runtime = {"backend_pid": backend.pid, "frontend_pid": frontend.pid, "url": f"http://localhost:{args.frontend_port}/",
               "buyer_url": f"http://localhost:{args.frontend_port}/buyer", "buyer_key_file": str(key_file),
               "state_dir": str(state), "personal_enabled": False}
    with os.fdopen(os.open(state / "runtime.json", os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w") as output:
        json.dump(runtime, output, indent=2)
    print(json.dumps(runtime, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
