# Implementation mismatches

Verification status: Partial
Last reviewed: 2026-11-15

The scope and starter directory implementations have focused verification. The supplied directory replaces the reference-set union requirement for the current #3 task. This is not an exhaustive implementation or security audit. Historical delivery reports remain dated evidence.

## Workable adapter slice for #4 (2026-11-15)

Workable now collects its documented public GET feed through the existing bounded,
unauthenticated transport. Source/job/board/manifest schemas, registry defaults,
installer recognition, archive host scopes, saved polling, global collection and
source controls accept the new family. Shortcodes and fixed public job links retain
stable identity; descriptions, multiple locations and remote restrictions survive
normalization. Empty boards, malformed siblings, conditional refresh, cancellation,
robots denial and historical removal grace have fixture coverage. No generic POST,
IPC capability, database layout, dependency or existing directory release changed.

The dated coverage review found 9,907 recognized routes among 9,940 startup entries.
The supplied directory has no Workable or Workday entries, so no installed-directory
coverage gain is claimed. Reference-list membership and most industry classifications
were not supplied. Workday and the two custom-site gaps remain unsupported; this
slice does not claim exhaustive major-employer coverage or authorized Workday access.

Windows, Node 24.11.1 and npm 11.6.2: behavioral adapter and saved-board-URL regressions
failed before their fixes. Before committing, an isolated staged snapshot excluding
the separate Jobs-refresh performance changes passed all nine Workable tests. The
broader suite figures below were measured in the shared working tree, which also
contained those performance changes. The focused regression command passed 58 tests with three
live-source skips. The final `npm test` exited 1 with 649 passes, 16 existing #5/#7
dispatcher/progress failures and eight skips; all nine new Workable tests passed.
`npm run check` exited 2 at the existing missing `DiscoveryProgressSchema` export,
after formatting and lint passed. `npm run build` and
`npm audit --audit-level=high` exited 0; audit reported nine moderate advisories.

The full `npm run test:e2e` exited 1 with 21 passes, three failures and one opt-in
skip. The existing cached-card responsiveness failure remains at the 1,000 ms
assertion before active collection. An old source-picker assertion expected eleven
sources; it now requires twelve and explicitly checks Workable selection. The other
failure was the existing cached-search scenario's 30-second timeout. A subsequent
targeted run of global discovery, cached search and Workable acceptance exited 0
with all four scenarios passing, including registration, scoped collection, restart
persistence and Workable company filtering. This is not a single green full-suite
result; the timeout's cause remains unestablished.

No deadline, isolation or policy gate was weakened. These are Windows fixture
results; live protocol checks establish only dated feasibility, not ongoing board
availability or other-platform certification. The coverage matrix, source decision,
contract review and detailed command evidence remain in private local documentation.

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

## MM-003: Starter directory reference-set union replaced by supplied dataset

- Status: Resolved for the explicitly revised #3 scope (2026-11-14)
- Severity: Medium
- Expected: The user explicitly replaced #3's three-reference-set union with the supplied `Rovdo_Starter_Directory.json`.
- Actual: Startup uses all 9,935 supplied candidates, retains five additional legacy entries and preserves established identities for five matching boards. The source file is unchanged under `packages/job-sources/data/`. No complete reference-set membership or current live verification is claimed.
- Resolution: The revised release has 9,940 directory entries, 9,907 recognized boards and 33 coverage gaps. Earlier manifests and installed history remain available; only exact reviewed canonical-board matches share legacy identities.

## MM-004: Delayed geography prompt blocked ranking edits

- Status: Resolved (2026-11-14)
- Severity: Medium
- Expected: An unresolved collection geography must not interrupt editing a ranking configuration or browsing other Jobs pages.
- Actual: The country dialog mounted on every Jobs page when a delayed view response arrived. The native modal made the ranking form inert, so keyboard edits were ignored and the Save button incorrectly appeared to stay enabled for an under-allocated draft.
- Resolution: Show the one-time prompt only on Find Jobs. Returning there still asks for unresolved geography; dismissal and saved country settings retain their existing behavior. No ranking/scoring, IPC, schema or storage contract changed.
- Verification: The new no-dialog assertion failed before the fix. After the fix, the existing ranking flow verifies that edits persist, a 95-point allocation disables Save, keyboard reallocation restores 100 points, and returning to Find Jobs still prompts for countries. The ranking and geography Electron scenarios passed, including the full suite.

## Current regression verification (2026-11-14)

Windows, Node 24.11.1 and npm 11.6.2, synthetic fixtures only. The final `npm test` exited 1 with 637 passed, 16 failed and seven skipped; every failure belongs to the deferred #5 dispatcher or #7 progress tests. The final full Electron run exited 1 with 22 passed and one failed: `discovery-upgrade-responsiveness.spec.ts:136`, owned by #6/#8. All current-scope tests passed in these final runs.

Formatting, lint, build and the high-severity audit gate passed. Audit reported nine moderate advisories. `npm run check` exited 2 at #7's missing `DiscoveryProgressSchema` export. The earlier corpus, inventory and CLI permission timeouts did not reproduce in the focused baseline (14 tests passed) or final unit suite. One intermediate combined Electron run timed out in the existing search scenario; that scenario passed in the final full run. These results do not establish the causes of intermittent timeouts. No assertions, timeouts, isolation, policy checks or deferred tests were weakened or removed.

## Current CI limitation

The latest inspected hosted data-branch run, `43576781918`, fails Prettier on `scripts/build-lastroundai-manifest.mjs`. The generator was initially reused, formatted and verified to reproduce the supplied manifest. The user subsequently requested removal of the duplicate `data/ats` source; that folder and its now-unused generator were removed. The runtime manifest remains unchanged, with attribution beside it in `packages/job-sources/data/README.md`.

The committed tests also cover deferred Issues #5-#8. Their progress contract, pump and responsiveness expectations remain active and outside this implementation's scope. Full type checking still reports the missing `DiscoveryProgressSchema` from the deferred progress tests. No future-feature test or gate was disabled. The focused passing checks do not establish a green hosted CI run.

## Starter release verification (2026-11-14)

Windows, Node 24.11.1, npm 11.6.2; fixture traffic only. The existing directory schema/installer tests passed before implementation (36 tests including source-directory tests). Two additional release-wiring tests failed before implementation because supplied boards were absent. A full-size installation initially exceeded 30 seconds; an additive canonical-board lookup index removed repeated inventory scans. The final focused run passed 40 tests across manifest validation, full-release installation, restart, immutable releases, opt-outs, historical rollback, board identity and geographic integration. Installer batch size remains capped at 50 with cooperative yields.

`npm run format:check`, `npm run lint`, `npm run build`, and `npm audit --audit-level=high` exited 0. Audit reported nine moderate advisories. `npm run typecheck` and the final `npm run check` both exited 2 solely at the existing deferred progress-schema import. The latest complete unit/integration run reported 634 passed, 19 failed and seven skipped: 16 failures in deferred progress/pump tests and three timeouts (the 1,000-job corpus, employer inventory backfill and CLI permission persistence). On a focused rerun, CLI permission persistence passed; the corpus and inventory timeouts reproduced. The corpus timeout also occurred before implementation. Assertions and deadlines were preserved; these results do not establish the causes of the timeouts.

The four focused built Electron scenarios passed: automatic saved-company fixture collection, manual geography persistence and unsupported gaps, inferred geography, and directory pagination/search/ranking. The latest full Electron run was interrupted after six passes and a CLI failure. Both CLI scenarios and all unfinished scenarios were rerun: 15 passed and two failed (exit 1). Combined coverage across the completed and resumed scenarios is 21 passed and two failed across all 23 scenarios; this is not a single uninterrupted suite result. Both CLI scenarios passed on resume. The remaining failures are deferred discovery responsiveness (cached card not visible within 1,000ms) and the previously documented ranking-save disabled-state expectation. No unrelated CLI/ranking/pump implementation or test deadline was changed.

Interface review found no shared-schema, IPC, sink-signature or SQLite row-format changes; the added export and index are compatible additions. Code review covered consumers, release hashes, canonical matching, prior releases and preservation of existing board state; the native JSON import-attribute regression found by the full E2E loader was corrected and the app rebuilt. The supplied file's SHA-256 remains `4670c59a7e31a79f3185e20b448784f7af00fd892e4492b82d11251c86de1c4a`. These results do not establish live board availability, current employer membership accuracy, or macOS/Linux/hosted CI certification.

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
