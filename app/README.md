# Zutot Observer

A read-only web "lens" over the `zutot-lab-os/` Google Drive folder. Single-page
React + TypeScript app, no backend. See `../README.md` for the surrounding lab.

## Develop

```bash
cd app
npm install
cp .env.example .env.local      # fill in VITE_GOOGLE_CLIENT_ID
npm run dev                     # http://localhost:5173
```

You need a Google Cloud project with the Drive API + Picker API enabled and an
OAuth Web Application client whose authorized origin is your dev URL (e.g.
`http://localhost:5173`). The OAuth consent screen can stay in "test mode" with
you listed as a test user.

## Build

```bash
npm run build
npm run preview
```

Deploy `dist/` as a static bundle (Cloudflare Pages, Netlify, etc.). Set
`VITE_GOOGLE_CLIENT_ID` and any authorized origins to match the deployed URL.

## Reset

There is no settings UI. To reconfigure (e.g. switch lab folders), clear the
`zutot.observer.*` keys in localStorage from devtools. The wizard re-runs.

## What it does (and doesn't)

Read-only. It reflects the state of `threads/` and `jobs/` in Drive — which
threads have work in progress, which are blocked on a question from the worker,
which have fresh results. All writes (creating threads, answering questions,
dispatching jobs) still flow through the Student claude.ai project.

See `zutot-observer-spec.md` (provided with this repo) for the full spec.
