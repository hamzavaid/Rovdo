# Rovdo — Future Roadmap

> **Scope:** Feature tracker for releases after v1.0. Planned, not scheduled; version boundaries may change. Check items off as they ship.
>
> **Design principle:** Local-first, bring-your-own-model (BYOM), deterministic where possible, and explicit approval for sensitive actions.

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