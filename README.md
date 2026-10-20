# QA Station

Reusable Junior Tester workbench for web and REST projects. The shared core lives in `core/`; each application is configured independently under `projects/`. HIS Việt Mỹ is a sample profile, not a core dependency.

## Quick start

```bash
npm install
npm run qa -- doctor
npm run qa -- selftest
npm run qa -- init my-web --url http://localhost:3000
npm run qa -- env --project my-web
npm run qa -- ready --project my-web
```

New projects are created with `safety: read-only`. Add a project `.env.app` yourself; it is ignored by Git. Do not put real patient data in test cases or evidence.

## Main commands

`qa doctor`, `qa selftest`, `qa init`, `qa env`, `qa ready`, `qa status`, `qa run --suite smoke [--resume]`, `qa record`, `qa upsert --id <ID>`, and `qa daily_report` are implemented in the first runnable slice. Runs take a per-project lock; `--resume` continues a stopped run and skips IDs already journaled under that run ID. Run `qa help` for exact syntax. Commands that need a project accept `--project <name>`; otherwise `QA_PROJECT` must identify one. `qa init` creates a generic read-only smoke case; it does not infer business behavior.

Each result is appended to `projects/<name>/runs/<date>/results.jsonl` first, then committed to `qa.db` (SQLite), the source of truth. Excel, report, and dashboard are generated views. A blocked gate never starts the dependent run.

## Current maturity

The project is a usable foundation, not yet the complete 22-check production system described in the proposal. The implementation matrix and remaining work are in `docs/ROADMAP.md`; `qa accept` reports the checks that are implemented versus pending.
