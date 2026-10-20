# Contributing to Rovdo

Rovdo has completed its foundation and Desktop + BYOK implementation. Keep changes focused on an agreed milestone and preserve the separation between Electron main, preload, renderer, and shared contracts.

## Setup

Use Node.js 24 LTS and npm 11, clone the repository, then run:

```sh
npm ci
npm run dev
```

The root is an npm workspace. Run checks from the repository root. Do not install separate dependency trees in individual workspaces. Pin direct dependency versions and include lockfile updates when dependencies change.

## Changes and tests

1. Write a failing test for the intended behavior before implementing functionality.
2. Implement the smallest change that satisfies the contract and current milestone.
3. Use synthetic fixtures; keep live accounts, applicant data, API keys, browser profiles, and private design material out of the repository.
4. Run `npm run check` and `npm audit --audit-level=high` before submitting a change.
5. Describe the problem, resulting behavior, test evidence, and material limitations in the pull request. Use descriptive commits for independently working stages.

Unit tests live next to source files. Desktop E2E tests live in `tests/e2e` and run against compiled bundles. Linux needs Electron system libraries and a graphical session or `xvfb-run`; see the README. Automated tests must never submit real applications, send outreach, delete mail, or create third-party accounts.

Provider tests use injected fetch fixtures with the official SDKs. The desktop acceptance flow uses an explicit loopback server and a unique synthetic OS-vault entry, verifies restart persistence, and removes the credential. Never add a renderer read-key method or a test-only authentication bypass to the production app. Linux E2E needs an isolated D-Bus session and unlocked Secret Service vault as shown in the README/CI.

## Architecture boundaries

- Keep renderer code free of Node, Electron imports, secrets, storage access, and privileged service dependencies.
- Expose specific preload methods with validated inputs and outputs. Do not expose generic IPC, shell execution, or arbitrary filesystem operations.
- Treat all model output, web content, and inbound IPC as untrusted. Schema validation does not replace action authorization.
- Use enumerated diagnostic metadata. Never add unrestricted message, error, URL, document, or credential payloads to logs.
- Add integrations and dependencies only when the current milestone requires them. Document public behavior accurately; distinguish available features from plans.

## Security reports

Follow [SECURITY.md](SECURITY.md). Do not publish secrets, personal data, or active exploit details in a public issue.

Contributions are made under the project's Apache-2.0 license.

## Approved application snapshots

`@rovdo/career` exports `buildApprovedApplicationContext`; shared contracts export `ApprovedApplicationContextSchema` and `validateApprovedApplicationContext`. Preparation accepts a stored profile, selected job, ranking configuration, template ID/version/content SHA-256, and explicit approval selections. Qualification IDs are section-prefixed (for example, `skills:typescript`); fact IDs remain their stored IDs. Unknown IDs are rejected. Unverified, unsupported, sensitive or conflicting selections are omitted with reasons. Names and contacts are included only when explicitly selected.

Use the asynchronous validator at future consumption boundaries: schema parsing alone cannot recompute evidence, claim and snapshot hashes. Snapshots bind content and versions but do not establish identity or authorization. Obtain fresh explicit approval when content changes. No IPC capability or document-generation implementation is introduced here. Preserve historical profiles and immutable preset weights; version behavioral policies and cache keys when matching changes.

## Reading the code

Start at [Electron main](apps/desktop/src/main/index.ts), the application composition root. It constructs the stores and services, wires validated IPC, creates the isolated window, and coordinates shutdown. [Preload](apps/desktop/src/preload/index.ts) exposes the narrow capability API declared in [shared contracts](packages/shared/src/index.ts). [App](apps/desktop/src/renderer/App.tsx) owns the renderer shell and navigation. Renderer components cannot import privileged services directly.

Follow an end-to-end workflow through these modules:

| Workflow | UI and orchestration | Business rules and IO |
| --- | --- | --- |
| Jobs | `CareerWorkspace` -> `career-service` | `job-discovery` schedules `job-sources` reads; `CareerStore` persists/searches; `career` ranks deterministically |
| Profile import | `ProfileIntelligence` -> `intelligence-service` -> `profile-file`/`profile-worker` | `profile-import` decodes and proposes records; `ImportReview` obtains approval before an atomic profile merge |
| Ranking | `RankingEditor` -> intelligence commands | `candidate.ts` reconciles history, `requirements.ts` parses postings, and `scorer-v2.ts` applies the selected immutable or custom configuration |
| Models/chat | `Models`/`Chat` -> `byok-ipc` -> `ByokService` | `providers` normalizes streams/tools/usage; network policy and the OS vault stay in privileged code |
| Browser | `BrowserRun` -> `browser-service` | `BrowserRuntime` persists the policy/approval loop; `BrowserWorker` executes scoped semantic DOM actions |
| Appearance | `appearance.ts` -> intelligence appearance command | `tokens.css` supplies semantic values; base/feature styles precede `workspace.css` refinements |

Keep policy and persistence distinct: schemas validate shape, services authorize and coordinate, pure career helpers calculate results, and stores transact durable changes. Comments next to evidence aggregation, approval consumption, import merging, retry limits and cache identity explain the invariants that connect these layers. Co-located test names describe expected behavior; `tests/e2e` exercises the compiled desktop boundaries with fixtures.

## Readability and formatting

Use module comments to explain responsibility and trust boundaries. Add function/inline comments for non-obvious decisions, units, failure recovery and invariants; avoid narrating every assignment or duplicating a clear name. Update comments when behavior changes, and keep private design documents and applicant information out of source comments.

The repository uses two-space formatting, single-quoted JavaScript/TypeScript, a 100-column target and LF line endings. The committed Prettier configuration also covers CSS. A pinned, on-demand formatter avoids changing runtime or development dependencies:

```sh
npx --yes prettier@3.6.2 --check "apps/desktop/src/**/*.{ts,tsx,css}" "packages/*/src/**/*.ts" "tests/**/*.{ts,tsx}" "scripts/*.{mjs,ts}" "*.{js,ts}" .prettierrc.json
```

Replace `--check` with `--write` to format. The formatter must be cached or downloaded on first use; `--offline` can be passed through npm exec when cached. Generated bundles, dependencies, private `/docs`, lockfiles, artifacts and the separate roadmap file are excluded. Keep JSON manifests valid; explain their design rationale in contributor guidance instead of adding unsupported JSON comments. Preserve JSX text spacing when reformatting and run the regression gate after broad formatting changes.
