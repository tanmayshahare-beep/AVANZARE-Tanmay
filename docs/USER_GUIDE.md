# AVANZARE — User guide

AVANZARE screens a folder of resumes (PDF, DOCX, DOC) against keywords you define,
records every applicant's contact info in a local candidate database, and uses a
local LLM (via [Ollama](https://ollama.com)) to score the surviving CVs against your
job description. Emails to applicants are always sent under your control — nothing
is emailed without an explicit confirmation.

## 1. Technical Setup (first launch)

On first launch — or whenever no profile is marked "use automatically" — the
**Technical Setup** screen appears before anything else. It collects:

- **CV source** — the local folder containing the resumes. Subfolders are included.
  (Cloud sources are planned; the selector is present but disabled.)
- **LLM (Ollama)** — the base URL of the Ollama server. `http://localhost:11434` for
  the same machine, or e.g. `http://192.168.1.50:11434` for another machine on your
  network. Click **Load models** to fill the model dropdown from the server.
- **Email (SMTP)** — your outgoing mail server and credentials, plus the from-address.
- **Email templates** — subject and body for rejection and acceptance mails.
  `{{name}}` and `{{job_title}}` are replaced per candidate. "Acceptance" should be
  worded as an invitation to the next stage, not a final offer.
- **Exports** — an optional default folder for Excel exports. The save dialog still
  lets you change the location each time. Pointing this at a OneDrive / Google Drive /
  Dropbox *synced* folder means every export is uploaded to the cloud automatically;
  direct API upload to cloud storage will ship together with the cloud CV sources.
- **Runtime** — how many CVs are processed in parallel. Keep this low (2–4) if the
  machine runs other workloads.

**Test connections** checks all three targets independently and reports failures with
their error codes (see [ERROR_CODES.md](ERROR_CODES.md)).

Tick **"Save this settings profile"**, give it a name, and you won't have to enter
any of this again. You can save multiple named profiles (e.g. one per client) and
mark one **"use automatically"** to skip the setup screen entirely on launch.
Everything can be revisited later under the **Technical Settings** tab.

The SMTP password is encrypted at rest using Windows credential protection
(Electron `safeStorage`).

## 2. Defining a screening job

- **Job title** — used in emails and exports.
- **Mandatory keywords** (comma-separated) — a CV that misses *any* of them is
  rejected. Matching is case-insensitive and word-aware: `java` will not match
  `JavaScript`; symbols work (`C++`, `.NET`).
- **Additional keywords** — nice-to-haves. CVs that have all mandatory keywords plus
  at least one of these are tagged **mandatory + optional**; the rest of the accepted
  CVs are tagged **mandatory only**.
- **Job description for the LLM** — describe the role in detail: responsibilities,
  must-have experience, seniority, team context. The app nudges you if the
  description is very short, because ranking quality depends directly on it.

**Start parsing** reads every CV, extracts its text and the applicant's name, email
and phone, and stores the contact info in the persistent candidate database
(deduplicated by email across runs).

## 3. Rejection review

The first thing you see after parsing is the table of applicants that failed the
mandatory keywords: checkbox, name, contact info, and a link that opens the original
PDF/Word file. A select-all checkbox sits in the header.

- **All rows start checked.** Checked = confirmed rejection.
- **Uncheck** an applicant to *rescue* them: they skip the rejection email and are
  sent to the LLM analysis together with the accepted CVs (tagged "rescued").
- Applicants whose CV contained no email address show a **"no email found"** badge —
  they can still be marked rejected, but no mail is sent (logged as `AVZ-MAIL-304`).
- **Send rejection emails to selected (N) & continue** asks for confirmation, sends,
  and shows a sent/failed/no-email report. **Continue without sending** skips the
  emails but still records the decisions.
- Files that could not be parsed at all are listed underneath with their error codes.

## 4. LLM analysis and results

Accepted CVs (both tiers) and rescued CVs are scored by the LLM against your job
description. The results table is sorted by **affinity score (0–10)** and shows each
candidate's tier, contact info, CV link, and the LLM's reasoning paragraph (click to
expand). Scores and reasoning come from the model as structured JSON, so they are
reliable even with small local models.

- **All rows start unchecked.** Check the candidates you want to advance.
- **Send emails (N acceptances, M rejections)** — checked candidates receive the
  acceptance template, unchecked the rejection template. Because *everyone* in the
  table is emailed, a confirmation dialog restates both counts before sending.
- A full send report (sent / failed with error codes / no email) is shown after.

## 5. Results tab

The **Results** tab always shows the most recent screening, read directly from the
local database — switching tabs mid-run, or even closing and reopening the app,
never loses it. It lists every application with its tier, LLM score and reasoning,
decision status, and a link to the CV, and can be exported to Excel at any time.

## 6. Candidate database

The **Candidates** tab lists every applicant ever parsed, with first/last-seen dates
and their most recent CV. This is personal data stored on the machine — the
**Delete** button on each row permanently removes a candidate and all their
application history (use it for GDPR/data-deletion requests).

## 6. Exporting

Every table — rejection review, LLM results, candidate database — has an
**Export to Excel** button producing an `.xlsx` including the current checkbox
decisions, tiers, scores, full reasoning text, and clickable links to the CV files.

## 7. Where data lives

Everything is stored locally under your user profile
(`%APPDATA%/avanzare-desktop/` — exact path shown in the log on startup):

| File | Contents |
|---|---|
| `avanzare.sqlite` | candidates, jobs, applications, email log |
| `profiles/*.profile.json` | settings profiles (SMTP password encrypted) |
| `logs/avanzare.log` | structured log; every error appears here with its `AVZ-*` code and location |
