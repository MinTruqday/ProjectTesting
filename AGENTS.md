# QA Station

This is a reusable QA toolkit for web applications and REST APIs. Project-specific values belong under `projects/<project>/`; generic execution logic belongs under `core/`.

## Safety

- A new project defaults to `read-only`. A profile must explicitly declare `local` or `shared-dev` before write-capable tests can run.
- Network requests must match the project's `allow_hosts` list. Never infer credentials or print secret values.
- Missing credentials, failed health checks, or failed login gates produce `BLOCKED`; do not continue dependent tests.
- Use synthetic data with the `auto_` prefix. Cleanup may only target IDs listed in that project's `data/created.json`.
- Failures need evidence. Never report a run that did not happen as executed.
- Keep the `kit/` checkout as an upstream reference; project-specific work does not modify it.

## Development

- TypeScript core, profile-driven adapters, and YAML test cases are the intended interfaces.
- Keep changes under `core/` project-agnostic. A second project profile is the portability check.
- Upstream skill/rule references are available in `.agents/` and `kit/`; use them when authoring cases or browser code.
- The v7.1 export conventions are compatibility requirements: append a result first, upsert after each case, keep `Báo cáo ngày`, and scan banned phrases before saving.
- Do not commit `.env`, auth state, local run artifacts, or patient information.
- Consult `docs/ARCHITECTURE.md` and `docs/ROADMAP.md` before extending command behavior.
