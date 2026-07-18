# AVANZARE — User guide

AVANZARE screens a folder of resumes (PDF, DOCX, DOC) against keywords you define,
records every applicant's contact info in a local candidate database, and uses a
local LLM (via [Ollama](https://ollama.com)) to score the surviving CVs against your
job description. Emails to applicants are always sent under your control — nothing
is emailed without an explicit confirmation.

## 1. Technical Setup (first launch)

On first launch — or whenever no profile is marked "use automatically" — the
**Technical Setup** screen appears before anything else. It collects:

- **CV source** — where the resumes come from:
  - **Local folder** — the folder containing the resumes (subfolders included).
  - **Email inbox (IMAP)** — pull applications straight from a mailbox. Point it at a
    **dedicated hiring inbox** (or, on a shared address, a **dedicated label/folder**),
    and enter the IMAP host/port, your address, an **app password** (Gmail/Outlook need
    2FA + an app password, and IMAP enabled), and the mailbox/label. Each applicant is
    assumed to send **one CV attachment**; their email address is taken from the message
    itself. The **date range** of applications to import is chosen per screening on the
    job screen. The app password is stored encrypted on this machine.
  - **Cloud** — planned; the selector is present but disabled.
- **OCR** — when enabled (the default), scanned / image-only PDFs that have no text
  layer are read with optical character recognition instead of being rejected
  (`AVZ-PARSE-103`). OCR only runs on the CVs that actually need it, but it is
  noticeably slower than normal text extraction. Set the **language code(s)** to
  match your CVs (Tesseract codes, e.g. `eng`, `deu`, or `eng+fra` for mixed).
- **LLM** — pick a provider:
  - **Ollama (local / self-hosted)** — free and private; CVs never leave your network.
    Enter the server's base URL: `http://localhost:11434` for the same machine, or e.g.
    `http://192.168.1.50:11434` for another machine on your network.
  - **Claude API (Anthropic)** — for teams that already have API credits: paste an API
    key from console.anthropic.com. The default model is `claude-opus-4-8`. The key is
    stored encrypted on this machine. Note that with this option CV contents are sent
    to Anthropic's API for scoring.

  Either way, click **Load models** to fill the model dropdown from the provider.
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
  `JavaScript`; symbols work (`C++`, `.NET`). Each keyword gets an
  **importance from 1 (nice) to 5 (critical)**, set on the chip that appears as
  you type. Importance drives the *keyword score*: a matched keyword earns its
  importance as marks, a missing one earns 0, and the score is the average
  across all mandatory keywords — out of 5.
- **Additional keywords** — nice-to-haves. CVs that have all mandatory keywords plus
  at least one of these are tagged **mandatory + optional**; the rest of the accepted
  CVs are tagged **mandatory only**.
- **Keyword synonyms** (optional) — for any keyword you can list alternative spellings
  that should *also* count as a match, so "AWS" isn't rejected because the CV wrote
  "Amazon Web Services". The keyword itself always matches, and it's the original
  keyword that's recorded — so tiers, scores and the dashboard are unaffected by which
  spelling actually appeared. (The keyword-impact dashboard is the natural place to
  spot a keyword that's rejecting too many people because it needs synonyms.)
- **Requirement tags** (optional, all three) — structured requirements assessed by
  the LLM rather than string matching, because "5–8 years of experience" and
  "publications in NLP" can't be judged by keyword search:
  - **Certifications** — exact certification names, comma-separated; *all* are
    required (e.g. `AWS Certified Solutions Architect, PMP`).
  - **Experience range** — minimum and/or maximum years of relevant experience;
    either side can be left open.
  - **Research publications** — the specific field the applicant must have
    publications in (e.g. `machine learning`).

  Each analyzed candidate gets a ✓/✗ verdict per tag (plus the LLM's estimate of
  their years of experience) in a **Requirements** column on the results table and
  in the Excel export, and the tags are weighed into the affinity score.
- **Hiring target** (optional) — the number of candidates you intend to hire. If
  fewer applicants clear the mandatory keywords than this number, the rejection
  screen tells you exactly how many short you are, so you can rescue near-misses to
  fill the gap. On the results screen it shows a live *selected / target* count.
  It is a guide, not a hard cap — you can still accept more or fewer.
- **Job description for the LLM** — describe the role in detail: responsibilities,
  must-have experience, seniority, team context. The app nudges you if the
  description is very short, because ranking quality depends directly on it.

When the CV source is an **email inbox**, the job screen shows a **date range** at the
top — only applications received within it are imported, and messages already imported
on a previous run are skipped, so overlapping ranges never produce duplicates.

**Start parsing** reads every CV (for an email source, it first downloads the
attachments from the mailbox), extracts its text and the applicant's name, email and
phone, and stores the contact info in the persistent candidate database (deduplicated
by email across runs).

## 3. Rejection review

The first thing you see after parsing is the table of applicants that failed the
mandatory keywords: checkbox, name, contact info, their **keyword score /5**, and a
link that opens the original PDF/Word file. A select-all checkbox sits in the
header. The table is sorted by keyword score, best first — an applicant at 3.8/5
missed only low-importance keywords and is a prime rescue candidate, while 0.5/5
means they matched almost nothing important.

- **All rows start checked.** Checked = confirmed rejection.
- **Uncheck** an applicant to *rescue* them: they skip the rejection email and are
  sent to the LLM analysis together with the accepted CVs (tagged "rescued").
- Applicants whose CV contained no email address show a **"no email found"** badge —
  they can still be marked rejected, but no mail is sent (logged as `AVZ-MAIL-304`).
- Files that could not be parsed at all are listed underneath with their error codes.
- If you set a **hiring target**, a banner at the top shows how many candidates
  passed the keyword filter and, if that's under target, how many more you need. The
  count updates live as you rescue (uncheck) applicants into the analysis pool.

Working inside the table:

- **Click a name** to open the in-app CV previewer: a side panel with the parsed
  text of the resume, plus a button for the original PDF/Word file — review CVs and
  manage checkboxes without switching windows.
- **✎ next to a name** edits the contact info inline. Extraction is heuristic, so a
  wrong name or missing email can be fixed in place instead of re-uploading; every
  edit is recorded in the audit trail.
- **"↺ applied to N other jobs"** expands the candidate's cross-job history: past
  applications with dates, outcomes and LLM scores — so nobody re-shortlists a
  candidate rejected last month, or overlooks a proven strong applicant. Stored
  internal notes appear beneath.
- **Add note to selected** stores one internal note on every selected candidate
  (e.g. "passed mandatory but lacked leadership — keep for junior roles").

Sending is a two-step safety flow: **Send rejection emails to selected (N)…** opens
a preview modal showing the rendered emails for the first recipients; subject and
body can be tweaked *for this send only*. After **Approve & send**, a **30-second
countdown** runs with a Cancel button (and "Send now" to skip the wait) before
anything actually leaves. **Continue without sending** records decisions with no
emails.

## 4. LLM analysis and results

Accepted CVs (both tiers) and rescued CVs are scored by the LLM against your job
description. The results table is sorted by **affinity score (0–100)** and shows each
candidate's tier, contact info, CV link, an **Education** column, ✓/✗ verdicts for any
requirement tags you set (certifications / experience range / publications), and the
LLM's reasoning paragraph (click to expand). Scores, verdicts and education come from
the model as structured JSON, so they are reliable even with small local models.

- The **score is out of 100** and is deliberately spread across the full range so
  strong and weak candidates separate clearly, rewarding genuine alignment with the
  role. Formal education is weighed in: the model extracts and rates 10th- and
  12th-grade marks, university CGPA and the highest degree, shown in the **Education**
  column (e.g. `B.Tech · CGPA 8.7/10 · 12th 91%`) and broken out in the Excel export.
- **All rows start unchecked.** Check the candidates you want to advance. If you set a
  hiring target, a *selected / target* count is shown next to the send button.
- **Send emails (N acceptances, M rejections)** — checked candidates receive the
  acceptance template, unchecked the rejection template. Because *everyone* in the
  table is emailed, the send goes through the same preview modal (both templates
  editable per send, first recipients rendered) and the 30-second undo countdown.
- A full send report (sent / failed with error codes / no email) is shown after.
- The in-app CV previewer, inline contact editing, cross-job history and bulk
  notes work here exactly as on the rejection screen.

## 5. Results tab & job performance dashboard

The **Results** tab shows any past screening (most recent by default — pick any run
from the dropdown), read directly from the local database: switching tabs mid-run,
or even closing and reopening the app, never loses it.

Above the applications table sits the **job performance dashboard**:

- **Hiring funnel** — applied → rejected at keyword stage (with rescues) →
  analyzed by LLM → accepted / rejected totals.
- **Mandatory keyword impact** — how many keyword-stage rejects were missing each
  mandatory keyword. A keyword that rejects nearly everyone may be phrased too
  narrowly ("Amazon Web Services" vs "AWS").
- **Optional keywords vs LLM score** — average score of analyzed CVs with vs
  without each optional keyword; keywords that clearly correlate with high scores
  are candidates for promotion to mandatory in the next round.

## 6. Audit trail

The **Audit** tab records every consequential action with a timestamp and the OS
user who performed it: screening runs, every email sent (including which CV file
and SHA-256 content hash the decision was based on), contact edits, notes, tier
changes (rescues), and candidate purges. The Excel export contains the complete
history — built for GDPR/EEOC discovery requests.

## 7. Candidate database

The **Candidates** tab lists every applicant ever parsed, with first/last-seen dates,
their internal notes, expandable application history, and their most recent CV.
Contact info is editable inline, and notes can be added in bulk to selected
candidates.

**Search** the whole talent pool from the box at the top: it matches against every
stored CV's full text (and candidate names) across *all* past runs — so "find
everyone who mentions Kubernetes and Terraform" is one query, with the matching
passage shown for each hit. Multiple words are combined (all must appear). It's a
fast way to source candidates from earlier openings instead of re-screening a folder. This is personal data stored on the machine — the **Delete** button on
each row permanently removes a candidate and all their application history (use it
for GDPR/data-deletion requests; the purge itself is recorded in the audit trail).

## 8. Exporting

Every table — rejection review, LLM results, candidate database, audit trail — has
an **Export to Excel** button producing an `.xlsx` including the current checkbox
decisions, tiers, scores, full reasoning text, notes, and clickable links to the CV
files.

## 9. Where data lives

Everything is stored locally under your user profile
(`%APPDATA%/avanzare-desktop/` — exact path shown in the log on startup):

| File | Contents |
|---|---|
| `avanzare.sqlite` | candidates, jobs, applications, email log |
| `profiles/*.profile.json` | settings profiles (SMTP password encrypted) |
| `logs/avanzare.log` | structured log; every error appears here with its `AVZ-*` code and location |
