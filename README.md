# zutot-lab-os

A research lab as a git repo. Markdown for content, a tiny Python worker
for autonomous execution, one Claude.ai Project for everything else.

> *Without deviation from the norm, progress is not possible.* — Zappa

## The whole thing in one paragraph

Two surfaces share one repo. **Student** is a Claude.ai Project you chat
with — it reads the repo via the GitHub connector and writes to it on
your behalf (with diff-before-commit for sensitive edits). When you ask
for heavy work, it drops a markdown job file into `jobs/pending/`.
**The worker** — a small Python daemon on Nimrod's Windows box — picks
those jobs up, runs each one through Claude Code with the right context
preloaded, pushes results back. The current state of any thread is always
in `threads/<name>.md`, kept up to date by both surfaces.

## Layout

```
lab/         Shared brain. What we know + how each surface behaves.
threads/     One file per ongoing work item. The "where am I?" file.
skills/      Advisory how-tos. Added only when a pattern repeats.
jobs/        The only queue: markdown files flowing pending → running → done.
worker/      The Python daemon. Single-writer for code (humans only).
```

`threads/`, `skills/`, and `jobs/*` start empty — they grow into existence
as the student creates files in them.

## Setup checklist

- [ ] Push this repo to GitHub (private)
- [ ] Create the **Student** Project in Claude.ai. Custom instructions =
      contents of `lab/student.md`. Connect GitHub.
- [ ] Set up the worker on the Windows box (see `worker/README.md`).
- [ ] First chat: *"Create a thread for the metric voting paper, Overleaf
      git URL is ..., status is drafting §3 for ADT 2026."* Watch the
      diff, approve, see the commit happen.
- [ ] Sanity check the worker round-trip with a tiny job
      (*"echo hello to result.md and finish"*).

## The single-writer rule

- **Content** (`lab/`, `threads/`, `skills/`, `jobs/pending/`) →
  the student writes (via diff-before-commit for `lab/`).
- **Worker output** (`jobs/running/`, `jobs/done/`, results in `threads/`)
  → only the worker writes.
- **Code** (`worker/`) → only humans write.

No collisions, no race conditions, no surprises.

## Status: where to look

The thread file. `threads/<name>.md` is always current — the worker
updates its `## Notes` section after every job. To catch up tomorrow:

> *"What's the state on paper-metric-voting?"*

The student reads the file and tells you. Nothing else to check.
