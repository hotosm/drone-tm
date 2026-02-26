# AGENTS.md

Machine-readable operating guidance for AI coding agents in **drone-tm**.

Project: **drone-tm**
Accountability: human maintainers are responsible for all merged changes.

---

# 1) Current Architecture (Authoritative)

Drone-TM is currently split into:

- FastAPI backend
- React + Vite frontend
- Shared/backend workspace packages (notably `drone-flightplan`)
- Docker Compose-based local integration environment

Primary active paths:

- `src/backend/app/`
- `src/backend/tests/`
- `src/backend/packages/drone-flightplan/`
- `src/frontend/src/`
- `docs/decisions/`

Secondary/legacy path (edit only when task requires it):

- `src/qfield-plugin/`

---

# 2) Required Reading Order

Before non-trivial changes:

1. `docs/decisions/README.md`
2. Relevant ADRs in `docs/decisions/`

If ADRs conflict with newer accepted direction in code, follow current implementation direction and document assumptions in PR notes.

---

# 3) Agent Workflow Contract

Use this execution loop:

1. Discover
   - Inspect current code paths first.
   - Prefer existing patterns over inventing new ones.
2. Plan
   - Keep edits minimal and task-scoped.
   - Identify tests to update/add before coding.
3. Implement
   - Keep route handlers thin.
   - Put domain logic in `*_crud.py` / service-style modules.
4. Verify
   - Run targeted tests first, then broader checks.
   - Report what you could and could not verify.
5. Summarize
   - List changed files and behavioral impact.
   - List risks and follow-up actions if any.

For large work, deliver in safe incremental commits/patches rather than one monolith.

---

# 4) Commands (Use These)

Install backend deps:

```bash
cd src/backend && uv sync
```

Run backend tests locally:

```bash
cd src/backend && uv run pytest -v
```

Run backend integration test stack (Docker):

```bash
just test backend
```

Run lint/format hooks:

```bash
just lint
```

Start full docker stack:

```bash
just start all
```

Start backend service only (Docker):

```bash
just start backend
```

Run frontend locally:

```bash
cd src/frontend && pnpm dev
```

---

# 5) Coding Standards

- Prefer explicit, simple, readable code.
- Avoid unnecessary abstractions.
- Keep functions focused and small.
- Add comments only where intent is non-obvious.
- Reuse existing schemas/routes/crud patterns.
- Keep API routes focused on HTTP concerns; move data logic out of route files.

---

# 6) Testing Standards

All new behavior must be tested.

- Cover success and failure paths.
- Favor route/integration behavior tests for HTTP flows.
- Add unit tests for isolated service/crud logic as needed.
- Do not weaken/delete tests to "make CI pass".

If environment constraints block test execution, state the exact blocker.

---

# 7) Security and Safety Boundaries

Never:

- Commit `.env` or credentials
- Hardcode secrets/tokens
- Bypass auth/permission checks
- Introduce unparameterized SQL

Ask first before:

- New dependencies
- Auth model changes
- DB schema changes not aligned with current migration strategy
- Deployment/infrastructure changes
- CI workflow changes

---

# 8) Database and Migration Policy

Database schema changes are tracked with Alembic migrations under:

- `src/backend/app/migrations/versions/`

Expected workflow:

1. Update SQLAlchemy models in `src/backend/app/models/` (and related modules).
2. Generate a migration revision (typically with autogenerate) from `src/backend`.
3. Review and adjust the generated migration script before committing.

Do not rely on manual base-SQL edits as the primary migration path.

---

# 9) Repo Change Boundaries

Default edit scope:

- `src/backend/**`
- `src/frontend/**`
- `docs/**`
- `tasks/**` / `Justfile` (only when needed for task alignment)

Do not modify these unless explicitly requested:

- `.env`
- Helm chart under `chart/`
- CI workflows under `.github/workflows/`

---

# 10) Dependency and Versioning Policy

- Use Conventional Commits.
- Keep dependency diffs minimal and justified.
- Respect Renovate flow (`renovate.json`).
- Avoid opportunistic upgrades unrelated to the task.
- Use `uv` for backend Python dependency work and `pnpm` for frontend JS dependency work.

If requested by maintainers, include:

```text
Assisted-by: <Tool Name>
```

---

# 11) Anti-Patterns

- Large refactors without staged validation
- Mixing old and new architectural styles in one feature
- Putting business logic directly in route handlers when existing CRUD/service pattern is available

Consistency and maintainability are higher priority than novelty.

---

# 12) Done Criteria

A change is "done" when all are true:

1. Behavior implemented and documented in code/tests.
2. Relevant tests pass (or blockers are explicitly reported).
3. Lint/format checks run for changed scope.
4. File-level summary and risk notes are provided.

When uncertain, ask instead of assuming.
