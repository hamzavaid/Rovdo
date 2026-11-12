# Implementation mismatches

Verification status: Partial
Last reviewed: 2026-11-12

The current scope implementation has focused verification; the starter directory still has the release-data gap below. This is not an exhaustive implementation or security audit. Historical delivery reports remain dated evidence.

## MM-001: Conflicting Jobs navigation, ranking and pagination instructions

- Status: Resolved
- Severity: Low
- Expected: The user guide describes the current Jobs pages, ranking controls and page sizes consistently.
- Actual: The prior README mixed older controls and fixed 50-row pagination with the newer five-page workflow. The consolidated guide uses five pages, 10/25/50 result sizes (default 10), company default 25, and the actual draft preview/import controls.
- Evidence: `apps/desktop/src/renderer/JobsWorkspace.tsx:232`, `JobsWorkspace.tsx:469`, `JobsCollection.tsx:347`, `JobsRanking.tsx:163`, `jobs-state.ts:18`.
- Proposed resolution: Documentation corrected; no application change required.
- Verification: Source inspection; `JobsWorkspace.test.tsx` passed in the focused test run below.

## MM-002: Retired discovery integration described as current

- Status: Resolved
- Severity: Low
- Expected: Current documentation describes supported adapters and separates company archive discovery from foreground job collection.
- Actual: The prior QUALITY.md still described an optional Python JobSpy broker. Current contracts expose eleven foreground adapters and a separate archive lane. The public guides now describe supported sources and identify the old job-row import workflow as retired.
- Evidence: `packages/job-sources/src/registry.ts:29`, `registry.ts:54`, `packages/job-discovery/src/source-taxonomy.test.ts:7`; current career command schemas in `packages/shared/src/career.ts`.
- Proposed resolution: Documentation corrected; preserve historical source records and compatibility behavior.
- Verification: Source taxonomy, company scheduler and discovery-control fixture tests passed.

## MM-003: Starter directory reference-set union is incomplete

- Status: Open
- Severity: Medium
- Expected: [Issue #3](https://github.com/hamzavaid/Rovdo/issues/3) ships the union of three dated reference sets with reviewed boards and broader employers.
- Actual: The installer and strict metadata contract are implemented, but the release contains ten reviewed employers. No complete reference-set membership is claimed. Redistribution-permitted membership data is unavailable.
- Resolution: Prepare a permitted, reviewed release dataset before marking #3 complete. The prior release and installed identities remain available.

## Current CI limitation

The committed tests also cover deferred Issues #5-#8. Their progress contract, pump and responsiveness expectations remain active and outside this implementation's scope. Implementing #2/#3 and correcting the invalid histogram type and benchmark-report dependency does not make those future-feature tests pass. Full type checking still reports the missing `DiscoveryProgressSchema` from the deferred progress tests. Do not treat the focused passing checks as a green hosted CI run.

## Scope and directory verification (2026-11-12)

The #2/#3 boundary and integration tests pass, including country inference, scope revisions, raw-cache replay, historical closure safety, installer restart, release ordering and opt-outs. The built Windows Electron suite passed 21 scenarios and failed two: the deferred discovery responsiveness scenario and the existing ranking-editor expectation that Save becomes disabled after a weight edit. No ranking implementation was changed in this task; that failure's cause remains unisolated.

The full unit/integration suite passed 635 tests, failed 16 deferred progress/pump tests, and skipped seven existing opt-in checks. Formatting, lint and build pass. Type checking stops at the deferred `DiscoveryProgressSchema` import. The dependency audit passed its high-severity threshold and reported ten moderate advisories. No assertion, deadline or check was disabled. These Windows fixture results do not establish live source availability or hosted macOS/Linux CI success.

## Verification coverage

On 2026-11-11, this cleanup ran:

```sh
npx --no-install vitest run packages/career/src/matching-benchmark.test.ts apps/desktop/src/renderer/JobsWorkspace.test.tsx packages/job-discovery/src/source-taxonomy.test.ts packages/storage/src/discovery-controls.test.ts packages/job-discovery/src/company-scheduler.test.ts
node scripts/quality-summary.ts
```

Both commands exited 0: five test files and eleven tests passed. The provisional benchmark reproduced P@10 0.3750, NDCG@10 0.9388, recall@5 0.9500 and known hard-mismatch false-positive rate 0. These are synthetic regression results, not hiring accuracy. An initial sandbox invocation could not load the Vitest configuration because esbuild lacked parent-directory access; the successful run used the installed tools outside that restriction.

Static checks compared package scripts/engine/version, the CI matrix, ranking/parser/candidate/taxonomy constants, model version guards, attachment limits/expiry, import-worker bounds and current Jobs controls. Backup hashes, document outcomes, privacy boundaries and current local links were checked separately. No application source, tests, deployment configuration or dependencies were changed.

The full application gate, Electron UI, native microphone/vault/CLI isolation tests, live source availability, remote links, hosted CI and other operating systems were not rerun. Long retained specification/research/audit references received a scoped review, not full substantive revalidation; private coverage records state those limits. Historical reference links to retired source may remain as evidence and are accounted for privately.
