#!/usr/bin/env python3
"""
worker/watch.py — the zutot-lab-os job runner.

Watches jobs/pending/ for new markdown job files. On finding one:
  1. moves it to jobs/running/
  2. runs Claude Code with lab/worker.md prepended to the job content
  3. archives to jobs/done/<timestamp>-<slug>/ with job.md and result.md
  4. commits and pushes so the student sees the results

Long-lived process on Nimrod's Windows box. Restart on failure.
"""

import shutil
import subprocess
import time
from datetime import datetime
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
PENDING = REPO_ROOT / "jobs" / "pending"
RUNNING = REPO_ROOT / "jobs" / "running"
DONE = REPO_ROOT / "jobs" / "done"
CONTRACT = REPO_ROOT / "lab" / "worker.md"

POLL_INTERVAL = 10          # seconds between scans
CLAUDE_CMD = "claude"       # adjust if your install uses a different name
JOB_TIMEOUT = 60 * 60 * 2   # 2-hour hard cap per job


def log(msg: str) -> None:
    print(f"[{datetime.now().isoformat(timespec='seconds')}] {msg}", flush=True)


def git(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", *args],
        cwd=REPO_ROOT,
        check=False,
        capture_output=True,
        text=True,
    )


def build_prompt(job_text: str) -> str:
    """Worker contract from lab/worker.md, then the job."""
    contract = CONTRACT.read_text(encoding="utf-8")
    return f"{contract}\n\n=== JOB ===\n{job_text}\n=== END JOB ===\n"


def run_job(job_path: Path) -> tuple[bool, str]:
    """Invoke Claude Code on the job. Return (success, output)."""
    prompt = build_prompt(job_path.read_text(encoding="utf-8"))
    try:
        result = subprocess.run(
            [CLAUDE_CMD, "--print", prompt],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            timeout=JOB_TIMEOUT,
        )
        ok = result.returncode == 0
        output = result.stdout
        if result.stderr:
            output += "\n--- STDERR ---\n" + result.stderr
        return ok, output
    except subprocess.TimeoutExpired:
        return False, f"ERROR: job exceeded {JOB_TIMEOUT}s timeout"
    except FileNotFoundError:
        return False, f"ERROR: {CLAUDE_CMD!r} not found on PATH"
    except Exception as e:
        return False, f"ERROR: {type(e).__name__}: {e}"


def archive(job_path: Path, output: str, success: bool) -> Path:
    ts = datetime.now().strftime("%Y-%m-%dT%H-%M-%S")
    prefix = "" if success else "FAILED-"
    folder = DONE / f"{ts}-{prefix}{job_path.stem}"
    folder.mkdir(parents=True, exist_ok=True)
    shutil.move(str(job_path), str(folder / "job.md"))
    (folder / "result.md").write_text(output, encoding="utf-8")
    return folder


def commit_and_push() -> None:
    git("add", "-A")
    if not git("status", "--porcelain").stdout.strip():
        return
    git("commit", "-m", "worker: job results")
    git("push")


def process_one(pending_path: Path) -> None:
    log(f"picking up {pending_path.name}")
    running_path = RUNNING / pending_path.name
    shutil.move(str(pending_path), str(running_path))
    ok, output = run_job(running_path)
    folder = archive(running_path, output, ok)
    commit_and_push()
    log(f"done {pending_path.name} -> {folder.name} ({'ok' if ok else 'FAILED'})")


def main() -> None:
    for d in (PENDING, RUNNING, DONE):
        d.mkdir(parents=True, exist_ok=True)
    log(f"watching {PENDING}")
    while True:
        git("pull", "--ff-only")
        for p in sorted(PENDING.glob("*.md")):
            try:
                process_one(p)
            except Exception as e:
                log(f"failed processing {p.name}: {type(e).__name__}: {e}")
        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    main()
