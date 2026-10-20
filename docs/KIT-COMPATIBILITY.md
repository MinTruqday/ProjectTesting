# Codex Testing Kit compatibility

The upstream kit is kept under `kit/` and is not edited by project profiles. Its `.agents/`, `plans/`, and `prompt_templates/` are copied to the station root so Codex can discover the rules and skills. `kit/` remains the upstream checkout.

| Kit capability | QA Station use | Status |
|---|---|---|
| Requirements from website | `qa recon` output → human/AI review | Pending recon command |
| Manual RBT cases | `qa design` draft YAML | Pending generator |
| Test/combinatorial data | `qa data ensure` / cross-module design | Pending |
| Locator generation/healing | `qa verify-locators` and AI queue | Pending |
| UI debugging | Triage queue with evidence/log context | Pending |
| Flaky analysis | Nightly repeated-run history | Pending |
| Swagger API tests | API contract plugin | Pending |

## All upstream skills

The 26 upstream skills are grouped by their intended station step. AI uses these for design/triage; the runner remains deterministic.

| Skill | Station step |
|---|---|
| `analyze-flaky-tests`, `flaky-test-analyzer` | `qa nightly` / flaky analysis queue |
| `analyze-requirement-document`, `requirements-analyzer` | Requirement intake and source mapping |
| `fetch-jira-requirements`, `jira-integration`, `import-test-results-xray` | Optional Jira/Xray adapter; external writes stay disabled |
| `framework-architect`, `generate-automation-framework` | Core/plugin architecture review |
| `generate-api-tests-from-swagger` | API contract plugin |
| `generate-application-test-plan`, `generate-cross-module-test-plan` | Test plan and cross-module matrix |
| `generate-automation-from-testcases`, `generate-automation-from-ui-flow` | YAML case automation / recon proposals |
| `generate-combinatorial-test-data`, `generate-test-data`, `test-data-generator` | Data design and pairwise coverage |
| `generate-locator`, `locator-healer-agent`, `smart-locator-agent` | Locator report and healing queue |
| `generate-manual-testcases-rbt`, `rbt-manual-testing` | Manual RBT case design |
| `generate-requirements-from-website`, `generate-testcases-from-requirements` | Recon-derived requirement and draft cases |
| `qa-automation-engineer` | General QA implementation review |
| `ui-debug-agent` | Unclassified UI failure triage |

The HIS profile carries the v7.1 prompt and supplemental query under its project folder. v7.1 requirements carried into this shared system include per-case JSONL-first recording, per-case Excel upsert, daily report sheet, banned phrase scan, and the three-job schedule model. Scheduling is intentionally not activated for any project until that project's gates and acceptance checks pass.
