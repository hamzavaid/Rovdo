# Matching and pipeline quality

Rovdo v0.3.8 is in pre-Phase 4 stabilization. Discovery and matching are deterministic and require no AI provider. Document generation, application submission and universal live-site coverage are unavailable. Usage is documented in the [user guide](USER_GUIDE.md); [Contributing](CONTRIBUTING.md#development-commands-and-platform-setup) owns development setup.

## Offline benchmark

Run `npm run benchmark:matching` from the repository root. The Vitest harness writes `artifacts/matching-benchmark.json`, including frozen baseline and current per-job scores, eligibility/review status, metrics, explicit as-of date and processing time. It also runs as part of `npm test`. The original 20-job backend comparison suite remains intact.

The extended corpus (`tests/fixtures/matching-benchmark.ts`) contains 34 distinct postings and four candidate scenarios: backend engineering, mechanical design, analytics and accounting. It covers seniority/duration gaps, exact and alternative skills, transferable skills, required/preferred distinctions, repeated requirements, unknown authorization/clearance and known degree mismatches. Baseline (`tests/fixtures/matching-baseline.json`) records the original deterministic-v2.1 / requirements-v3 / taxonomy-2 behavior at repository revision 6484937. Do not recapture the baseline after implementation changes. The capture switch is reserved for creating an explicitly versioned new benchmark, not for making regressions pass.

Labels were authored as provisional synthetic regression judgments before scorer changes, not supplied or independently reviewed by recruiters. Rubric: 3 = directly supported relevant qualifications with no known mandatory mismatch; 2 = supported core competencies with optional gaps or curated transfer; 1 = substantial gap or unresolved critical eligibility; 0 = unrelated mandatory competencies, track mismatch, or known hard disqualification. Grade >=2 is relevant. Hard-mismatch labels are separate explicit degree failures; missing information never becomes a known mismatch. No real-world accuracy claim follows from this small English-language corpus; independent held-out labels are still needed.

Metrics are macro-averaged by scenario. Precision@10 uses a fixed denominator of 10 even for eight-posting scenarios; its ceiling is therefore below 1. Precision@5, graded NDCG@5/@10, relevant recall@5, full returned-relevant recall, and hard-constraint false-positive rate are reported separately. Hard false positives count labeled known mismatches retained by eligibility filtering, not unknown cases. The harness repeats scoring in reverse input order and asserts exact score/order consistency. Latency covers both passes over 68 candidate/job pairs, including cold requirement parsing; throughput is host dependent, excludes network/UI time and is not an SLA. No performance threshold is imposed on noisy CI timing.

## Implemented pipeline boundaries

| Stage | Owner and contract | Failure/data safeguards |
| --- | --- | --- |
| Query planning and collection | `job-discovery`: saved `SourceConfig`/`SourceState`; global `DiscoveryRun`/tasks and registry | Qualification-only planning, policy checks, persisted per-origin quotas/cooldowns, bounded concurrency, timeouts and resumable checkpoints; restart pauses global work |
| Retrieval | `job-sources` ATS/public API/feed/index adapters | Public DNS-pinned GET transport, TLS, no redirects/auth/CAPTCHA bypass; isolated source failures and safe error codes |
| Parse and normalize | `AtsAdapter.normalizeDetailedAsync`, `DiscoveryRecordSchema`, `JobSchema` | Cooperative bounded pages, individual quarantine, null unknown dates/pay, source descriptions/excerpts and application URLs preserved |
| Dedup and persistence | `CareerStore.batch`/global ingestion, `source_record`, snapshots/provenance | Transactional writes, stable canonical/requisition identity, first-party precedence, uncertain duplicate review, saved IDs retained |
| Retrieval and filters | SQLite FTS5/BM25 and SQL metadata, streamed rows | Explicit null-aware filters, source scope separation, bounded result pages and bounded score preparation; BM25 primarily retrieves |
| Eligibility and matching | Pure `career` rules plus supported verified candidate evidence | PASS/FAIL/UNKNOWN, configurable gates and weights, separate technical/preference values, traceable requirement explanations |
| Ranking cache and history | `rank_cache`, requirement/ranking snapshots, versioned configuration/evidence hashes | Invalidate on job/candidate/config/date/policy changes; historical profiles/jobs/rankings remain readable |
| UI and export | Validated career IPC, job cards, `exportJobs` with native save capability | No renderer database/network access; visible uncertainty/source health, source-credit/export restrictions and CSV formula protection |

Tests include the 1,000-job, three-ATS zero-AI corpus, migrations, partial feeds, revocation, retries, identity/provenance, ranking caches, native export and Electron workflows. CI defines Windows/macOS/Linux gates; local Windows reports do not establish cross-platform success.

## Current matching and persistence policies

The documented policy bindings are `deterministic-v2.6`, `requirements-v7`, `canonical-candidate-v4` and `rovdo-taxonomy-3`. Earlier policy numbers in historical results describe those runs, not the current runtime.

- Scoring deduplicates equivalent requirements while retaining original source excerpts. Verified supported work/project competencies can contribute; repeated keywords or projects earn no bonus. Unknown versions and unsupported mandatory clauses remain assessment gaps.
- Relevant employment intervals are unioned. Missing or incomplete history stays unknown and cannot establish an invented duration or hard mismatch. Preferred degrees/experience do not become mandatory failures. Supported credential alternatives and expiration retain tri-state validity.
- Extraction confidence, source reliability, explicit verification and contradiction are distinct. Unverified or conflicting claims cannot score. Immutable presets, Legacy v1 weights, custom configurations and historical profiles remain preserved.
- Eligibility is PASS/FAIL/UNKNOWN, separate from score, confidence and assessment completeness. Material unresolved legal conditions block automatic shortlisting. Unsupported jurisdictions remain unknown; explicit expiration applies to Legacy and technical ranking.
- Requirement explanations retain the actual matched alternative skill and evidence IDs. Advisory AI review binds the selected ranking, query and canonical verified evidence; it cannot override eligibility or source facts.
- Cache keys bind actual named job fields, candidate evidence/preferences, configuration, parser/taxonomy/scorer policies and relevant evaluation date. Candidate preparation is reused within a batch; cooperative SQL/filter refresh yields rather than rewriting historical JSON.
- Canonical identity merges preserve source memberships, saved/applied markers, history and provenance; conflicting feedback needs resolution. Malformed historical optional pay/dates project as unknown without changing stored JSON. Partial snapshots cannot close missing jobs. Cached observations retain their original times.
- Only bounded expired response/failure caches are pruned. Durable jobs, saved opportunities, run checkpoints and ranking history remain retained pending a user-visible retention policy.

## Recorded benchmark comparison

The fixed 34-posting corpus produced these macro results on 2026-10-28. These are historical synthetic regression measurements, not a new run or validated hiring accuracy:

| Metric | Frozen baseline | Updated |
| --- | ---: | ---: |
| Precision@10 | 0.3750 | 0.3750 |
| NDCG@10 | 0.8647 | 0.9388 |
| Precision@5 | 0.6000 | 0.7000 |
| NDCG@5 | 0.8050 | 0.9284 |
| Relevant recall@5 | 0.7833 | 0.9500 |
| Full returned-relevant recall | 1.0000 | 1.0000 |
| Known hard-mismatch false-positive rate | 0.0000 | 0.0000 |

The labels and preset weights were unchanged. Regression floors guard Precision@10, NDCG@10, relevant recall and known hard false positives; repeat/reversal assertions guard determinism. The 2026-11-01 report recorded unchanged P@10 0.3750, NDCG@10 0.9388, recall@5 0.9500 and labeled hard false-positive rate 0. Independent recruiter validation remains pending.

## Performance diagnostics

Run performance workloads serially, separately from the normal quality gate:

```powershell
$env:ROVDO_PERFORMANCE='1'
npx vitest run packages/career/src/scoring-performance.test.ts packages/storage/src/scoring-performance.test.ts
Remove-Item Env:ROVDO_PERFORMANCE
```

On macOS/Linux, prefix the test command with `ROVDO_PERFORMANCE=1`. Ignored `artifacts/candidate-performance.json` and `artifacts/sqlite-performance.json` record wall/CPU time, RSS, heap deltas, event-loop delay and cancellation. The monitor is primed before batch preparation. Cold extraction/JIT, GC and host contention affect results; negative heap deltas do not prove leak freedom. Runtime diagnostics exclude network/UI time and establish no SLA. Historical numeric runs and delivery file manifests are preserved privately with their original provenance.

## Quality gates and limitations

`npm run check` runs pinned source formatting, lint, strict typecheck, unit/integration tests, production builds and Electron E2Es. `npm audit --audit-level=high` is separate. `npm run benchmark:matching` generates the ignored report; `node scripts/quality-summary.ts` validates and reports aggregate synthetic metrics. Missing/invalid benchmark data fails reporting; no applicant/source content should be uploaded by the reporter. Never recapture the frozen baseline to accommodate a regression.

The 2026-11-01 historical report recorded passing Windows checks and 11 moderate transitive development-tool findings, with no high/critical findings. These counts and advisory results are dated evidence, not current guarantees. Re-run checks for the revision being evaluated. Avoid forced incompatible dependency downgrades or audit suppression.

Remaining validation includes independent held-out recruiter labels; broader domain, credential, language and complex-document fixtures; policy-approved live-source reviews; hosted Windows/Linux/macOS CI; native screen-reader, zoom and accessibility checks; and release packaging/signing. Dictation, native CLI isolation and public-index live checks are explicitly opt-in and do not run as ordinary offline gates. Neither synthetic metrics nor a board's technical validity prove acquisition recall, live availability or candidate eligibility.

See [MISMATCH.md](MISMATCH.md) for this documentation cleanup's checks and limitations. Historical delivery logs are not fresh verification.
