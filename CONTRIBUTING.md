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
