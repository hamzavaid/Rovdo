# Rovdo — Implementation and Future Roadmap

> **Scope:** Implementation roadmap from v0.1.0 through v1.0.0, followed by post-v1 feature proposals. Future work is not scheduled; version boundaries may change.
>
> **Design principle:** Local-first, bring-your-own-model (BYOM), deterministic where possible, and explicit approval for sensitive actions.

## Phase and release mapping

Phase numbers describe implementation stages; version numbers describe releases. The pre-v1 headings below organize the plan and do not assert that matching historical tags exist. The current documented preview is **v0.3.8, pre-Phase 4 stabilization**. Checked items describe locally implemented capabilities reported by the project documentation; they do not certify hosted CI, production readiness or completion of every release gate.

The original release cuts are developer preview = phases 0–2, Career MVP = phases 0–5, and v1.0 = phases 0–7. Phases 8–10 remain post-v1 extensions. Later release sections describe extensions and hardening as well as new features, so overlap with an earlier foundation does not mean the capability must be implemented twice.

| Phase | Implementation stage | Roadmap location |
| --- | --- | --- |
| 0 | Foundation | [v0.1.0](#v010--foundation-phase-0) |
| 1 | Desktop + BYOK | [v0.2.0](#v020--desktop--byok-phase-1) |
| 2 | Browser runtime | [v0.3.0](#v030--browser-runtime-and-career-discovery-phases-23) |
| 3 | Career profile + jobs | [v0.3.0 and v0.3.x](#v030--browser-runtime-and-career-discovery-phases-23) |
| 4 | Application documents | [v0.4.0](#v040--application-documents-phase-4) |
| 5 | Assisted apply / Career MVP | [v0.5.0](#v050--assisted-apply--career-mvp-phase-5) |
| 6 | Schedules + independent multi-agent execution | [v0.6.0](#v060--schedules--multi-agent-execution-phase-6) |
| 7 | Collaborative agents | [v0.7.0](#v070--collaborative-agents-phase-7) |
| 8 | Email + extension | [v1.2.0 extension](#v120--chrome-extension--career-personas) and [v1.3.0 email](#v130--email-sync-alerts--career-crm) |
| 9 | Desktop expansion | [v1.9.0 preview](#v190--native-desktop-control-preview) and [v2.0.0](#v200--cross-application-automation) |
| 10 | Optional remote/mobile | [v1.7.0 companion](#v170--mobile-companion--career-management) and [v2.0.0 supervision](#v200--cross-application-automation) |

## v0.1.0 — Foundation (Phase 0)

Status: implemented foundation; distribution and platform validation remain separate gates.

- [x] **Workspace:** npm monorepo, TypeScript contracts, lint, unit tests, build tooling and cross-platform CI configuration.
- [x] **Desktop skeleton:** Hardened Electron main/preload/renderer separation, bundled local assets and narrow validated IPC.
- [x] **Project controls:** Architecture decisions, enumerated diagnostics, schemas, initial threat model and internal privacy-policy draft.
- [x] **Developer entry point:** Reproducible setup instructions, contribution guidance and security reporting.

**Phase exit gate:** A clean setup, passing CI and a working skeleton application. CI configuration alone does not establish a passing hosted run.

## v0.2.0 — Desktop & BYOK (Phase 1)

Status: implemented in the local preview.

- [x] **Settings and providers:** React/Electron settings, provider registry, OpenAI/Anthropic and compatible endpoint adapters, configurable models and capability tests.
- [x] **Credentials:** Native secret entry and OS-vault storage without renderer key access or plaintext database storage.
- [x] **Chat:** Streaming text, bounded tool roundtrips, outbound review, explicit consent, cancellation and memory-only conversation context.
- [x] **Usage:** Reported tokens, versioned user-maintained pricing, estimated budgets and explicit unavailable accounting.

**Phase exit gate:** At least two providers and one compatible endpoint pass tool-call fixtures; preserve the credential, IPC and outbound-network boundaries. Live account compatibility remains separate from fixture success.

## v0.3.0 — Browser Runtime and Career Discovery (Phases 2–3)

Status: implemented and extended through the current v0.3.8 preview. This section groups the browser and career foundations within the pre-v0.4 release line.

- [x] **Phase 2 browser worker:** Disposable Playwright Chromium sessions, semantic DOM tools, deterministic scope/action policy, redacted events and pause/stop controls.
- [x] **Phase 2 approvals and recovery:** One-use action approval, bounded runs and restart reconciliation. Current browser tasks block final submission and network writes.
- [x] **Phase 3 profile:** Versioned candidate facts, evidence, explicit verification, preferences and PASS/FAIL/UNKNOWN eligibility.
- [x] **Phase 3 discovery:** Greenhouse, Lever and Ashby foundations; source registration, persisted incremental polling, rate limits, failure isolation and health reporting.
- [x] **Phase 3 retrieval and ranking:** SQLite FTS5/BM25, hard gates, deterministic scores, canonical deduplication, provenance, saved opportunities and shortlist UI without AI requirements.

**Phase 2 exit gate:** A mock multi-step web task finishes with observable evidence and no policy bypass.

**Phase 3 exit gate:** A 1,000-job fixture corpus ingests with zero model calls; ranking is stable, repeated polling is idempotent, and source-health/error and explicit eligibility-evidence checks pass.

### v0.3.x — Profile Intelligence and Stabilization

- [x] **v0.3.5 / Phase 3.5.1:** Structured evidence, curated taxonomy, requirement-centric ranking, immutable presets/custom configurations and bounded profile imports.
- [x] **v0.3.5 / Phase 3.5.2:** Approved saved-company discovery, source reliability, search filters, ranking management and Light/Dark/System appearance.
- [x] **v0.3.7:** Structured PDF/DOCX/LinkedIn import review, explicit merge confirmation and optional source-cited model assistance. Imported facts never verify themselves.
- [x] **v0.3.8:** Non-destructive legacy/structured evidence reconciliation, conservative eligibility/assessment, approved application-context integrity contracts and stabilization before document generation.
- [x] **Subsequent v0.3.8 refinements:** Public feed/list adapters, separate background company archive discovery, canonical board inventory, cache/lease recovery, cooperative ranking and truthful collection telemetry.
- [x] **Current workspace refinements:** Five Jobs pages, independent saved filters, real ranking previews, supported restricted CLI chat, bounded chat attachments and optional Windows offline dictation.

These additions preserve existing profile/job/history data, immutable ranking presets and AI-free discovery. The approved application-context contract prepares for Phase 4; it does not generate documents or authorize submission. See the [user guide](USER_GUIDE.md), [quality methods](QUALITY.md) and [verification scope](MISMATCH.md).

## v0.4.0 — Application Documents (Phase 4)

Status: planned; generation is not implemented in v0.3.8.

- [ ] **Grounded edits:** Generate resume and cover-letter changes only from explicitly approved candidate evidence and the selected job.
- [ ] **Versioned artifacts:** Bind profile, job, ranking, template and model versions; preserve reproducible document metadata and content hashes.
- [ ] **DOCX/PDF workflow:** Template-based editing, bounded conversion, rendered preview and layout verification.
- [ ] **Review and audit:** Show claim/evidence links and document diffs; flag unsupported claims and require explicit document approval.

**Phase exit gate:** No unsupported claim in a controlled 30-case corpus, with tests for stale inputs, unverified facts, invented credentials/dates/numbers, missing evidence and malicious posting instructions. Document approval does not grant upload or submission permission.

## v0.5.0 — Assisted Apply / Career MVP (Phase 5)

Status: planned; current browser workflows do not submit applications.

- [ ] **ATS mapping:** Map verified profile facts and approved answers/documents into supported application flows.
- [ ] **Evidence and confirmation:** Capture redacted action evidence, application state and confirmation outcomes.
- [ ] **Submission review:** Show the destination and final application contents; obtain fresh explicit approval before final submission.
- [ ] **Replay safety:** Use immutable submission identity, reconciliation and confirmation evidence to prevent duplicate final actions after timeouts or restart.

**Phase exit gate:** Three fixture ATS flows pass, with mandatory final-submit approval. A new contributor can configure a provider, import/verify a profile, discover/rank jobs, generate grounded documents, complete reviewed mock applications and reproduce the audit/security checks without a proprietary backend.

## v0.6.0 — Schedules & Multi-Agent Execution (Phase 6)

Status: planned beyond the existing saved-source polling and background company schedulers.

- [ ] **General scheduling:** IANA timezones, DST-aware recurrence, visible missed-run policy and durable scheduling while the desktop process is running.
- [ ] **Unified recovery:** Integrate career polling with durable scheduling/checkpoints while keeping source requests independent from model/browser budgets.
- [ ] **Independent agents:** Bound browser execution to one initially and up to three after resource preflight; isolate credentials, cookies, policy, context and accounting.
- [ ] **Resource controls:** Persist leases, enforce provider/origin rate limits and global/workflow budgets, and expose bounded queues and cancellation.

**Phase exit gate:** Parallel-run isolation, crash/restart deduplication, polling resumption, rate-limit and DST tests pass. Existing source schedulers alone do not satisfy this phase.

## v0.7.0 — Collaborative Agents (Phase 7)

Status: planned.

- [ ] **Task graph:** A coordinator proposes a dependency DAG; deterministic dispatch validates prerequisites, capabilities and cycle rejection.
- [ ] **Typed handoffs:** Versioned artifacts carry provenance, content hashes and least-privilege references between specialized agents.
- [ ] **Shared-state safety:** Transactional writes and fenced resource leases prevent conflicting edits and duplicate external actions.
- [ ] **Approval inheritance:** Child tasks remain within the approved policy/budget envelope; a coordinator cannot grant privileges or bypass human approval.
- [ ] **Execution graph UI:** Show task ownership, dependencies, handoffs, progress, failures and cancellation/recovery state.

**Phase exit gate:** A three-agent research → document → review fixture completes in dependency order with no conflicting writes. Tests also prove cross-agent secret/session isolation, policy enforcement, cancellation safety and reconstructable approval/handoff history.

## v0.8.0 — Integration and Release Hardening

Status: proposed release checkpoint across phases 0–7; not an additional numbered implementation phase.

- [ ] **Integrated acceptance:** Exercise profile → discovery → documents → assisted apply → scheduled/collaborative recovery using synthetic fixtures.
- [ ] **Platform validation:** Run hosted Windows/macOS/Linux checks and native credential/dialog, keyboard, zoom and assistive-technology review.
- [ ] **Privacy and operations:** Define retention/export/delete behavior, validate migrations and backup/restore, and review permitted live-source and provider compatibility separately.
- [ ] **Distribution:** Prepare installers, signing/update integrity, dependency/license inventory and security review.

**Exit gate:** Integrated acceptance and release checks have recorded evidence; unresolved mismatches and limitations are visible.

## v0.9.0 — Release Candidate

Status: proposed release checkpoint.

- [ ] **Stabilize contracts:** Freeze the intended v1 scope and validate clean installation and upgrades using preserved historical data.
- [ ] **Rehearse recovery:** Verify checkpoints, approvals, leases and submission deduplication across interruption/restart scenarios.
- [ ] **Release evidence:** Record platform results, security/dependency findings, known limitations and user-facing setup/recovery instructions.

**Exit gate:** No unresolved release-blocking issue remains; the release candidate satisfies the v1.0 acceptance checklist.

## v1.0.0 — Career Automation Release

Status: planned; encompasses phases 0–7. Native whole-desktop control and optional remote/mobile access remain later extensions.

- [ ] **Complete the core:** Verified profiles, AI-free discovery/ranking, grounded documents and explicitly reviewed assisted application flows.
- [ ] **Complete orchestration:** Durable timezone schedules, bounded independent agents and policy-governed collaborative task graphs.
- [ ] **Release safely:** Installable builds, reproducible checks, transparent cost/audit evidence, retention/recovery guidance and documented platform/security limitations.

**Release gate:** All phase 0–7 gates and release-candidate checks have evidence. No unapproved final submissions, cross-agent data leakage or silent duplicate external actions are accepted. Synthetic ranking metrics remain distinct from independent hiring-accuracy validation.

## Post-v1 Phase Exit Gates

The existing release proposals below expand the original later phases:

- **Phase 8 — Email + extension:** Opt-in inbox-status parsing and a native-messaging job queue; scoped permissions and correctly triaged synthetic interview events. Initial extension and email foundations are split across v1.2 and v1.3.
- **Phase 9 — Desktop expansion:** OS accessibility bridges and gated vision automation; per-OS permission, emergency-stop and adversarial tests. v1.9 introduces the preview; v2.0 targets production cross-application workflows.
- **Phase 10 — Optional remote/mobile:** A paired dashboard and a secure relay only when enabled; independent security review and a documented opt-in boundary. v1.7 introduces companion features; v2.0 extends supervision.

## v1.1.0 — Applications & Documents

- [ ] **Application tracker:** Store submitted/saved jobs, status history, dates, notes, deadlines, and attachments; export CSV/XLSX or sync selected Google Sheets.
- [ ] **Resume and letter templates:** Import existing DOCX/PDF references, preview layouts, and select or save reusable templates.
- [ ] **Application answer library:** Reuse user-approved screening answers; detect stale or conflicting facts before autofill.
- [ ] **Document version history:** Keep the exact resume, cover letter, and answers used for each application.
- [ ] **Application readiness check:** Flag missing documents, unsupported answers, unresolved eligibility, and submission blockers.
- [ ] **Job posting change detection:** Compare revisions to requirements, salary, deadline, and availability; alert for meaningful changes.
- [ ] **Backup and recovery:** Encrypted local data export/restore, migration validation, and selective deletion.

## v1.2.0 — Chrome Extension & Career Personas

- [ ] **Chrome extension:** Capture jobs from supported pages and send them to Rovdo for normalization, matching, and saving.
- [ ] **In-browser match preview:** Show technical fit, evidence confidence, eligibility, and gaps on captured postings.
- [ ] **Supervised autofill:** Fill supported ATS forms using verified profile facts and approved answers; user reviews before submission.
- [ ] **Career personas:** Reuse one verified evidence base with different target roles, saved ranking profiles, search filters, and document preferences.
- [ ] **Form diagnostics:** Detect unsupported controls, missing answers, changed selectors, and incomplete multi-step forms.
- [ ] **Secure desktop bridge:** Pair the extension using least-privilege permissions; never expose credentials or unrestricted profile data to websites.

## v1.3.0 — Email Sync, Alerts & Career CRM

- [ ] **Gmail connection:** Optional OAuth with limited scopes and securely stored tokens.
- [ ] **Application status updater:** Match emails to jobs; propose confirmation, interview, assessment, rejection, and offer updates, with review of uncertainty.
- [ ] **Saved-search alerts:** Notify users about new matching jobs, posting changes, and configurable qualification thresholds.
- [ ] **Recruiter CRM:** Contacts, outreach history, approved drafts, follow-up reminders, and interaction notes.
- [ ] **Career analytics:** Application funnel, response/interview rates, source comparisons, and document-version trends.

## v1.4.0 — Candidate & Application Optimization

- [ ] **Resume/cover-letter analysis:** Evaluate role alignment, unsupported claims, evidence quality, readability, and formatting.
- [ ] **LinkedIn optimization:** Suggest headline, About, experience, skills, and project improvements from verified facts.
- [ ] **GitHub optimization:** Recommend pinned repositories, profile README, repository descriptions, project documentation, and presentation improvements.
- [ ] **Skill-gap intelligence:** Identify frequently requested competencies missing from—or insufficiently evidenced in—the profile.
- [ ] **Learning roadmaps:** Suggest targeted coursework, practice, and portfolio projects aligned with actual job gaps.
- [ ] **Ranking calibration:** Collect corrections to match results and compare scoring presets using human-labeled evaluation sets.

## v1.5.0 — ATS, Model & Browser Reliability

- [ ] **More ATS integrations:** Add official or authorized employer feeds and broaden supported application forms, including permitted SmartRecruiters/Workday integrations.
- [ ] **Company intelligence:** Show documented technical stacks, compensation, role history, and relevant employer information.
- [ ] **More BYOM providers:** Support additional APIs and custom compatible endpoints without binding workflows to one model vendor.
- [ ] **Model capability checks:** Detect tool calling, vision, structured output, context limits, and other requirements before running tasks.
- [ ] **Local/offline models:** Integrate Ollama/LM Studio-compatible endpoints; permit workflows with no cloud inference where feasible.
- [ ] **Model benchmarking:** Compare configured models on repeatable tasks by success, latency, tokens, and estimated cost.
- [ ] **Model routing and fallback:** Choose models per workflow/step by capabilities, cost, privacy, and policy; require approval before sending sensitive data to a new provider.
- [ ] **Smart browser element recovery:** Prefer stable selectors and accessibility trees; fall back to vision or reviewed remapping when layouts change.

## v1.6.0 — Agent Integrations & Workflow Foundations

- [ ] **Local API and CLI:** Expose governed job search, qualification matching, document preparation, task execution, and application tracking.
- [ ] **Codex and Claude skills:** Let external coding agents call Rovdo workflows while preserving user approvals and submission limits.
- [ ] **MCP client:** Connect Rovdo to authorized external MCP tools with capability-scoped permissions.
- [ ] **MCP server:** Expose selected Rovdo tools and workflow results to compatible clients; do not expose unrestricted computer control.
- [ ] **Workflow builder:** Compose reusable browser, API, file, and career tasks with branching, approvals, schedules, and retries.
- [ ] **Parameters and typed data:** Support reusable variables, secrets references, validated JSON/file outputs, and data passing between steps.
- [ ] **Event triggers:** Start workflows from approved webhooks, inbox events, file changes, scheduled runs, or application-status changes.
- [ ] **Execution modes:** Support deterministic, AI-assisted, and hybrid workflows (use AI only when needed).

## v1.7.0 — Mobile Companion & Career Management

- [ ] **Mobile remote companion:** Pair devices to view job searches, application status, task progress, and alerts.
- [ ] **Remote approvals:** Approve or reject narrowly scoped pending operations; no default unrestricted remote desktop access.
- [ ] **Interview management:** Calendar integration, interview notes, job-specific preparation, and technical assessment practice.
- [ ] **References and recommendations:** Store consent-based contact information and application-specific references.
- [ ] **Offer comparison:** Compare salary, bonus, equity, benefits, location, and editable cost assumptions.
- [ ] **Negotiation assistance:** Prepare evidence-based questions and drafts; keep employer outreach user-approved.

## v1.8.0 — Workflow Recorder, Debugging & Platform Quality

- [ ] **Browser workflow recorder:** Capture approved browser actions and convert them into editable, parameterized workflows.
- [ ] **Replay and checkpoints:** Repeat verified steps, resume interrupted runs, and avoid duplicate irreversible actions.
- [ ] **Visual debugger:** Inspect per-step screenshots, DOM/accessibility state, inputs/outputs, model calls, failures, and approvals.
- [ ] **Assertions and simulation:** Check expected results after actions; dry-run against fixtures or isolated test environments.
- [ ] **Structured data extraction:** Extract validated tables, form data, and JSON from pages, documents, or supported apps.
- [ ] **Security and recovery:** Sensitive-data redaction, per-workflow permissions, secret scoping, prompt-injection boundaries, emergency stop, and safe compensating actions where possible.
- [ ] **Performance profiler:** Track step latency, retries, resource use, success rates, and estimated model cost.
- [ ] **Career portfolio generator:** Build optional public-facing portfolios from approved projects and professional evidence.
- [ ] **Plugin SDK:** Stable, permission-scoped integration contracts, compatibility tests, and documentation.
- [ ] **Command palette:** Global shortcut for searching jobs, launching workflows, and opening saved actions.

## v1.9.0 — Native Desktop Control Preview

- [ ] **Native UI adapters:** Prototype Windows UI Automation, macOS Accessibility, and supported Linux accessibility interfaces.
- [ ] **Desktop inspection and recording:** Identify windows and accessible controls; record limited, approved native actions.
- [ ] **Permission boundaries:** Scope actions by app/window; distinguish reversible actions from sensitive or irreversible ones.
- [ ] **Safety tests:** Isolated app fixtures, dry runs, action logs, interruption, emergency stop, and manual takeover.

## v2.0.0 — Cross-Application Automation

- [ ] **Production native control:** Reliable, supervised interaction with supported desktop applications.
- [ ] **Unified workflows:** Coordinate browser, desktop, files, APIs, and authorized external tools under one runtime.
- [ ] **Model-agnostic execution:** Run portable workflow definitions with deterministic steps or user-selected models.
- [ ] **Cross-app recovery:** Resume from validated checkpoints; verify outcomes before retrying destructive or external actions.
- [ ] **Mobile supervision:** Monitor native workflows and handle scoped remote approvals with an auditable action history.
- [ ] **Release hardening:** OS compatibility, security review, accessibility, performance, migration, and regression testing.

## v2.1.0 — Advanced Workflow Authoring

- [ ] **Natural-language workflow creation:** Convert user requests into editable plans; validate permissions and actions before execution.
- [ ] **Cross-app recorder/replay:** Extend recording to supported native applications and hybrid browser/desktop workflows.
- [ ] **Advanced workflow logic:** Loops, conditional branches, reusable subflows, input schemas, and parameter presets.
- [ ] **Adaptive execution:** Prefer deterministic selectors/actions; use approved AI to interpret ambiguity or propose repairs.
- [ ] **Workflow portability:** Import/export versioned, model-independent workflow definitions with dependency manifests.

## v2.2.0 — Automation Ecosystem & Sharing

- [ ] **Workflow sharing:** Export/import reusable workflows with clear inputs, required permissions, and compatibility checks.
- [ ] **Optional workflow marketplace:** Discover reviewed community templates; require user approval before installation or execution.
- [ ] **Plugin distribution:** Versioned packages, declared capabilities, signature/trust checks, isolation, and revocation controls.
- [ ] **Advanced QA:** Regression replay, synthetic UI-change fixtures, reliability benchmarks, and workflow compatibility diagnostics.
- [ ] **Optimization dashboard:** Compare workflows/models by successful outcome, runtime, failures, and cost; suggest explicit, reviewable improvements.