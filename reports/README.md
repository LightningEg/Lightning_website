# Website reports

Website audits and reviews; current operator instructions live in
[the payment runbook](../docs/payment-operations.md).

| Report | Review date | Former path |
| --- | --- | --- |
| [Website audit against guideline 3.6 · 2026-10-03](2026-10-03-website-guideline/report.md) | 2026-10-03 | `audit/2026-10-03-website-audit.md` |
| [Marketplace and account flow audit — 24 October 2026](2026-10-24-marketplace-flow/report.md) | 2026-10-24 | `docs/audits/marketplace-flow-2026-10-24.md` |
| [End-to-end workflow re-audit — 2026-10-25](2026-10-25-marketplace-workflow/report.md) | 2026-10-25 | `docs/audits/marketplace-workflow-2026-10-25.md` |

## Create and maintain a report

Use `reports/YYYY-MM-DD-subject/report.md` and an adjacent `evidence/` directory.
Start from [the report template](../templates/report.md). Record the reviewed
commit, scope, method, findings, evidence, limits and follow-up issue codes.
Evidence contains only dummy/sample data. Reproduction scripts find the repo root
from their own location and document the command to run from the repo root.

Preserve the original assessment. Append dated follow-ups with verification
references; do not silently turn an old verdict into a current-status claim.
Every actionable finding links to an active issue. Before deleting a finished
issue, replace report/feedback links with a commit-pinned copy of the issue,
resolution commit or regression test. Keep issue codes and old audit IDs so
history remains searchable. Register each new report in this catalogue.

Old paths were migrated on 2026-10-26; the IDs below identify the same reports.
Use Git history for the original layout. Existing assessments and evidence are
preserved; a folder migration does not revalidate their findings.

[App reports](https://github.com/LightningEg/Lightning/blob/main/reports/README.md) cover the application and shared reviews.
