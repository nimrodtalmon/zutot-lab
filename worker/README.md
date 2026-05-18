# worker

Tiny Python daemon that polls `jobs/pending/` and runs each job via
Claude Code with `lab/worker.md` as the contract.

## Requirements

- Python 3.10+
- `claude` CLI installed and authenticated (uses your Max subscription)
- `git` configured with push access to this repo
- Optional: Tailscale (verify status remotely)

## Install

```bash
cd worker
python -m venv .venv
.venv\Scripts\activate          # Windows
# source .venv/bin/activate     # macOS/Linux
```

(No dependencies right now — `watch.py` uses only the standard library.
The venv is for hygiene.)

## Run

```bash
python watch.py
```

Leave it running. Restart on reboot via Windows Task Scheduler or `nssm`.

## What it does on each cycle

1. `git pull --ff-only` — pick up jobs the student pushed
2. For each `*.md` in `jobs/pending/`:
   - Move to `jobs/running/`
   - Build prompt: `lab/worker.md` + job content
   - Run `claude --print <prompt>` with the repo as cwd
   - Archive into `jobs/done/<timestamp>-<slug>/` with `job.md` and
     `result.md` (prefixed `FAILED-` if the run errored)
   - Commit and push

## Configuration

Edit constants at the top of `watch.py`:

- `POLL_INTERVAL` — seconds between scans (default 10)
- `CLAUDE_CMD` — name of the Claude Code binary (default `claude`)
- `JOB_TIMEOUT` — hard cap per job (default 2 hours)

## Failure modes

- `claude` not on PATH → every job fails. Check with `claude --version`.
- Git push fails → results stay local. Check `git status` and credentials.
- Worker crashes → restart. Jobs in `jobs/running/` may need manual
  return to `jobs/pending/`.
