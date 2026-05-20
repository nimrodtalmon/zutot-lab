# Zutot Lab OS Observer — build spec

## Overview

The Observer is a single-page web app for monitoring an existing research-lab system called **Zutot Lab OS**. It is a read-only "lens" over a Google Drive folder; it makes no writes of its own, and reflects whatever state already exists in the folder.

The lab system has two AI surfaces over a shared Drive folder:

- **Student**: a Claude.ai Project with the Google Drive connector enabled. Handles conversation, lightweight edits, and dispatching of heavy work.
- **Worker**: a Python daemon running on a local machine, syncing via Google Drive Desktop, executing dispatched jobs.

Heavy work is dispatched as a markdown file in `jobs/pending/`. The worker picks it up, runs it, and writes results back to the folder. The Observer surfaces all of this read-only: which threads have work in progress, which are blocked on a question from the worker, which have fresh results. All writes continue to flow through Student. The Observer never writes to Drive.

### Stack at a glance

- React 18 + TypeScript + Vite
- Vanilla CSS (no Tailwind)
- `markdown-it` + `DOMPurify` for content rendering
- Google API JS client (`gapi`) + Google Picker SDK for Drive access
- No backend. No database. No service worker. No tests in v0.
- Deployed as a static bundle to Cloudflare Pages.

### Companion file

A visual reference is provided as `zutot-observer-mocks.html` (interactive ASCII-faithful mocks of every screen). Reference for layout, density, and component hierarchy.

---

## 1. Filesystem inputs

The Observer reads (only) from a Google Drive folder named `zutot-lab-os/`. The path to this folder is configured once at first run.

### 1.1 Folder layout

```
zutot-lab-os/
├── README.md                    (ignored)
├── lab/                         (ignored)
├── threads/
│   └── <slug>.md                ← one thread per file
├── jobs/
│   ├── pending/
│   │   ├── <id>.md              ← legacy: flat file
│   │   └── <id>/                ← new: folder with job.md inside
│   ├── running/
│   │   └── <id>/                ← folder always
│   │       ├── job.md
│   │       ├── progress.md
│   │       ├── question.md      (present iff worker is asking)
│   │       └── answer.md        (written by Student when answering)
│   └── done/
│       ├── <id>.md              ← legacy: flat file (treated as result)
│       ├── <id>.result.md       ← legacy variant
│       └── <id>/                ← new: folder
│           ├── job.md
│           └── result.md
├── skills/                      (ignored)
└── worker/                      (ignored)
```

Only `threads/` and `jobs/` are consumed.

### 1.2 Thread file schema (`threads/<slug>.md`)

Ad-hoc prose conventions, no YAML front-matter. Parser extracts the following with these regexes (line-anchored):

| Field | Regex | Required | Source |
|---|---|---|---|
| `slug` | filename minus `.md` | yes | path |
| `title` | `^#\s+(.+)$` (first match) | no (falls back to slug) | line 1 typically |
| `overleaf` | `^Overleaf:\s*(\S+)` (first match) | no | early line |
| `status` | `^Status:\s*(.+)$` (first match) | no | early line |
| `notes` | everything after the first `^##\s+Notes\s*$` heading | no | tail of file |

If none of these parse, render with `title = slug` and an empty body. Never reject the file.

Example:

```markdown
# paper-zutot-lab-os

Overleaf: https://git.overleaf.com/abcdef
Status: drafting, no venue yet

## Notes
- 2026-05-19: created thread. Tex skeleton in place.
- 2026-05-19: framing review landed. Lead with the pattern; CHI > CSCW > DIS.
```

### 1.3 Job file/folder schema

Each job lives in exactly one of `pending/`, `running/`, `done/`. State is derived from path (§2.1).

**Job ID resolution:**

- Folder job: ID = folder name.
- Flat job (legacy): ID = filename minus `.md` (also strip a trailing `.result` if present).

**Spec parsing** (from `<jobdir>/job.md` for folder jobs; from the flat file body for legacy):

| Field | Regex | Required |
|---|---|---|
| `title` | `^#\s+Job:\s+(.+)$` | no (falls back to ID) |
| `thread` | `^Thread:\s*(\S+)$` | **yes** — if missing, hide job (§5.4) |
| `budget` | `^Budget:\s*(.+)$` | no (free text, displayed as-is) |
| `body` | everything after the field-block header lines | no |

Example:

```markdown
# Job: framing-and-related-work

Thread: paper-zutot-lab-os
Budget: substantial — foundational review for the paper

## Task

Produce a thorough literature and market review...
```

### 1.4 Lifecycle migration

Jobs are migrating from flat-file to folder form. The parser must tolerate both shapes in all three lifecycle locations:

| Location | Legacy | Current |
|---|---|---|
| `pending/` | `<id>.md` | `<id>/job.md` |
| `running/` | (n/a) | `<id>/job.md` + `progress.md` + optional `question.md`, `answer.md` |
| `done/` | `<id>.md` or `<id>.result.md` | `<id>/job.md` + `result.md` |

For legacy flat-file done jobs, the spec is unavailable (the original was overwritten by the result). Show only the result content in the overlay, with a small `(legacy flat job)` label.

---

## 2. State derivation

The Observer is a pure function `(drive snapshot, lastVisit) → UI state`. This section defines that function.

### 2.1 Per-job state

```
location = pending  → state = pending
location = running  → if question.md exists ∧ answer.md does not exist → state = blocked
                    → else                                              → state = running
location = done     → state = done
```

No "bad" state. A stuck job (e.g. worker crashed) sits in `running/` indefinitely and displays as `running`. This is acceptable for v0.

### 2.2 Per-thread state and color

A thread's color = the maximum-priority signal across its jobs and its file mtimes.

```
hasBlocked = any job in state=blocked
hasRunning = any job in state=running
hasFresh   = any worker-written file under the thread has mtime > lastVisit[slug]
             (relevant files: result.md across all done jobs + the thread.md itself)

state =
  blocked   if hasBlocked
  running   else if hasRunning
  fresh     else if hasFresh
  idle      else
```

Color mapping:

| State | Color | Hex |
|---|---|---|
| blocked | blue | `#2563eb` |
| running | orange | `#c97f17` |
| fresh | green | `#2f9e44` |
| idle | gray | `#b8b1a3` |

Threads in the list are sorted by this state in the order above (blocked first, idle last). Within a state, ties broken by `lastActivity` descending.

### 2.3 Derived per-thread fields

- `lastActivity` = max mtime over the thread's `.md` file plus every file inside its job dirs. Formatted relatively (`5m`, `2h`, `3d`, `1w` — cap at weeks).
- `counts` = `{d, r, p}` = number of done / running / pending jobs whose `Thread:` field matches this slug. `blocked` jobs count as running.

### 2.4 Open-question surfacing

Each job in `state=blocked` contributes one question card to its thread. Card content is read directly from `jobs/running/<id>/question.md`. If multiple jobs in one thread are blocked, stack all their cards (most-recent question first).

### 2.5 Recently-done surfacing

A done job is "recent" for thread T iff `result.md.mtime > lastVisit[T]`. List newest first.

If the set is empty after the last-visit filter, **hide the "Recently done" section entirely**. Do not fall back to "last N done."

### 2.6 lastVisit semantics

Stored as `{ <slug>: <ISO timestamp> }` in localStorage.

- Updated when a thread view mounts, **after** the freshness check for that render. ("I opened it, I saw it.")
- Per-thread; viewing one thread does not affect freshness on others.
- Threads never visited are treated as freshly created — `lastVisit[slug] ?? "1970-01-01T00:00:00Z"`.
- On cold start, prune entries whose slug no longer exists in the folder.

---

## 3. UI

Reference: see `zutot-observer-mocks.html` for visual fidelity.

### 3.1 Routes (hash-based)

```
/                                → no thread selected
/#<slug>                         → thread selected, no overlay
/#<slug>/<job-id>                → thread selected, overlay open
```

- Hash changes (selection, overlay open/close) use `history.pushState`.
- Browser back-button:
  - Laptop: pops overlay, then deselects thread.
  - Mobile: pops overlay → thread → list (three-frame stack).
- Reload restores fully from hash + localStorage.
- On cold load with empty hash and non-empty threads list, auto-select the top thread (most-urgent). Do not auto-select on subsequent hash-clear navigations within the session.

### 3.2 Breakpoint

Single breakpoint at **900px**.

- ≥ 900px: laptop layout (two panes side by side, overlay as modal).
- < 900px: mobile layout (single pane visible, overlay as full-screen).

Same DOM tree both sides; visibility and grid templates change via CSS.

### 3.3 Layout: laptop

```
┌────────────────┬────────────────────────────────────┐
│  Threads list  │  Selected thread                   │
│  (~320px)      │  (header + sections + overlay)     │
└────────────────┴────────────────────────────────────┘
```

Overlay (when open): modal-positioned over the right pane, dimmed backdrop.

### 3.4 Layout: mobile

Single pane at a time: list → thread → overlay. Top bar shows back arrow + actions appropriate to the current pane.

### 3.5 Threads list (left pane on laptop, root view on mobile)

Each row contains:

- Colored status dot (10px, see §2.2).
- Thread slug (serif, 15.5px laptop / 16px mobile).
- Meta line (mono, 10.5px): relative `lastActivity` · `<d>d <r>r <p>p`.

No description, no preview text. Selected row gets a left rail and a subtle background.

Click/tap selects the thread (updates hash, navigates panes accordingly).

### 3.6 Thread view (right pane on laptop, second screen on mobile)

Contents, top to bottom:

1. **Header**: thread title (serif, large) + actions row.
   - Actions: `Overleaf ↗` (if `overleaf` field present) and `💬 Student` (always).
2. **Status line**: muted mono text reading `Status: <status>`. Hidden if no status.
3. **Open question card(s)** (blue): one per blocked job. Each shows:
   - `from job: <id>` (mono, blue tint)
   - Question body (markdown-rendered)
   - `Answer in Student chat ↗` button (right-aligned)
4. **Running now**: one card per running job. Each shows:
   - Job slug + small "in progress" / "halted on question" badge
   - Tail of `progress.md`: last **8 lines**, mono, gray timestamps. Auto-scrolls to bottom on new lines; suspends auto-scroll if the user has scrolled up.
5. **Recently done**: one card per recently-done job (filtered per §2.5). Each shows: job slug + relative time. Section hidden when empty.
6. **Notes**: rendered markdown body of the thread file from `## Notes` onward. Plain bulleted list typically.
7. **Pending**: list of pending job IDs as small mono pills.
   - If ≤ 5 pending: expanded.
   - If > 5: collapsed behind a `▸ show` toggle.

Job cards (running, recently done, pending) are clickable — open the job overlay.

### 3.7 Job overlay

Opens on top of the right pane (laptop) or as full-screen (mobile). Closing returns to the prior view.

Header: `<job-id>` (mono) + state pill (`done` / `running` / `pending`) + `✕` close button.

Body sections (whichever apply):

- `thread: <slug>` and `budget: <text>` (mono key-value lines)
- **Spec**: markdown body of `job.md`
- **Progress**: full `progress.md` content (not tail-capped here)
- **Open question**: `question.md` content if present
- **Result**: `result.md` content if present

No "Open Student chat about this job" button — chat handoff is thread-level only.

### 3.8 First-run wizard

Shown inline (not modal) when any of the three config keys is missing. Three steps, sequential:

1. **Connect Drive** — triggers OAuth (§4.2). Stores token.
2. **Pick lab folder** — opens Google Picker. Stores folder file ID.
3. **Paste Student project URL** — input field. Parse UUID from `https://claude.ai/project/<uuid>...`. Stores UUID. Validate inline; only enable submit on valid UUID.

After step 3, wizard collapses permanently (until localStorage is wiped).

### 3.9 Empty and error states

| Case | UI |
|---|---|
| No threads in folder | List: "No threads yet. Create one in Student chat." |
| Thread file body empty | Header + status, no other sections |
| `progress.md` empty | "no progress recorded yet" (gray, mono, small) |
| `result.md` empty | "result file is empty" (gray, mono, small) |
| Drive 401 mid-session | Top banner: "Session expired — reconnect Drive" + button |
| Drive failures persisting > 2 min | Top banner: "Drive sync paused" — clears on first successful poll |
| Unparseable / malformed file | Hide silently; `console.warn(filepath)` |

### 3.10 Tab title and favicon

Document title:

- No selection: `Zutot Observer`
- Thread selected: `<slug> — Zutot Observer`
- Overlay open: `<job-id> — Zutot Observer`

Prefix with the urgency emoji of the highest-priority thread, when in background tab:

- 🔵 if any thread is blocked
- 🟡 else if any is running
- 🟢 else if any is fresh
- (no prefix when all idle)

Favicon is a single dynamic SVG that repaints itself to match the prefix dot.

---

## 4. Drive integration

### 4.1 Access path

Browser-direct, no backend. Uses the Google API JS client (`gapi`) for OAuth and REST calls, and Google Picker SDK for folder selection.

### 4.2 OAuth

PKCE flow, in-browser. Scope: `https://www.googleapis.com/auth/drive.readonly`.

Token storage: `localStorage` key `zutot.observer.driveToken` containing `{access, refresh, expiry}`. On 401, pause polling and surface the "Session expired" banner; reconnect on user click.

Requires a Google Cloud project with the Drive API enabled and an OAuth Web Application client whose authorized origin is the deployed URL. The client ID is provided at build time as `VITE_GOOGLE_CLIENT_ID`. Consent screen stays in "test mode" with the user as a test user — no app verification needed.

### 4.3 Polling

The Observer uses the Drive `changes.list` endpoint with a persisted `nextPageToken`. Each poll yields the global change delta since the last poll; the app filters by ancestor folder ID client-side.

Two cadences:

- **Active zone** (files inside the currently-selected thread's set: its `thread.md`, its running jobs' `progress.md`/`question.md`/`answer.md`, its done jobs' `result.md`): poll every **5 seconds**.
- **Background zone** (everything else): poll every **60 seconds**.

When `document.hidden === true`, drop to **60s active / 5min background**. Resume on `visibilitychange`.

Single in-flight poll per zone (skip ticks that fire while a poll is mid-flight).

On `changesPageToken` rejection (HTTP 410 Gone), re-seed via `changes.getStartPageToken` and refetch all known files.

### 4.4 Content fetching

When `changes.list` reports a relevant file changed (mtime newer than cached), fetch its body via `files.get?alt=media`.

Cached in memory keyed by `(fileId, mtime)`. Not persisted to localStorage.

`result.md` bodies are fetched **lazily** when the user opens the overlay, not eagerly on poll.

### 4.5 Cold start

```
1. Read tokens from localStorage. If missing or expired → wizard step 1.
2. Read folderId from localStorage. If missing → wizard step 2.
3. Read studentProjectId from localStorage. If missing → wizard step 3.
4. Full crawl: files.list recursively under folderId, fetching all relevant
   bodies (thread files, job.md, progress.md, question.md, answer.md,
   non-lazy fields only).
5. Initialize changes.list page token via changes.getStartPageToken.
6. Render. Begin polling.
```

### 4.6 Rate limiting

On HTTP 403 `rateLimitExceeded`: exponential backoff `5s → 10s → 20s → 40s → 60s (cap)` with jitter. Resume normal cadence after the first successful call.

---

## 5. Rendering

### 5.1 Markdown

Library: `markdown-it`.

Configuration:

```js
markdownIt({
  html: false,      // no raw HTML passthrough
  linkify: true,    // bare URLs become links
  typographer: false,
})
.use(footnote)
.use(taskLists)
```

Rendered HTML is passed through `DOMPurify.sanitize` before insertion via `dangerouslySetInnerHTML`.

No syntax highlighting in code blocks for v0. Render with mono font, gray background, padded.

### 5.2 Heading demotion

Inside job specs and results, demote all headings by one level (`#` → `<h2>`, `##` → `<h3>`, etc.) so they do not collide with the overlay's own section headings.

### 5.3 progress.md

Do **not** pass through markdown. Render as preformatted mono text. For each line, attempt `/^(\S+)\s+(.+)$/`; render `$1` as a muted timestamp followed by `$2`. Unmatched lines render whole.

- Thread view's "Running now" card: show last **8 lines**.
- Job overlay: show all lines.

On poll detecting a `progress.md` change, refetch, diff the tail, and fade new lines in (200ms). Auto-scroll to bottom unless the user has scrolled up within that block.

### 5.4 Relative time formatting

```
< 60s    → "just now"
< 60m    → "Nm"
< 24h    → "Nh"
< 7d     → "Nd"
≥ 7d     → "Nw" (cap; do not show months/years)
```

Progress timestamps stay as the source format (`HH:MM`) — do not reformat.

---

## 6. Student chat handoff

### 6.1 URL format

Open in a new tab:

```
https://claude.ai/project/<studentProjectId>/new?q=<urlencoded-prompt>
```

If the `?q=` prefill is not honored by claude.ai (verify against a live project before shipping), fall back to: copy prompt to clipboard, open `https://claude.ai/project/<studentProjectId>`, show a toast "prompt copied — paste it."

### 6.2 Prompt templates

Both are deliberately terse. Student already knows the lab from its operating manual; do not re-explain.

**Thread-level** (button in thread header):

```
Resume work on thread `<slug>`. Read `threads/<slug>.md` and any relevant
files under `jobs/` before responding.
```

**Question-level** (button on question card):

```
Answer the open question in `jobs/running/<job-id>/question.md` (thread:
`<thread-slug>`). When you have an answer, write it to
`jobs/running/<job-id>/answer.md` so the worker can resume.
```

URL-encode the entire prompt for the `?q=` value.

---

## 7. Client-side state

Exactly five localStorage keys. No other persistent state, anywhere.

```
zutot.observer.driveToken         {access, refresh, expiry}
zutot.observer.folderId           string (Drive file ID)
zutot.observer.studentProjectId   string (UUID)
zutot.observer.lastVisit          { <slug>: <ISO timestamp> }
zutot.observer.changesPageToken   string
```

Update rules:

- `driveToken`: written after OAuth, updated on refresh, cleared on 401-after-refresh-failure.
- `folderId`, `studentProjectId`: written once during the wizard. Never updated.
- `lastVisit[slug]`: written on thread-view mount, after the freshness check for that render. Prune dead slugs on cold start.
- `changesPageToken`: rewritten after every successful `changes.list` call.

In-memory ephemeral state (selection, overlay, files cache, poll-error counters) is rebuilt from URL hash + localStorage on every load.

### 7.1 No settings UI

There is no settings screen. There is no "Disconnect Drive" button. To reset, the user clears localStorage in browser devtools. Wizard re-runs automatically.

### 7.2 localStorage unavailable

If localStorage is disabled (e.g. private browsing): show a banner "Local storage unavailable — some features disabled." App still functions for a single session.

### 7.3 Corruption

If a localStorage key fails to parse (JSON.parse throws): discard the key and continue. Wizard re-prompts for that step if needed.

---

## 8. Failure modes

General principles:

- Malformed files become invisible (not errors).
- Transient Drive errors are silent for the first 2 minutes, then a banner appears, then clears on first success.
- The only user-facing alarms are the 401 banner and the 2-min banner.

| Failure | Behavior |
|---|---|
| 401 unauthorized | Banner + reconnect button; polling paused until resolved |
| 403 rate-limited | Exponential backoff (§4.6); no UI |
| 5xx / network offline | Silent for 2 min; banner thereafter; clears on success |
| `thread.md` deleted mid-session | Remove from list; deselect if currently selected |
| Job missing `Thread:` field | Hide; `console.warn(path)` |
| `question.md` disappears (worker resumed) | Question card disappears on next poll (normal) |
| Conflicted-copy files (`* (1).md` etc.) | Ignore. Optional `console.warn` |
| Worker crashed mid-job (stuck `running/`) | Show as `running` indefinitely; user manually moves back to `pending/` per lab convention |
| Bad `changesPageToken` (410 Gone) | Re-seed token via `getStartPageToken`; refetch all files |
| In-flight fetch hits 404 (file just moved) | Drop from cache silently; next poll reflects reality |
| Two polls overlap | Skip the new tick; one in-flight per zone |
| Clock skew (client vs Drive) | Accept it. lastVisit and mtime are both ISO; small skew is not corrected. |

---

## 9. Out of scope for v0

Deliberately not built. Do not add these unprompted.

- "Bad" job state and stale-progress heuristic.
- Per-job Student chat handoff.
- Syntax highlighting in code blocks.
- Tests.
- Service worker / offline mode.
- Settings UI of any kind.
- Multi-folder support.
- Multi-user support.
- Notifications (browser API, sound, push).
- Search.
- Inline file editing.
- Direct chat with Worker.
- Job dispatch from the Observer (still goes through Student).
- Dashboards, widgets, charts, metrics.

---

## 10. Acceptance criteria & iteration

### 10.1 Definition of done

v0 is done when every scenario in §10.2 passes end-to-end on both laptop (≥ 900px viewport) and mobile (375px viewport — Chrome DevTools device mode is sufficient) widths, against the **actual** `zutot-lab-os/` Drive folder.

"Passes" means: behavior matches the spec, latency targets in §4.3 are met, no console errors during normal operation, no visual glitches at the breakpoint or during state transitions.

### 10.2 Acceptance scenarios

Walk through these manually. Each should "just work" without surprises.

**S1 — First run.**
Clear localStorage. Reload. Wizard appears at step 1. Connect Drive (OAuth completes). Wizard advances to step 2. Pick the lab folder. Wizard advances to step 3. Paste the Student project URL. Wizard collapses. Threads list populates within ~5 seconds. Top thread is auto-selected; right pane shows its content.

**S2 — Steady-state boot.**
Reload an already-configured app. Threads list and selected thread render within ~500ms from cache (before the first poll completes). The first poll completes silently within ~5 seconds and any deltas appear without visual flicker.

**S3 — Live progress streaming.**
With a thread selected that has a running job: write a new line to its `progress.md` (manually edit in Drive if no worker is active). Within ~5 seconds the new line appears in the "Running now" card with a brief fade-in. The card auto-scrolls to the bottom (unless the user has scrolled up).

**S4 — Open question round-trip.**
Create a `jobs/running/<id>/question.md` (manually if needed). Within ~5 seconds the thread color turns blue and the question card appears. Click "Answer in Student chat" — new tab opens to claude.ai with the prompt prefilled. Write `answer.md` and delete `question.md`. Within ~5 seconds the card disappears and the thread color drops to its next-highest state.

**S5 — Job overlay.**
Click any job card (running, recently done, or pending). Overlay opens. Verify it shows the correct sections per the job's state: spec always; progress for running; question for blocked; result for done. Click ✕ or press browser back. Overlay closes; right pane returns to the thread view. URL hash updates throughout.

**S6 — Recently-done lifecycle.**
With a thread selected, note any items in "Recently done." Reload — items remain (still newer than lastVisit). Navigate to a different thread and back. "Recently done" section is now empty and hidden entirely.

**S7 — Threads list ordering.**
Verify threads are sorted: blocked first, then running, then fresh, then idle. Within each tier, most-recent activity first. Dot colors match state.

**S8 — Mobile flow.**
Resize to ~375px width. Threads list is the only pane visible. Tap a thread → thread view. Tap a job → full-screen overlay. Browser back: overlay → thread → list, in order.

**S9 — Reload preserves state.**
With a thread selected and an overlay open, copy the URL. Open it in a new tab. App boots into the exact same state. Reload that tab. Still in the same state.

**S10 — Network failure handling.**
Disable network for 30 seconds during operation. Re-enable. No banner should have appeared (under the 2-min threshold). Now disable for > 2 minutes. The "Drive sync paused" banner appears. Re-enable. Banner clears on the next successful poll.

**S11 — Auth failure handling.**
Force-expire the OAuth access token (delete it from localStorage, keep the refresh token). Wait for next poll. The 401 banner appears. Click reconnect. Token refreshes; banner clears.

**S12 — Tab title and favicon.**
Open the app in a background tab. When any thread is blocked, the tab title prefixes with 🔵 and the favicon paints blue. Change the source state (e.g. delete the `question.md`); verify the title and favicon update on the next poll.

**S13 — Malformed input.**
Edit a thread file to break its title parsing (remove the `# slug` line). Thread continues to render with fallback title = slug. Edit a job to remove the `Thread:` field. Job disappears from the UI; `console.warn` fires with the file path.

### 10.3 Iteration discipline

Building this app is an iterative loop, not a one-pass implementation. Expect to cycle through:

- **Parser robustness.** Real-world thread and job files will have edge cases the spec didn't anticipate. Run the parsers against every file currently in `zutot-lab-os/threads/` and `jobs/`; iterate until no warnings fire on conforming files.
- **Polling latency.** The 5s active cadence is a target. Drive API latency varies; tune in-flight handling to avoid pile-ups on slow networks.
- **Mobile layout.** The 900px breakpoint is the only structural break, but small-screen edge cases (long thread titles, narrow overlay) surface only during real use. Tighten as needed.
- **Error banner UX.** The 2-min threshold is a starting point. If Drive flakiness makes the banner appear too often, raise it; if real outages get missed, lower it.

When the spec is ambiguous, the mocks file (`zutot-observer-mocks.html`) is the tiebreaker. When both are ambiguous, prefer the simpler behavior — this app is intentionally small, and "did less" is usually the right answer.

**Do not ship if any S1–S13 scenario fails.** "Mostly works" is not done; the value of this app is being trustworthy at a glance, which means being right. Keep iterating.

---

## 11. Suggested build order

1. **Scaffold**: Vite React+TS template; Cloudflare Pages connection to the repo; `VITE_GOOGLE_CLIENT_ID` configured.
2. **Parsers** (`src/parse/`): `thread.ts`, `job.ts`. Pure functions; given file bytes, return typed structures. Easy to write and easy to verify by hand against a downloaded copy of the actual `zutot-lab-os/` folder.
3. **State derivation** (`src/state/derive.ts`): given parsed threads + jobs + lastVisit, produce the UI state object (sorted threads, colors, counts, etc.). Pure function.
4. **UI components** (`src/ui/`), wired to a hand-constructed mock state object. Port the mocks file. Verify visual fidelity.
5. **Routing & layout**: hash-based routes, breakpoint, mobile back-stack.
6. **OAuth & first-run wizard** (`src/drive/auth.ts`, `src/ui/Wizard.tsx`): get to "I have tokens and a folder ID."
7. **Drive crawl + content fetching** (`src/drive/files.ts`): cold-start full crawl. Wire to the state derivation. App now works on real data, statically.
8. **Polling** (`src/drive/poll.ts`): `changes.list` loop, two cadences, hidden-tab handling. App now updates live.
9. **`progress.md` streaming polish**: fade-in for new lines, auto-scroll with yield.
10. **Tab title + favicon**: dynamic repaint based on global urgency.
11. **Failure-mode handling**: 401 banner, 2-min banner, retry/backoff, corruption recovery.

---

## 12. Repository layout

```
zutot-observer/
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── public/
│   └── favicon.svg
└── src/
    ├── main.tsx
    ├── App.tsx
    ├── styles.css
    ├── drive/
    │   ├── auth.ts          OAuth, token storage
    │   ├── picker.ts        Google Picker integration
    │   ├── files.ts         files.list, files.get, cache
    │   └── poll.ts          changes.list polling loop
    ├── parse/
    │   ├── thread.ts
    │   └── job.ts
    ├── state/
    │   ├── derive.ts        snapshot + lastVisit → UI state
    │   ├── lastVisit.ts     localStorage glue
    │   └── routes.ts        hash routing
    └── ui/
        ├── Wizard.tsx
        ├── ThreadList.tsx
        ├── ThreadView.tsx
        ├── JobOverlay.tsx
        ├── QuestionCard.tsx
        ├── JobCard.tsx
        ├── ProgressLog.tsx
        └── Banner.tsx
```
