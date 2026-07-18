# AVANZARE

Resume-screening assistant for recruiters. Point it at a folder of CVs (PDF/Word),
define mandatory and nice-to-have keywords, review rejections with full human control,
and let a **local LLM (Ollama)** rank the remaining candidates against your job
description — then send acceptance/rejection emails from inside the app.

Documentation:

- [User guide](docs/USER_GUIDE.md) — setup, workflow, settings profiles
- [Error codes](docs/ERROR_CODES.md) — every `AVZ-*` code with cause and remedy
- [Architecture](docs/ARCHITECTURE.md) — engine/UI split, data storage, privacy notes
- [Scalability](docs/SCALABILITY.md) — multitasking, email intake, local/remote/API LLMs, how it scales
- [Overview & tech map](docs/OVERVIEW.html) — visual workflow walkthrough + per-feature tech stack (open in a browser)

## Quick start (development)

Prerequisites: Node.js ≥ 20, and [Ollama](https://ollama.com) running locally or on a
reachable machine (`ollama pull llama3.1` or any model you prefer).

```bash
npm install          # install all workspace dependencies
npm run dev          # builds the engine, starts the desktop app with hot reload
```

**Native module note:** `better-sqlite3` must match Electron's ABI. After a fresh
`npm install` (which fetches the plain-Node binary), run:

```bash
cd node_modules/better-sqlite3
npx prebuild-install --runtime=electron --target=33.4.11
```

(Re-run with `--runtime=node` if you want to execute engine code under plain Node,
e.g. for the smoke test.)

Sample CVs to try the app with are in `samples/cvs/`.

Other commands:

```bash
npm run typecheck    # typecheck all packages
npm run build        # production build (engine + desktop)
npm run dist         # build a Windows installer (packages/desktop/release)
```

## Repository layout

| Path | What it is |
|---|---|
| `packages/engine` | Core screening engine (TypeScript, headless-capable): parsing, keyword filtering, contact extraction, Ollama client, SMTP, SQLite, Excel export |
| `packages/desktop` | Electron app: main process (IPC ↔ engine), preload bridge, minimal React UI with dark/light mode |
| `docs/` | User guide, error-code reference, architecture |
| `samples/cvs/` | Generated sample CVs for testing |
