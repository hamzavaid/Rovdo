# Implementation mismatches

Verification status: Partial
Last reviewed: 2026-11-11

No unresolved implementation mismatch was confirmed in the selected checks. This is not an exhaustive implementation or security audit. Historical delivery reports remain dated evidence.

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

## Verification coverage

On 2026-11-11, this cleanup ran:

```sh
npx --no-install vitest run packages/career/src/matching-benchmark.test.ts apps/desktop/src/renderer/JobsWorkspace.test.tsx packages/job-discovery/src/source-taxonomy.test.ts packages/storage/src/discovery-controls.test.ts packages/job-discovery/src/company-scheduler.test.ts
node scripts/quality-summary.ts
```

Both commands exited 0: five test files and eleven tests passed. The provisional benchmark reproduced P@10 0.3750, NDCG@10 0.9388, recall@5 0.9500 and known hard-mismatch false-positive rate 0. These are synthetic regression results, not hiring accuracy. An initial sandbox invocation could not load the Vitest configuration because esbuild lacked parent-directory access; the successful run used the installed tools outside that restriction.

Static checks compared package scripts/engine/version, the CI matrix, ranking/parser/candidate/taxonomy constants, model version guards, attachment limits/expiry, import-worker bounds and current Jobs controls. Backup hashes, document outcomes, privacy boundaries and current local links were checked separately. No application source, tests, deployment configuration or dependencies were changed.

The full application gate, Electron UI, native microphone/vault/CLI isolation tests, live source availability, remote links, hosted CI and other operating systems were not rerun. Long retained specification/research/audit references received a scoped review, not full substantive revalidation; private coverage records state those limits. Historical reference links to retired source may remain as evidence and are accounted for privately.
