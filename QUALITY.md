# Matching and pipeline quality

Rovdo v0.3.8 remains at pre-Phase 4 stabilization. The Electron/React/TypeScript desktop uses isolated preload IPC, Zod contracts, SQLite WAL/FTS5, pure career scoring, public feed adapters and optional Python JobSpy. Models/vault/browser runtime are separate; discovery and scoring require zero AI calls. Document generation, application submission and universal live-site coverage are not implemented.

## Offline benchmark

Run `npm run benchmark:matching` from the repository root. The Vitest harness writes `artifacts/matching-benchmark.json`, including frozen baseline and current per-job scores, eligibility/review status, metrics, explicit as-of date and processing time. It also runs as part of `npm test`. The original 20-job backend comparison suite remains intact.

The extended corpus (`tests/fixtures/matching-benchmark.ts`) contains 34 distinct postings and four candidate scenarios: backend engineering, mechanical design, analytics and accounting. It covers seniority/duration gaps, exact and alternative skills, transferable skills, required/preferred distinctions, repeated requirements, unknown authorization/clearance and known degree mismatches. Baseline (`tests/fixtures/matching-baseline.json`) records the original deterministic-v2.1 / requirements-v3 / taxonomy-2 behavior at repository revision 6484937. Do not recapture the baseline after implementation changes. The capture switch is reserved for creating an explicitly versioned new benchmark, not for making regressions pass.

Labels were authored as provisional synthetic regression judgments before scorer changes, not supplied or independently reviewed by recruiters. Rubric: 3 = directly supported relevant qualifications with no known mandatory mismatch; 2 = supported core competencies with optional gaps or curated transfer; 1 = substantial gap or unresolved critical eligibility; 0 = unrelated mandatory competencies, track mismatch, or known hard disqualification. Grade >=2 is relevant. Hard-mismatch labels are separate explicit degree failures; missing information never becomes a known mismatch. No real-world accuracy claim follows from this small English-language corpus; independent held-out labels are still needed.

Metrics are macro-averaged by scenario. Precision@10 uses a fixed denominator of 10 even for eight-posting scenarios; its ceiling is therefore below 1. Precision@5, graded NDCG@5/@10, relevant recall@5, full returned-relevant recall, and hard-constraint false-positive rate are reported separately. Hard false positives count labeled known mismatches retained by eligibility filtering, not unknown cases. The harness repeats scoring in reverse input order and asserts exact score/order consistency. Latency covers both passes over 68 candidate/job pairs, including cold requirement parsing; throughput is host dependent, excludes network/UI time and is not an SLA. No performance threshold is imposed on noisy CI timing.

## Implemented pipeline boundaries

| Stage | Owner and contract | Failure/data safeguards |
| --- | --- | --- |
| Query planning and collection | `job-discovery`: saved `SourceConfig`/`SourceState`; global `DiscoveryRun`/tasks and registry | Qualification-only planning, policy checks, persisted per-origin quotas/cooldowns, bounded concurrency, timeouts and resumable checkpoints; restart pauses global work |
| Retrieval | `job-sources` ATS/public API/feed/index adapters; optional main-process JobSpy broker | Public DNS-pinned GET transport, TLS, no redirects/auth/CAPTCHA bypass; isolated source failures and safe error codes |
| Parse and normalize | `AtsAdapter.normalizeDetailedAsync`, `DiscoveryRecordSchema`, `JobSchema` | Cooperative bounded pages, individual quarantine, null unknown dates/pay, source descriptions/excerpts and application URLs preserved |
| Dedup and persistence | `CareerStore.batch`/global ingestion, `source_record`, snapshots/provenance | Transactional writes, stable canonical/requisition identity, first-party precedence, uncertain duplicate review, saved IDs retained |
| Retrieval and filters | SQLite FTS5/BM25 and SQL metadata, streamed rows | Explicit null-aware filters, source scope separation, 50-row pages and bounded score preparation; BM25 primarily retrieves |
| Eligibility and matching | Pure `career` rules plus supported verified candidate evidence | PASS/FAIL/UNKNOWN, configurable gates and weights, separate technical/preference values, traceable requirement explanations |
| Ranking cache and history | `rank_cache`, requirement/ranking snapshots, versioned configuration/evidence hashes | Invalidate on job/candidate/config/date/policy changes; historical profiles/jobs/rankings remain readable |
| UI and export | Validated career IPC, job cards, `exportJobs` with native save capability | No renderer database/network access; visible uncertainty/source health, source-credit/export restrictions and CSV formula protection |

Existing tests cover all stages, including a 1,000-job three-ATS zero-AI ingestion corpus, migrations, partial feeds, revocation, retries, deduplication, ranking caches, native export and Electron UI. CI runs Windows/macOS/Linux with native vault fixture, Chromium sandboxing, lint/types/unit/build/E2E and dependency audit. Hosted CI still requires an authorized push; local Windows results alone are not cross-platform evidence.

## Correctness changes and reproducible results

Policy `deterministic-v2.2`, parser `requirements-v4`, taxonomy `rovdo-taxonomy-3`:

- Requirement-centric scoring deduplicates equivalent repeated requirements without discarding original source excerpts. Verified project/work competencies can support skills; missing version evidence remains partial and cannot satisfy full required coverage.
- Project relevance uses strongest supported requirement coverage, including alternatives and required/preferred weights. Repeated projects/keywords add no bonus; unrelated project role labels do not earn credit. Relevant employment intervals are still unioned, never summed across overlaps. Unrelated role families do not earn seniority credit.
- Preferred/mentioned degrees and experience do not become mandatory failures. Incomplete experience history produces UNKNOWN under an enabled experience gate; it still earns proportional duration credit. Exact supported credentials, expiry precision and explicit alternatives replace substring/first-record matching. Unknown credential prose stays reviewable.
- Best-source evidence aggregation remains shared with approved snapshots. Extraction confidence, source reliability, verification and contradictions remain distinct; unsupported or conflicting claims cannot score. Preset weights, custom profiles, Legacy v1 and historical data are preserved.
- Invalid/ambiguous source dates remain null; collection time never becomes posting time. Quarantined siblings cannot close jobs from an incomplete snapshot. Cache identities bind actual scoring text and named job fields, avoiding stale upstream hashes and positional-field collisions.
- Search metadata refreshes after parser/taxonomy upgrades with durable keyset checkpoints and yielding batches; source jobs, saved IDs and historical rankings are not rewritten. Summary reads avoid this work. UI/export distinguish qualification review from PASS/FAIL/UNKNOWN eligibility; CSV adds `reviewRequired` at the end.

The fixed 34-posting corpus yields these macro results (2026-10-28):

| Metric | Frozen baseline | Updated |
| --- | ---: | ---: |
| Precision@10 | 0.3750 | 0.3750 |
| NDCG@10 | 0.8647 | 0.9388 |
| Precision@5 | 0.6000 | 0.7000 |
| NDCG@5 | 0.8050 | 0.9284 |
| Relevant recall@5 | 0.7833 | 0.9500 |
| Full returned-relevant recall | 1.0000 | 1.0000 |
| Known hard-mismatch false-positive rate | 0.0000 | 0.0000 |

These are regression-corpus results, not validated hiring accuracy. Corpus labels and preset weights were not changed to improve metrics. Regression floors guard P@10, NDCG@10, relevant recall and hard-mismatch false positives; exact repeat/reversal checks guard deterministic behavior. Baseline milestone `dcfc56b` can be checked out separately to rerun original behavior. A diagnostic cold run of 68 pairs measured 403.97 ms (~168.3 pairs/s) before changes and 330.63 ms (~205.7 pairs/s) after changes on Windows/Node25.2.1; concurrent host load was uncontrolled, so no speed improvement is claimed. Each run regenerates runtime measurements in the ignored report.

The cross-package pipeline fixture covers ATS response shape drift, sibling quarantine, invalid dates, canonical cross-source duplicates/provenance, idempotent polling, FTS retrieval, saved filtering, deterministic coverage, export, failed refresh and database restart. The existing 1,000-job zero-AI test remains unchanged.

## Quality gates and limitations

`npm run check` runs pinned source formatting, lint, strict typecheck (including CI helper scripts), unit/integration tests, builds and all desktop E2Es. `npm audit --audit-level=high` remains a separate required gate. CI adds formatting and an aggregate benchmark job summary using `node scripts/quality-summary.ts`; detailed synthetic results remain in `artifacts/matching-benchmark.json`. No applicant/source content is uploaded by the new reporter. Missing or invalid benchmark measurements fail reporting rather than producing a success claim.

Remaining work: obtain independent held-out recruiter labels; broaden domain/credential vocabularies and non-English/complex requirement fixtures; review live-source policies/layouts separately; run hosted Windows/Linux/macOS CI and native accessibility QA after an authorized push. Optional scraper and index coverage remains provider-dependent. Credential recognition is deliberately limited to explicit supported names; vague requirements/equivalences remain UNKNOWN. No Phase 4 generation, submissions, paid AI calls or architecture rewrite is included.

The security audit identified [GHSA-jr5w-w6x2-84p9](https://github.com/advisories/GHSA-jr5w-w6x2-84p9) in the original Electron 44.7.2 pin. Electron is updated to 44.9.1, the advisory's first patched release in the same major. The lockfile change preserves the prior optional Undici entry needed for cross-platform clean installs. No audit suppression or forced broad dependency upgrade is used.

## Delivery file map

| Files | Purpose |
| --- | --- |
| `packages/career/src/scorer-v2.ts`, `requirements.ts`, `taxonomy.ts`, `job-export.ts`, `index.ts` | Conservative technical scoring, requirement/credential/date rules, domain vocabulary, eligibility/export separation |
| `packages/shared/src/intelligence.ts`, `career.ts` | Additive credential metadata and backwards-compatible policy-version literals |
| `packages/job-sources/src/dates.ts`, `index.ts`, `global-adapters.ts` | Bounded explicit date normalization and safe invalid-date provenance |
| `packages/storage/src/career.ts`, `apps/desktop/src/main/career-service.ts` | Named-content ranking keys and resumable derived-filter refresh |
| `apps/desktop/src/renderer/JobCard.tsx`, `DiscoveryControls.tsx`, `QualificationFields.tsx` | Independent eligibility/review display and selectable expanded role families |
| `tests/fixtures/matching-benchmark.ts`, `matching-baseline.json`, `packages/career/src/matching-benchmark.test.ts` | Frozen rubric/corpus/baseline, current comparison and invariants |
| Co-located `matching-quality`, `cache-integrity`, `pipeline-quality`, `dates`, `export-quality`, `JobCard` tests | Scoring and cross-stage regression coverage; existing intelligence/stabilization fixtures updated for version and independent competency support |
| `scripts/quality-summary.ts`, its tests, `.github/workflows/ci.yml`, `package.json`, `tsconfig.json`, `vitest.config.ts` | Formatting/reporting gates, strict CI-helper checks and reproducible benchmark command |
| `package-lock.json`, `package.json` | Scoped Electron security patch; optional Undici lock entry preserved |
| `README.md`, `CONTRIBUTING.md`, `packages/career/TAXONOMY.md`, `QUALITY.md` | Public usage, versions, pipeline map, decisions and measured limitations |

Private architecture/progress/next-step records remain under Git-ignored `/docs` and are not part of these commits. No version release/tag, push or Phase 4 implementation is performed.

## Final local verification

Windows / Node25.2.1, 2026-10-28: `npm run check` passed source formatting, lint with zero warnings, strict typecheck, **404 tests across 68 files**, all production bundles and **16 Electron E2Es** against Electron44.9.1. This includes the retained 1,000-job zero-AI ingestion, migrations, broker/policy boundaries, native OS vault, browser sandbox/isolation, imports, ranking/search/export, themes and main-loop responsiveness fixtures. `npm ci --dry-run --ignore-scripts`, `npm audit --audit-level=high` (zero vulnerabilities), `node scripts/quality-summary.ts` and `git diff --check` also passed. No unresolved local check failures remain.

Non-failing upstream/runtime diagnostics remain: experimental Node SQLite notice, Zod pure-annotation build warnings, and this workstation's existing npm `msvs_version` configuration warning. Hosted Linux/macOS results are not established by local Windows testing. Previously normalized posting dates are not retroactively reconstructed; malformed historical dates require a permitted source refresh.

## Reliability and responsiveness verification (2026-11-01)

Current policy bindings are `deterministic-v2.6`, `requirements-v7` and `canonical-candidate-v4`. Mandatory opaque requirements remain assessment gaps; material unresolved legal conditions remain UNKNOWN and block automatic shortlisting. The original Legacy v1 weights and saved custom profiles are preserved. Candidate evidence is indexed and prepared per batch; no new scoring worker, paid service or AI dependency was added. Alternative-skill explanations retain the actual matching skill and evidence IDs.

The versioned challenge cases are separate from the frozen provisional matching corpus. Frozen-corpus measurements remain P@10 0.3750, NDCG@10 0.9388, recall@5 0.9500 and labeled hard false-positive rate 0; these did not improve during this remediation. They do not validate broad hiring accuracy or establish acquisition recall. Independent recruiter labels remain pending.

Run the explicit diagnostic workloads serially in addition to `npm run check`:

```powershell
$env:ROVDO_PERFORMANCE='1'
npx vitest run packages/career/src/scoring-performance.test.ts packages/storage/src/scoring-performance.test.ts
Remove-Item Env:ROVDO_PERFORMANCE
```

The ignored `artifacts/candidate-performance.json` and `artifacts/sqlite-performance.json` record CPU time, RSS, heap deltas, maximum event-loop delay and cancellation, alongside wall time. Windows / Node25.2.1 measurements on this workstation:

| Skills | Before single job, ms (67c2968) | Current single job, ms | Current prepared 1,000 jobs, ms | Batch max loop delay, ms | Batch CPU, ms | RSS, MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 20 | 332.24 | 232.21 | 313.40 | 120.19 | 437 | 94.6 |
| 50 | 703.26 | 3.21 | 246.73 | 15.73 | 266 | 95.4 |
| 100 | 2368.77 | 4.74 | 198.40 | 11.59 | 187 | 96.2 |
| 150 | 5975.96 | 5.46 | 227.50 | 14.47 | 234 | 96.9 |
| 240 | 15434.65 | 9.18 | 268.64 | 8.63 | 250 | 97.7 |

The first 20-skill call includes cold extraction/JIT overhead. The event-loop monitor is primed before batch preparation; loop delay includes preparation and runtime scheduling/GC. Runs are diagnostics with uncontrolled host load, not a universal SLA. Heap deltas can be negative after GC and do not establish leak freedom. Before-change thousand-job batches were not run because even single large-profile calls took seconds.

SQLite / 150 skills / 1,000 distinct jobs (cold): 763.45 ms wall, 29.59 ms maximum loop delay, 844 ms CPU, 120.3 MiB RSS. SQLite / 150 skills / 1,000 distinct jobs (warm): 18.65 ms wall, 14.14 ms maximum loop delay, 47 ms CPU, 123.5 MiB RSS. Cancellation settled 1.13 ms after the abort callback (timer dispatch delay 5.55 ms). A separate 1,000-similar-listing ingestion completed in 2826.37 ms after eliminating repeated sibling metadata writes; the previous duplicate-heavy workload exceeded its 60-second test deadline. Duplicate candidates remain reviewable records rather than being deleted or assumed identical.

Career schema 6 adds transactional identity aliases/history. It retains source memberships, saved/applied markers, historical rankings and provenance, and exposes conflicting feedback for resolution. Rollback injection, restart, repeated updates and SQL/eligibility agreement are tested. Stricter optional pay/date read projections preserve historical JSON as stored; malformed new optional pay is quarantined without dropping valid sibling jobs. Derived filter metadata is rebuilt cooperatively, and changed policies invalidate disposable rankings without rewriting presets.

Expired discovery response/failure rows are pruned in bounded indexed batches. Durable jobs, saved opportunities, run checkpoints and historical ranking snapshots are retained. Historical snapshot deletion remains deferred until a user-visible retention policy exists. Source cache observations are not refreshed by replay, partial details cannot advance missing-job closure grace, and source failures remain observable.

Application-context fixtures cover long fact IDs, canonical identity and ranking/evidence hash changes, verified/non-conflicting claim selection, and readable historical v1 snapshots without decision metadata. New snapshots bind the corrected deterministic decision. Integrity validation does not prove current authorization, external factual truth, or permission to generate/submit; future consumers must use current approved inputs.

CI continues the existing Windows/Linux/macOS matrix and now attempts its aggregate synthetic report even after a preceding failure. Hosted Actions, Linux/macOS execution, live ATS/platform certification and native accessibility audits were not performed locally. Fixture-only Electron tests cover the actual local vault, browser isolation, CLI model selection and keyboard filter recovery. Source-specific policy restrictions remain enforced. No real submissions or paid provider calls are part of verification.

Delivery verification on 2026-11-01: `npm run check` exited 0 with 503 passing unit/integration tests across 82 passing files (three opt-in files skipped), all production builds and all 18 Windows Electron E2Es. Both explicit performance workloads passed separately. The native Codex hostile-provider smoke test was not rerun in this task; CLI fixture integrations were exercised. `npm run benchmark:matching`, the aggregate quality reporter, `npm ci --dry-run --ignore-scripts` and `git diff --check` passed. The install check was a dry run, not a fresh installed environment. `npm audit --audit-level=high` exited 0 with no high/critical findings and 11 moderate findings in the ESLint/TypeScript-ESLint/minimatch development-tool chain. Its suggested forced fix would downgrade ESLint incompatibly; no audit suppression or forced breaking change was applied. Compatible tooling remediation remains follow-up work. No unresolved local test failure remains.
