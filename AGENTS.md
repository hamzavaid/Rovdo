# Contributor guidance for agents

## Project overview

Rovdo is a local-first Electron desktop workspace for job discovery, verified candidate profiles, deterministic qualification matching, and optional AI-assisted chat and scoped browser tasks. The stack is TypeScript, React, Vite, Zod, SQLite, Vitest and Playwright.

The current documented preview is v0.3.8, before Phase 4 document generation. Discovery, profile review and ranking work without a model key. Models propose actions; deterministic application policy authorizes execution. Local storage does not imply local inference. Document generation, application submission and general multi-agent orchestration remain future work.

Read [CONTRIBUTING.md](CONTRIBUTING.md) for setup and detailed conventions, [SECURITY.md](SECURITY.md) for trust boundaries, and [MISMATCH.md](MISMATCH.md) for known discrepancies and verification limits. [USER_GUIDE.md](USER_GUIDE.md) describes current behavior; [QUALITY.md](QUALITY.md) describes benchmarks; [FUTURE.md](FUTURE.md) describes release intentions. Roadmap entries and backlog issues do not authorize implementation by themselves.

## Repository structure

| Path | Responsibility |
| --- | --- |
| `apps/desktop/src/main/` | Application composition, privileged services, IPC authorization, vault and native integrations |
| `apps/desktop/src/preload/` | Narrow, validated renderer capability bridge |
| `apps/desktop/src/renderer/` | React workspaces, user interactions, semantic styles and appearance |
| `packages/shared/` | Shared Zod contracts, types, errors and explicitly separated privileged utilities |
| `packages/agent-core/` | Browser policy, approvals, budgets and execution runtime |
| `packages/browser-worker/` | Disposable Chromium sessions and scoped DOM tools |
| `packages/career/` | Candidate evidence, requirements, eligibility, taxonomy and deterministic ranking |
| `packages/profile-import/` | Bounded extraction, unverified proposals and reviewed import merging |
| `packages/job-sources/` | Public ATS/API/feed/list adapters and source capability registry |
| `packages/job-discovery/` | Saved-source polling, global collection and background company discovery |
| `packages/providers/` | Provider-independent model adapters, streams and usage accounting |
| `packages/storage/` | SQLite migrations, persistence, checkpoints, search and ranking caches |
| `tests/e2e/` and `tests/fixtures/` | Compiled desktop acceptance flows and synthetic fixture data |
| `scripts/` and `.github/workflows/` | Build/launch helpers, quality reporting and CI |
| `.agent-cache/` | Generated local repository map and index checkpoints |
| `.planning/` | Private task context, implementation plans and testing records |
| `docs/` | Private architecture, development guidance, historical provenance and compressed originals |

Start code tracing at `apps/desktop/src/main/index.ts`, the preload bridge, and `apps/desktop/src/renderer/App.tsx`. Follow the relevant workflow through contracts, service authorization, domain rules and storage; do not infer behavior from UI labels alone.

## Repository map

Use the repo-map skill and `.agent-cache/` to orient broad investigations before repeatedly searching the whole repository:

1. Read `.agent-cache/repo-overview.md` for the compact tree and indexed Git checkpoint.
2. Use the installed repo-map skill's `sync` command to compare HEAD, branch, uncommitted changes and file hashes. Use `build` only when the cache is missing, corrupt or incompatible. Resolve its script relative to the installed skill directory, not this repository.
3. Query relevant files/symbols rather than loading all of `symbols.json`. `index-state.json` records hashes/checkpoint metadata.
4. Inspect actual source before editing. Cached line numbers and heuristic symbols/imports are hints, not authoritative contracts or proof of behavior.
5. Refresh after substantial source changes. Preserve existing uncommitted changes; never modify Git history to update the map.

Only mapping `sync`/`build` operations should write generated cache files. Keep the cache local and verify ignore status before staging. If the relevant paths are already known, use targeted `rg` and direct reads; unavailable mapping tools should not block a small change.

## Planning and deferred GitHub issues

`.planning/` is private, Gitignored and command-specific. Agents are not required to read it for ordinary tasks. Do not browse, search, read or update it unless the corresponding command is explicitly invoked or the user specifically directs access to a planning record. Do not include it in routine repository orientation or context gathering.

| Explicit command | Planning location | Purpose |
| --- | --- | --- |
| `get-context` | `.planning/context/` | Agreed outcomes, requirements, constraints, decisions, unresolved questions and provisional acceptance targets |
| `implementation-planning` | `.planning/implementation/` **or GitHub tickets** | Scoped design, affected modules/contracts, dependency order, recovery considerations, risks and verification plan |
| `test-creator` | `.planning/testing/` | Acceptance scenarios, regression expectations, synthetic fixtures and test design |

Invoking one command does not require reading the other planning folders. Access additional records only when specifically directed. Within the authorized workflow, use focused, dated files or issue-based names and reference related records rather than duplicating them. Distinguish desired behavior from measured results, prepared tickets from published issues, and approved plans from completed implementation.

Use GitHub issues as the durable backlog for work intentionally deferred to later implementation. When issue filing is within the authorized task, create or update a focused issue with the problem, desired outcome, scope/non-goals, acceptance criteria, dependencies and relevant public code references. Search for an existing issue before creating a duplicate. If publication is outside scope, report or prepare a draft without accessing `.planning/` unless the command or user instruction permits it.

Within an explicitly invoked planning workflow, record published issue URLs/numbers in that workflow's authorized record; do not update other planning folders automatically. Split larger work into ordered slices with a parent issue and explicit dependencies. Later implementation can work from the assigned GitHub ticket without reading `.planning/`; link the resulting PR/commit and verification evidence to the issue. Do not implement unrelated backlog items opportunistically or mark an issue complete merely because a plan, draft or test file exists.

GitHub issues are external publications: use sanitized, self-contained descriptions. Do not upload private planning documents, internal specifications, raw logs, applicant data or credentials. Keep private rationale and detailed evidence local; publish only information authorized for the issue.

## Coding standards

- Use strict TypeScript and existing Zod contracts. Validate inputs and outputs at capability boundaries; shape validation does not replace authorization.
- Keep the renderer free of Node/Electron privileges, direct network/database/filesystem access, secrets and privileged service imports. Expose specific preload methods, never generic IPC, shell execution or arbitrary file access.
- Keep responsibilities separate: schemas validate, services authorize/orchestrate, pure domain helpers calculate, and stores transact durable state. Extend existing module boundaries before adding abstractions or dependencies.
- Treat model output, imported documents, webpages and IPC as untrusted. Preserve origin scopes, DNS/TLS checks, one-use approvals, cancellation, bounded resources and sanitized diagnostics. Never log unrestricted errors, request bodies or credentials.
- Preserve historical profiles/jobs/provenance, saved opportunities, immutable preset weights and custom ranking revisions. Use additive transactional migrations and version score/parser/taxonomy/cache behavior when semantics change. Hashes establish content integrity, not user authorization.
- Follow the committed formatter: two spaces, single-quoted JavaScript/TypeScript, trailing commas, a 100-column target and LF endings. Keep JSON valid; preserve JSX text spacing and CSS rule order when formatting.
- Explain non-obvious invariants, trust boundaries, units and recovery choices in comments. Avoid comments that repeat assignments or copy private design material.
- Use semantic appearance tokens and accessible labeled controls, focus handling and visible pending/error states. Preserve draft data on failed saves and keep background work cooperative so the desktop remains responsive.
- Pin direct dependencies and include intentional lockfile changes. Do not install separate workspace dependency trees, force incompatible audit fixes or add integrations outside the agreed scope.

## Testing and verification standards

For functional changes, establish the intended behavior with a failing regression/acceptance test before implementation when practical. Test observable contracts, failure recovery and security invariants rather than mirroring the implementation. Documentation-only or reversible presentation edits need appropriate static/visual checks, not artificial application tests.

Co-locate unit/integration tests as `*.test.ts` or `*.test.tsx`; use `tests/e2e/` for Playwright Electron flows against compiled bundles. Keep data synthetic and network/provider behavior fixture-based. Native-vault tests use isolated synthetic credentials and remove them. Never submit real applications, send outreach, delete mail, create third-party accounts or make paid provider calls in automated verification.

Run commands from the repository root with Node.js 24 LTS and npm 11 (minimum supported Node: 22.23.2). On Windows, use `npm.cmd`/`npx.cmd` if PowerShell blocks script shims; do not change execution policy for setup.

| Command | Use |
| --- | --- |
| `npm run format:check` | Pinned source/workflow formatting gate |
| `npm run lint` | ESLint with zero warnings allowed |
| `npm run typecheck` | Strict TypeScript checks |
| `npm test` | Unit/integration suite |
| `npm run build` | Compile renderer, main, preload and document worker |
| `npm run test:e2e` | Desktop/browser acceptance against an existing build |
| `npm run check` | Formatting, lint, types, unit/integration tests, build and E2Es |
| `npm audit --audit-level=high` | Separate dependency security gate |
| `npm run benchmark:matching` | Frozen synthetic matching comparison and local report |

Start with affected tests, then run required gates for the change. Before submitting functional code, follow CONTRIBUTING.md's full `npm run check` and audit requirements. Build before direct E2E runs; Playwright Chromium and platform vault/display dependencies must be available. Use the Linux D-Bus/keyring/display setup documented in CONTRIBUTING.md. Keep the configured serial unit-test execution unless a separate tooling change justifies altering it.

Do not weaken assertions, deadlines, isolation or approvals to hide failures. Never recapture the frozen matching baseline to make a regression pass. Run opt-in performance, native CLI/dictation and live-source checks only for the relevant scope; distinguish fixture success from live/platform certification. Synthetic ranking metrics do not establish recruiter-validated accuracy.

Report the actual commands, exit results, tested acceptance criteria, failures and unverified areas. A dry run is not a clean install; configured CI is not a successful hosted run; Windows results do not certify macOS/Linux. Record implementation/documentation discrepancies in MISMATCH.md and reference them from the relevant deferred issue or explicitly authorized planning record.

## Documentation and privacy

Keep README.md concise, USER_GUIDE.md focused on current use, QUALITY.md focused on evaluation, and FUTURE.md explicit about implemented versus planned capabilities. Keep AGENTS.md focused on durable contributor guidance rather than task histories or private product requirements.

Keep `docs/` and `.planning/` private and Gitignored. Do not copy private specifications, research, audit logs, historical evidence, credentials or applicant data into tracked files, source comments or public issue bodies without explicit authorization. Preserve original evidence before consolidating historical documentation. Retain compressed originals and their verification records; do not recreate sprawling loose internal logs or publish caches and generated artifacts accidentally.
