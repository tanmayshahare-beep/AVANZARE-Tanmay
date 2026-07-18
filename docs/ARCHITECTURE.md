# AVANZARE — Architecture

## Engine / UI split

The app is a two-package monorepo:

```
packages/engine    @avanzare/engine   — all real logic, plain Node.js/TypeScript
packages/desktop   @avanzare/desktop  — Electron shell + minimal React UI
```

The **engine** knows nothing about Electron. It exposes plain async functions
(`runScreening`, `runLlmAnalysis`, `sendDecisionEmails`, `testConnections`,
`exportApplications`, …) over a SQLite database and a profile store. This is what
makes the roadmap's headless/server mode cheap: a future CLI or Windows service can
drive the same engine with no UI attached, supervised by any process manager, while
the Electron app connects remotely.

The **desktop** package has three layers:

- `src/main` — Electron main process. Owns the engine instances (DB, profile store,
  logger) and exposes them over IPC. Every handler returns a uniform envelope
  `{ok:true,data} | {ok:false,error:{code,message,location}}` so renderer code never
  deals with thrown exceptions; every failure is logged with its `AVZ-*` code.
- `src/preload` — context-isolated bridge exposing a typed `window.avz` API.
- `src/renderer` — React UI. Screen flow:
  `Technical Setup → Job definition → Parsing progress → Rejection review →
  LLM analysis → Results`. The Technical Settings tab reuses the same Setup
  component. Dark/light theme via a `data-theme` attribute + CSS variables,
  defaulting to the OS preference, persisted in `localStorage`.

## Screening pipeline

1. **Resolve the source** into a list of CV files. A **local folder** is scanned
   recursively for `.pdf/.docx/.doc`. An **email inbox** (`sources/imap.ts`, via
   `imapflow` + `mailparser`) is searched by IMAP date range in the chosen mailbox/label;
   each message's first supported attachment is downloaded to a durable app folder
   (`userData/email-cvs/<run>/`, since those files become each application's `cv_path`),
   its `From` header is captured as a high-confidence contact hint, and its message-id is
   recorded so overlapping ranges never re-import (`imported_emails` table). CVs downloaded
   this way are app-created copies, so purging a candidate deletes the files too.
2. **Extract text** — PDF via `pdfjs-dist` (line breaks reconstructed from `hasEOL`),
   DOCX via `mammoth`, legacy DOC via `word-extractor`. A PDF with no text layer
   (scanned image) falls back to **OCR** when enabled: each page is rasterized with
   `@napi-rs/canvas` (prebuilt, no native build tools needed) and read by
   `tesseract.js`. Those heavy deps are imported lazily, so only scanned CVs pay
   for them. With OCR off, text-less PDFs are still rejected with `AVZ-PARSE-103`.
3. **Extract contact info** heuristically (first email-like token; phone-like digit
   runs; name = first plausible short line near the top, falling back to the file
   name) and **upsert into `candidates`** keyed by email. For email-sourced CVs the
   sender's address/name from the `From` header override the heuristics, so the
   applicant's email is essentially always known.
4. **Keyword match** — case-insensitive with word boundaries applied only next to
   alphanumeric keyword edges, so `java` ≠ `javascript` but `c++`/`.NET` work.
5. **Bucket** into tiers: `rejected` (missing a mandatory keyword), `mandatory`
   (all mandatory), `optional` (mandatory + ≥1 optional). Recruiter decisions later
   add `rescued`. Extracted CV text is stored on the application row so the LLM
   stage never re-parses files.
6. Concurrency is a simple `mapLimit` pool bounded by the profile's concurrency
   setting (LLM stage is additionally capped at 2 in-flight requests).

## LLM integration

Two providers behind one interface (`engine/src/llm/router.ts`), selected per
settings profile:

- **Ollama** — `/api/chat` with `stream:false` and a JSON-schema `format` of
  `{score: number(0-100), reasoning, plus requirement-tag and formal-education
  fields}` — structured output, not prose parsing. The score uses a 0–100 rubric
  weighted toward role alignment, with formal education (10th/12th marks, university
  CGPA, highest degree, and an education sub-score) folded in. The base URL is a
  profile setting, so "LLM on another machine" is just a different URL. Model
  discovery uses `/api/tags`. CV text is truncated to ~14k characters to respect
  small context windows.
- **Claude API (Anthropic)** — the official `@anthropic-ai/sdk`, default model
  `claude-opus-4-8`. Structured outputs via `output_config.format` (json_schema),
  with a prompt-for-JSON fallback for models that don't support it; model
  discovery via `/v1/models`. The SDK's typed errors map onto `AVZ-LLM-*` codes
  (auth → 206, rate limit → 207). The API key lives in the profile, encrypted at
  rest with `safeStorage` like the SMTP password.

## Data storage & privacy

All state lives in Electron's per-user data dir:

- `avanzare.sqlite` — `candidates` (persistent talent DB, deduped by email),
  `jobs`, `applications` (tier, status, score, reasoning, extracted text),
  `email_log` (every send attempt with status and error code).
- `profiles/*.profile.json` — connection/runtime settings. `smtp.pass` is encrypted
  with Electron `safeStorage` before hitting disk.
- `logs/avanzare.log` — JSON-lines log.
- `email-cvs/<run>/` — CVs downloaded from an email source (app-created copies;
  removed when the candidate is purged).

Privacy notes: applicant contact data is retained across runs by design (talent
pool). The Candidates tab provides per-candidate **purge** (candidate + applications
+ email log) to honor erasure requests. Rejection/acceptance emails are never sent
automatically — a recruiter confirms every batch, which keeps a human in the loop
for automated-decision compliance.

## Error framework

`AppError` (engine `errors.ts`) carries `{code, location, detail}`; the code
registry is the single source of truth and is mirrored in
[ERROR_CODES.md](ERROR_CODES.md). `asAppError` wraps unknown failures without
clobbering existing codes. Batch operations (parsing, LLM scoring, email sends)
collect per-item errors and continue, so one bad CV never aborts a run.

## Known limitations / next steps

- OCR language data is fetched by `tesseract.js` on first use; a fully offline
  install still needs the traineddata/core bundled locally (packaging follow-up).
- Cloud CV sources (Drive/OneDrive/S3) are stubbed behind `AVZ-SRC-403`; an IMAP
  **email inbox** is supported as a network source in the meantime.
- Candidates without an email cannot be deduplicated across runs.
- Headless CLI/service mode is designed for (engine is UI-free) but not yet shipped.
