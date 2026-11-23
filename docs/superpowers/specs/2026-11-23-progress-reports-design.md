# Progress reports (PDF) — design

Status: built 2026-11-23. Implements the export in design doc §5.9.2.

## Intent

A therapist gives a family, an insurer or a records system a formatted summary of one patient's activity over a date range, with a short summary in the therapist's own words.

## Decisions

- **The therapist types a summary** (up to 2,000 characters). It is printed as written. (Owner's decision.)
- **The browser makes the PDF.** The report is a print-styled page; "Print or save as PDF" opens the print window. Server-side PDF libraries handle Hebrew and right-to-left text poorly; the browser already renders both.
- **A report is kept as issued.** Its figures are worked out once and stored with it (`app.progress_report.data`). Nothing but the "shared with the family" switch can change afterwards; reports are never deleted. A reprint is always identical to what was handed over.
- **Nothing is emailed** (invariant 7). The therapist hands the file over, or shares the report into the parent portal, where the family can read and print it.
- **Two versions.** "Insurance or records" carries the clinic's licence number and a signature line. "The family" leaves both out and heads the summary as a note from the therapist. Each report has its own language (English or Hebrew), independent of the app's.
- **Wording follows §11.6.** The report records participation and how results changed against the child's own earlier sessions. It states no norms and no conclusions, and says so in its footer.
- **Clinics gain letterhead details**: address, phone and licence number, edited by a platform admin on the clinic form.

## Approaches considered

1. Print-styled page and the browser's own PDF — chosen (Hebrew, no new dependency, what is on screen is what prints).
2. A PDF library on the server — rejected: right-to-left shaping and bidi are unreliable, and fonts would have to be bundled.
3. A headless browser on the server — rejected for now: heavy for the host, and only needed if reports must be generated without a person present.

## What a report holds

Clinic letterhead; patient name and date of birth; period; author; issue date; the summary; totals (sessions, minutes, days active, clinic/home split, planned sessions done and missed); each game-based activity with sessions, average accuracy and difficulty at the start and end of the period; a chart of scores against the child's own starting level with one plain sentence; difficulty changes.

Only counted results are included, as on Progress. The baseline comes from the child's earliest sessions, which may predate the period.

## Where it lives

- Migration `0042_progress_reports.sql`: `app.progress_report` (RLS: staff who can see the patient; the family once shared), clinic letterhead columns.
- API `apps/api/src/modules/patients/progress-reports.ts`: issue, list, read (audited), share; parent reads under `/v1/parent`.
- Web: `routes/patients/reports.tsx` (card on the Progress tab, new-report form, report page), `routes/reports/ReportDocument.tsx` (the sheet), `routes/parent/report.tsx`, print rules in `app.css`.

## Not included

- A clinic logo on the letterhead.
- Editing clinic details from the organisation admin's "Manage" screens (platform admin only for now).
- Withdrawing an issued report (it can be un-shared, not deleted).
- Recording in the audit log when a parent opens a shared report.
