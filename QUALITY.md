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
