# AVANZARE — Error code reference

Every failure in AVANZARE carries a stable code of the form `AVZ-<MODULE>-<NNN>`,
plus the **location** where it occurred (the file being parsed, the endpoint URL,
the profile name, …). Errors surface in the UI toast/tables and are also written to
`logs/avanzare.log` as JSON lines with `code` and `location` fields.

The authoritative registry lives in `packages/engine/src/errors.ts`; this document
must be kept in sync with it.

## PARSE 1xx — document text extraction

| Code | Meaning | Typical cause | Remedy |
|---|---|---|---|
| AVZ-PARSE-101 | File could not be read from disk | File locked, deleted mid-run, or permissions | Check the file exists and is readable; re-run |
| AVZ-PARSE-102 | PDF is corrupt or could not be parsed | Truncated download, malformed PDF | Re-export or re-request the CV |
| AVZ-PARSE-103 | PDF has no extractable text layer | Scanned image PDF; OCR is not yet enabled | Ask for a text-based CV, or convert with an OCR tool |
| AVZ-PARSE-104 | Unsupported file type | Only `.pdf`, `.docx`, `.doc` are screened | Convert the file |
| AVZ-PARSE-105 | Document parsed but contained no text | Empty or image-only document | Same as 103 |
| AVZ-PARSE-106 | Word document could not be parsed | Corrupt or password-protected file | Remove protection / re-export |

## LLM 2xx — Ollama analysis

| Code | Meaning | Typical cause | Remedy |
|---|---|---|---|
| AVZ-LLM-201 | Ollama endpoint unreachable | Ollama not running; wrong URL/port; firewall | Start Ollama (`ollama serve`); verify the base URL in Technical Settings; on a remote machine, ensure Ollama listens on `0.0.0.0` (`OLLAMA_HOST`) |
| AVZ-LLM-202 | Model not available on the endpoint | Model name typo or not pulled | `ollama pull <model>` on the LLM machine, then "Load models" |
| AVZ-LLM-203 | LLM response could not be parsed as `{score, reasoning}` | Model ignored the JSON schema (rare) | Retry; prefer an instruction-tuned model |
| AVZ-LLM-204 | LLM request timed out | Model too large for the hardware; CV very long | Increase timeout, use a smaller model |
| AVZ-LLM-205 | Analysis failed for one candidate | Wraps any per-CV failure during scoring | See the message; other candidates are unaffected |

## MAIL 3xx — SMTP / notifications

| Code | Meaning | Typical cause | Remedy |
|---|---|---|---|
| AVZ-MAIL-301 | Could not connect to SMTP server | Wrong host/port, TLS mismatch, firewall | Verify host/port; try toggling the TLS checkbox (465 = TLS on, 587 = off/STARTTLS) |
| AVZ-MAIL-302 | SMTP authentication failed | Wrong username/password; app-password required | Check credentials; Gmail/Outlook need an app password |
| AVZ-MAIL-303 | Email send failed | Recipient rejected, rate limiting | See message; failed recipients are listed in the send report and can be retried |
| AVZ-MAIL-304 | Candidate has no email address on record | CV contained no email | Informational — decision is recorded, nothing sent |
| AVZ-MAIL-305 | Email template invalid | Unknown `{{placeholder}}` in a template | Only `{{name}}` and `{{job_title}}` are supported |

## SRC 4xx — CV sources

| Code | Meaning | Typical cause | Remedy |
|---|---|---|---|
| AVZ-SRC-401 | Source path does not exist / not accessible | Folder moved, network drive offline | Fix the path in Technical Settings |
| AVZ-SRC-402 | No CV files found at the source | Empty folder or wrong folder | Point to the folder that contains the resumes |
| AVZ-SRC-403 | Cloud source not configured / not yet supported | Cloud selected | Use a local folder for now |

## CFG 5xx — settings profiles

| Code | Meaning | Typical cause | Remedy |
|---|---|---|---|
| AVZ-CFG-501 | Profile not found | Profile deleted or renamed outside the app | Recreate or pick another profile |
| AVZ-CFG-502 | Profile file invalid or corrupt | Hand-edited JSON | Fix or delete the file under `profiles/` |
| AVZ-CFG-503 | Profile could not be saved/deleted | Disk permissions | Check write access to the app data folder |
| AVZ-CFG-504 | Profile failed validation | Missing/invalid fields | The message lists every problem field |

## DB 6xx — local database

| Code | Meaning | Typical cause | Remedy |
|---|---|---|---|
| AVZ-DB-601 | Database could not be opened | Locked by another process, disk full | Close other instances; check disk space |
| AVZ-DB-602 | Schema migration failed | Corrupt database file | Restore from backup or delete `avanzare.sqlite` (loses history) |
| AVZ-DB-603 | Query failed | Unexpected data state | See message; report if reproducible |

## EXP 7xx — exports

| Code | Meaning | Typical cause | Remedy |
|---|---|---|---|
| AVZ-EXP-701 | Excel export failed | Target file open in Excel, disk permissions | Close the file in Excel and retry |
| AVZ-EXP-702 | Configured export folder missing / not writable | Folder in Technical Settings was moved or deleted | Fix or clear the export folder setting |

## APP 9xx — catch-all

| Code | Meaning |
|---|---|
| AVZ-APP-901 | Unexpected internal error — the message and log contain the underlying cause and location |
