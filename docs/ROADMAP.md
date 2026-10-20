# Delivery status and roadmap

Status is based on code present in this repository, not on the proposal's target state.

| Stage | Status | Evidence / remaining work |
|---|---|---|
| GD0 foundation | In progress | TypeScript CLI, profiles, doctor and deterministic selftest are present. The 26 kit skills are mapped in `docs/KIT-COMPATIBILITY.md`; their workflows are not all automated. |
| GD1 gates and results | Partial | Env/host/health gates, JSONL recovery journal, SQLite store, workbook upsert/report, actual-text redaction, per-project run lock and `qa run --resume` are present. Synthetic lock/resume selftests pass; project-level interrupted-run acceptance, auth adapters and broad secret-scanning incidents remain. |
| GD2 project checks | Partial | Generic Playwright YAML runner and failure screenshots are present. Recon, locator verification and YAML case generation remain; project selectors/specs are not inferred automatically yet. |
| GD3 daily operations | Partial | Bug signature deduplication, hit counts and two-pass verification are implemented with synthetic selftest. Impact selection, triage, log correlation, scheduling/watchdog/housekeeping and five-day soak remain. |
| GD4 dashboard | Partial | Static dashboard with filters, evidence links and basic counts is present. Full eight-view dashboard and Excel parity acceptance remain. |
| GD5 second project proof | Pending | Lumina is represented only as a read-only template; internal network access and profile facts are unverified. |
| GD6 plugins | Pending | API contract, axe, baseline, mock, read-only DB, performance and notifications need separate selftests. |

## Acceptance matrix

`qa accept` currently checks the runnable foundations (doctor, selftest, default safety). The 22 project-level acceptance checks still need end-to-end verification; passing the synthetic selftest is not a project signoff.

Next order: lock/resume and auth adapters; complete per-project gate checks; bug lifecycle, triage and impact mapping; scheduling/watchdog/housekeeping; dashboard parity; then prove a second project without editing `core/`.
