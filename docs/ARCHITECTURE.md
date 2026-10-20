# Architecture

The system has four layers:

1. `projects/<name>/`: URL, allowlist, role/environment adapters, business rules, thresholds, selectors, pages, YAML cases, test data and run evidence.
2. `core/checks/`: reusable browser/API checks. No project names or business rules belong here.
3. `core/` execution and persistence: CLI, gates, JSONL write-ahead journal, SQLite source of truth, and Excel/report/dashboard exports.
4. Safety and operations: allowlist enforcement, secret redaction, blocked gates, lock/resume, housekeeping and scheduled entry points.

The portable contract is `project.yaml`. New profiles start read-only. A write-capable suite requires an explicit project safety level and test data ownership declaration. `results.jsonl` is append-only so workbook export can be rebuilt after a failure.

## Execution boundaries

- Browser interaction is via Playwright. Selectors should use labels/roles and be stored in project page objects.
- Login strategies are adapters. Passwords are read from environment variables named in the profile; the core never guesses or resets credentials.
- `local`, `shared-dev`, and `read-only` govern whether a suite can mutate data. The current CLI enforces read-only at the gate; broader mutation adapters are roadmap items.
- Only hosts in `allow_hosts` may be reached by QA-owned HTTP checks.
- S3/MinIO test data should use an isolated bucket/prefix and a scheduled TTL cleanup. No project currently gets a cleanup schedule implicitly.

## Upstream Kit

`kit/` is the codex-testing-kit reference clone. Its skills, rules and plans are consulted by humans/agents; the runner translates stable practices into executable checks over time. Update it with `qa kit-update` only after that command is implemented and selftest passes.
