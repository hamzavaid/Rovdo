# Rovdo user guide

This guide describes the v0.3.8 development preview. Start with [installation](README.md#quick-start). [Contributing](CONTRIBUTING.md) covers development and testing; [Quality](QUALITY.md) explains benchmark limits.

## Contents

- [Workspace navigation](#workspace-navigation)
- [Candidate profile and imports](#candidate-profile-and-imports)
- [Jobs](#jobs)
- [Ranking methods](#ranking-methods)
- [Source coverage and reliability](#source-coverage-and-reliability)
- [Connect a model and chat](#connect-a-model-and-chat)
- [Connect an installed AI CLI](#connect-an-installed-ai-cli)
- [Browser workspace](#browser-workspace)
- [Appearance and accessibility](#appearance-and-accessibility)
- [OS credential vault requirements](#os-credential-vault-requirements)
- [Privacy and security](#privacy-and-security)
- [Evidence and application readiness](#evidence-and-application-readiness)

## Workspace navigation

The sidebar groups implemented tools into **Workspace** (Overview, Chat, Browser), **Career** (Jobs, Profile), and **Settings** (Models & Privacy, Discovery & imports). Overview shows actual indexed jobs, saved opportunities, source health, model readiness, recorded collection/browser activity and API usage. **Review saved opportunities** opens Jobs with Saved only selected. Loading or unavailable data is identified explicitly. Pending actions show progress and prevent duplicate submissions; ongoing job collection identifies the sources being processed.

Light / Dark / System appearance applies across all workspaces and persists locally. Keyboard users can skip to content and use native buttons, disclosures and labeled controls. Chat prioritizes its conversation and bottom composer; **Budget & destination** exposes request limits. The first-model guide walks through configuration, the OS vault and an explicitly approved connection test.

## Candidate profile and imports

Open **Profile** to manage Skills, Experience, Education, Projects, Preferences, Imports, and identity/eligibility information. Add supported facts with evidence references or explicit assertions. Verify the facts you confirm, then save the candidate profile. Unverified facts do not contribute to matching. Citizenship, legal work authorization and clearance need separate explicit confirmation.

Use the specific Skill, Experience, Education, Project and Certification forms; **Other information** holds identity and eligibility assertions. Searchable skill chips and compact qualification rows open centered editors with fields, associated skills, verification and source evidence. **Cancel** discards editor changes; **Save to draft**, then **Save candidate profile**, persists them. Editing clears verification. Re-verification adds a user assertion while retaining original evidence. Adding supporting evidence preserves existing verified canonical skills.

Preferences cover target/excluded roles and employers, locations, work modes, seniority and salary. Select ranking configurations in Jobs; result filters do not edit the profile.

### Import and review

Imports use **Select source → Extract → Review → Confirm**. Extraction stays local and deterministic unless you explicitly request AI assistance. PDF text retains recoverable coordinates, column reading order and section boundaries. DOCX reads OOXML headings, tables, lists and hyperlink text without following links. Supported LinkedIn archive CSVs map columns directly; restricted LinkedIn pages are never scraped. TXT, Markdown, structured JSON and public GitHub imports remain supported.

Review grouped summaries, warnings, duplicate/conflict notices and source excerpts. Correct a record in its centered editor, select skills and projects in bulk, and individually review employment, education, certifications and conflicts, then explicitly confirm before merging. Imported legal/clearance assertions need separate confirmation. Re-imports link compatible evidence by qualification identity and preserve verified originals. Conflicting source records stay separate for individual review; select one consistent version. Repeated canonical skills share evidence; custom declared skills are allowed. Imported mentions and AI suggestions never verify themselves.

**Improve Extraction with AI** is optional. Choose an existing BYOM model with authentication/pricing, review the exact eligible source projection and destination, set a spend limit, and approve transmission. Detected contact details are redacted by default, with optional source-excerpt selection. Redaction is heuristic: inspect the exact payload. Legal/protected excerpts are always excluded. It creates a separate unverified preview with schema-validated, source-cited suggestions; it cannot add credentials or change verification. Deterministic importing and editing require no model. Requests use existing vault, adapter, network and usage-accounting boundaries.

Limits remain 5 MB per file, bounded archive expansion and a disposable worker with a 15-second processing limit. No OCR: scanned PDFs need text. Complex layouts, nested tables, date formats and unfamiliar terms may need manual correction. Missing end dates, including older records without an explicit ongoing flag, do not establish ongoing employment; school dates do not prove graduation. AI assistance uses at most 64,000 characters of eligible source data and does not support adding new employment/education/certification records. Review all suggestions. Extraction precision/recall tests use a small anonymized regression corpus; they are not population-level accuracy claims.

Local sources include PDF, DOCX, TXT, Markdown and structured JSON; LinkedIn uses your pasted content or archive ZIP. Public GitHub import reads repository metadata, languages and READMEs only after consent. The UI permits ten repositories (twenty through the validated service), respects persisted rate limits and stops after sixty seconds. Stars, forks and timestamps do not prove authorship, proficiency or employment duration. English text heuristics require review. Import drafts and source evidence persist locally in unencrypted SQLite; deterministic importing sends no document to an AI provider.

### Academic transcripts

**Import academic transcript** accepts text-based PDF/DOCX, TXT/Markdown and CSV course tables. Use identifiable **Course Code** and **Course Title** columns; term, credit and grade columns are optional. Coursework, grades and excerpts become an education proposal for review. They never establish employment, professional skill proficiency or graduation. Degree completion needs an explicit awarded/conferred statement and individual review. Ambiguous layouts produce warnings or an actionable error. OCR and arbitrary transcript-layout recognition are unavailable.

## Jobs

Jobs has five pages:

- **Find Jobs:** enter keyword, location and job type; choose **Find Jobs** to show retained jobs immediately and start collection. **All Filters** changes indexed results automatically without starting collection. Collection activity uses real backend stages and supports Pause, Resume and Stop.
- **Saved Jobs:** independent search, filters, sorting and pagination for saved opportunities, private notes and application status. Markers never submit an application.
- **Ranking Methods:** choose, clone, customize, compare or preview deterministic ranking configurations.
- **Scope & Collection:** choose Search All, Search All Saved Companies or Selected Company; select adapters, edit/reset the bounded profile-guided query plan, and inspect source health.
- **Companies:** inspect verified or pending-name inventory, search by provider/status, manage refresh intervals and explicit tests, enable/disable/remove boards, and review saved-directory sources and request history.

Find/Saved results offer 10/25/50 rows per page, defaulting to 10. Companies offers the same sizes and defaults to 25. Source inventory and result counts are distinct: a technically valid board can be empty or have an unresolved employer name. Coverage does not mean every job on the internet was searched. Posting links open through validated native IPC; unverified leads have no active verified-posting link.

### Collection scopes

**Search All** is the default and dynamically discovers public jobs/employers using verified qualifications and role/location preferences. With no verified profile it uses a broad generic query. Query planning excludes contact details, legal assertions and raw profile documents. **Search All Saved Companies** uses the approved directory; its starter employers are Figma, Palantir Technologies, Linear and SmartRecruiters. **Selected Company** collects due feeds for one saved employer. Older saved searches retain saved-company scope. Global validation never grants scheduled saved-company polling permission automatically. Disabled sources and opt-outs remain effective.

Scope and source choices persist locally. Source switches affect future collection, while result filters search retained records. Under **Sources, queries and collection settings**, use **Selected sources**, **All sources**, and **Show full source list** to inspect the catalog. Selected sources can still be blocked or need configuration; Collection health reports actual availability. Only supported adapters are offered.

Results appear as sources finish. Collection activity reports unique jobs, checked sources, companies and source issues; detailed health separates failures, empty feeds, zero matches, unresolved leads and quarantined records. Terminal states remain visible. Pause/resume/cancel preserves queries, cursors, cached responses and collected jobs. Interrupted global runs pause at restart. Saved sources are checked each minute while Rovdo is running. Concurrent work shares origin throttling and persisted Retry-After cooldowns. Five consecutive transient failures stop an affected task; a fresh search can retry a recovered source.

### Filters, saving and export

Filter by role family, internship season, graduation window, experience, location/remote jurisdiction, work mode, published annual pay/currency, posting age, minimum score, eligibility, employment type, source and verification status. Unknown pay/dates do not pass explicit numeric/freshness filters; unspecified graduation windows remain reviewable. Salary sorting does not convert currencies, so select a currency when comparing amounts. Sort by qualification, newest, salary or company. Hard failures are hidden by default; unknown requirements remain reviewable. Selecting FAIL while hiding excluded jobs offers a remedy to show them.

Details show skill matches/gaps, eligibility, assessment completeness, confidence, source/evidence excerpts, provenance, scoring/profile versions, comparisons and optional AI review. Save named searches, relevant/irrelevant feedback, applied/read markers and opportunities independently of any model. Conflicting feedback after identity merging requires explicit resolution. Markers and feedback never train or change technical scores. Removing a source preserves its opt-out, retained jobs and saved opportunities.

**Export page CSV/JSON** exports authoritative rows from the current page, scores and application URLs. Source-restricted rows are omitted with a count; candidate contacts are excluded. CSV cells are protected against spreadsheet formulas. Historical imported rows remain unverified; incomplete records remain unscored leads. The current UI does not offer the retired job-row import workflow.

For optional advisory notes, choose **Preview optional AI review**, select a model, inspect the exact facts/job excerpt and destination, then approve transmission. The UI reviews one saved job with an estimated $0.10 cap; the service supports at most five. Notes cannot change eligibility, ranking or source facts. Reviews are cached by content/profile/model versions. Deterministic workflows remain available without a model.

## Ranking methods

The display names Classic, Balanced Match, Strict Match, Flexible Match and Career Fit correspond respectively to Legacy v1, Technical Balanced v2, Technical Conservative v2, Technical Lenient v2 and Opportunity Hybrid. Stable IDs and preset weights are unchanged.

Open **Jobs / Ranking Methods**, select a method, then **Use as default ranking**. The default persists locally; selecting a preset for inspection does not change the active ranking.

| Preset                    | Purpose                                                                                                                                               |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Legacy v1                 | Original deterministic-v1 scoring and 35/20/15/20/10 weights                                                                                          |
| Technical Balanced v2     | Requirement-centric skills/experience/projects/seniority/role/depth/education/lexical weights of 30/19/14/10/8/7/4/3, normalized over active criteria |
| Technical Conservative v2 | Stronger verified-evidence thresholds and direct requirements                                                                                         |
| Technical Lenient v2      | More project and curated transferable-skill credit; hard legal restrictions still apply                                                               |
| Opportunity Hybrid        | Separate opportunity-fit method including location, salary and company preferences                                                                    |

Custom weight controls pair 0-100 sliders with number inputs. Optional **Auto-balance weights** redistributes other components automatically; **Normalize to 100%** normalizes an under-allocated draft. Confidence and coverage inputs are percentages while stored values retain their original scale. **Allocation preview** shows normalized component shares; **Before / After preview** evaluates the unsaved draft on a selected indexed job using the real deterministic scorer; **Compare methods** compares saved configurations. Neither changes the default. In manual mode their combined total cannot exceed 100; reduce one weight before increasing another. Saving requires a total of exactly 100. Existing relative weights are shown as percentage drafts without changing stored scores until you save. Threshold and gate descriptions explain shortlist rules and eligibility checks.

Built-in presets are immutable. Select **Clone selected ranking** beside **Use as default ranking**. The clone is automatically named `Name_clone` (with a numeric suffix if needed), selected, and opened for editing. Only custom/created configurations can be renamed; built-in names remain read-only. Edit its name, valid component weights, required/preferred multipliers, evidence floor, gates and shortlist thresholds; save and optionally make it the default. Renaming preserves revision history. Deleting a custom default returns to Legacy v1. Only components belonging to the selected method are editable. **+ Create custom method** starts from Balanced with an automatic clone name. Import/export configurations as copyable JSON through **Import / Export JSON**; imports receive a new identity and never overwrite an existing profile. **Reset custom configuration to preset** creates a new revision while preserving the custom name. Job cards can compare the selected ranking with another built-in or custom method against the same evidence; scores from different methods are not probabilities.

Technical scores use job requirements and bound verified evidence, not the number of skills on a resume. Related technologies are not automatically interchangeable. Missing evidence stays unknown; missing job criteria are inactive. Job details show normalized contributions, required-skill coverage, source excerpts, evidence IDs and algorithm/configuration versions. Preference fit and eligibility remain separate from technical qualification. BM25 retrieves jobs and does not dominate qualification scoring. [Taxonomy scope and primary references](packages/career/TAXONOMY.md).

Assessment completeness is separate from score, confidence and eligibility. Unsupported mandatory clauses remain visible for review; unpublished requirements do not imply full coverage. Unresolved material legal conditions prevent automatic shortlisting. Hard locations use normalized country/region comparisons; ambiguous jurisdictions remain UNKNOWN. Legacy v1 retains its original weights, with the same legal and expired-posting safeguards. Selecting **Eligibility: FAIL** while hiding excluded jobs displays a remedy to show those jobs explicitly.

Job identity updates merge canonical duplicates transactionally, retaining saved opportunities, applied markers and source history. Conflicting relevance feedback is displayed for explicit resolution. Existing databases migrate additively; custom ranking presets are retained. Cached collection results retain their original observation times, and explicit posting expiration is separate from temporary network failures.

Provisional hand-authored comparison fixtures measure Precision@10/NDCG@10 for regression analysis. Independent recruiter validation is pending. Research-derived weights are configurable starting points, not validated accuracy claims.

## Source coverage and reliability

| Integration                               | Working behavior                                                                     | Limitations                                                                                                            |
| ----------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Greenhouse, Lever, Ashby, SmartRecruiters | Resolve discovered public application URLs into employer-scoped API feeds            | No universal ATS endpoint; unknown employer identity stays unverified                                                  |
| Public employer JSON-LD                   | Read permitted `JobPosting` metadata and known ATS links                             | Robots checks, same-origin posting validation, no scripts/browser scraping                                             |
| Himalayas / Remotive                      | Public job APIs, pagination/cache, complete records through the existing scorer      | Cached/delayed data; supplied application links and visible source credit retained; redistribution exports disabled    |
| We Work Remotely                          | Public RSS with retained descriptions and source URLs                                | Aggregator availability remains unverified until employer evidence is available                                        |
| Four GitHub internship/new-grad lists     | Application-column links from public repository tables                               | Incomplete links remain unscored leads until a complete public posting resolves                                        |

The directory stores stable employer identities/aliases, board identifiers, provenance, policy status, verification hashes and refresh dates. **Verified source directory** shows coverage and health. Expired verification metadata on approved sources is refreshed during Search All Saved Companies; policy blocks and user opt-outs are preserved. An unsuccessful refresh cannot erase cached or saved jobs.

**Companies / Verify company URL** accepts a public careers URL or supported board URL and a reviewed access-policy reference. With your explicit permission it checks robots restrictions, reads one bounded page, and validates up to three supported feeds or same-origin `JobPosting` JSON-LD records. It does not recursively crawl or open restricted platforms. Manual tenant registration remains under **Advanced Source Management**. Workday is not enabled: no documented, authorized employer-specific integration was supplied, and there is no assumed universal Workday search API.

Collection uses at most three concurrent origins (hard maximum four), serial requests within each origin, persisted quotas, a two-minute source budget, bounded pages and Retry-After handling. SmartRecruiters uses documented company listing/detail routes with bounded paging. Invalid individual records are quarantined; partial snapshots cannot mark missing jobs closed. Empty feeds, failures and zero matching results remain distinct. Canonical company aliases and exact requisition/URL deduplication retain normalized source-specific records and provenance; approximate title/location duplicates remain flagged for review.

SQL applies structured filters and paginates after cached score ordering. Unchanged listing text avoids FTS rewrites. Qualification scores are reused across filters/searches; cache keys bind job content and eligibility state, candidate evidence/preferences, taxonomy/parser/scorer and ranking configuration. Time-dependent evidence (ongoing employment, graduation, expiring certifications) also binds the evaluation date. Legacy v1 retains its query-dependent BM25 behavior and may rescore when that lexical input changes. Search feedback does not train or alter the scorer.

Polling commits page checkpoints transactionally and resumes interrupted cursors. Only complete snapshots count toward missing-job grace; outages do not remove accepted/saved jobs. Lever pages are read separately: a page ETag does not validate a whole board. Source opt-out is checked before accepting a response. Redirects stop the affected task; certificate failures stop requests to that origin for one hour. TLS validation stays enabled.

### Automatic company inventory

Search All needs no API key, Python installation or configured search endpoint. Supported sources are Greenhouse, Lever (including EU), Ashby, SmartRecruiters, Remotive, Himalayas, We Work Remotely and the four Simplify/Vansh repository lists shown in Sources. Wayback CDX and Common Crawl add historical board leads through a separate background scheduler; Find Jobs never launches archive requests. Archive work yields to interactive collection and uses persisted daily request budgets/cursors. Low-yield Common Crawl partitions can sample an older published collection before resuming the primary scan. Archive URLs never establish current availability: Rovdo validates supported live ATS feeds, honors robots/access restrictions and reports blocked/incomplete coverage.

A local SQLite inventory keys companies by provider/tenant/region. Subsequent searches queue known named companies first while bounded archive/feed batches discover others. Queue cursors, cooldowns and cached responses persist; searches can pause/resume. ATS requests reuse one-hour caches, Remotive six-hour caches, Himalayas daily caches. No total-company/job cap is imposed. The latest unresolved-lead preview is limited to 20 rows; this is a display bound, not a collection limit. The current ATS adapters fetch bounded listing pages and existing required detail enrichment; speculative description fetching is avoided. Unresolved employer identities are retained for review rather than given invented names. Saved jobs, applications and collected records survive source retirement; legacy source selections migrate to keyless archive discovery. Search All Saved Companies retains its saved-directory scope.

If Collection health reports archive timeouts or HTTP 5xx errors, those index services are unavailable; waiting ATS adapters have not yet found employers. An archive-only selection offers **Search with recommended sources**, which restarts collection with independent public feeds and maintained job lists while preserving your filters and collected jobs. Previously successful enabled employer feeds are queued immediately. Archive scans retain failed scopes and continue through bounded fallbacks after cooldowns; unavailable scopes remain visible as partial coverage. No source selection changes silently.

### Archive discovery recovery

Common Crawl can read its published ZipNum index files when the query API is unavailable. Rovdo binary-searches 64 KiB directory windows and reads one compressed index block per checkpoint, with an 8 MB decompression bound and separate cache entries for byte ranges. It does not download entire index files or archived page content. Wayback can switch to native index-block pagination, preserve failed pages, and continue through remaining pages or ATS hosts. Repeated failures stop the affected scope; collection health reports partial coverage. Retry-After, access restrictions, cancellation, DNS pinning and TLS validation remain enforced. Wayback requests have a bounded 30-second deadline; other public requests retain the default deadline.

Historical HTTP ATS URLs are upgraded only for recognized supported hosts, with the original URL retained as evidence. Employer resolution uses live board roots and supported metadata rather than expired archived job pages. Archived URLs are leads; current jobs still require live ATS validation. Public index availability varies, and successful URL collection is not proof that every discovered employer is currently hiring.

Optional live smoke checks are disabled in normal CI: set `ROVDO_CC_INDEX_LIVE=1` for `packages/job-sources/src/common-crawl-index.test.ts`, or `ROVDO_WAYBACK_LIVE=1` for `packages/job-sources/src/discovery-live.test.ts`. These use public unauthenticated reads, not models or application submissions.

Source references: [Himalayas API](https://himalayas.app/docs/remote-jobs-api), [Remotive API terms](https://github.com/remotive-com/remote-jobs-api), [Wayback CDX](https://github.com/internetarchive/wayback/tree/master/wayback-cdx-server), [Common Crawl index](https://index.commoncrawl.org/). Provider availability and individual site permissions need separate operational review.

## Connect a model and chat

1. Open **Models & Privacy → New profile**. Choose a provider, enter a model ID available to your account, and set output-token and timeout limits. Hosted providers use their official endpoints. Compatible endpoints accept public HTTPS URLs or explicit loopback URLs such as `http://127.0.0.1:11434/v1`.
2. Enter the current input/output USD rates per million tokens, optional cached-input rate, and a pricing version or date. Save the profile. Rates are user maintained; no model names or prices are treated as permanent defaults. Pricing is optional for connection tests and required for budgeted chat. Use zero only for a verified free endpoint.
3. Choose **Enter API key securely**. A native password dialog sends the value directly to the privileged process and OS vault. There is no API-key input or read-key API in the web renderer. For a compatible server that requires no authentication, select **This compatible endpoint does not require an API key** instead.
4. Review the saved destination, approve the small connection-test prompt, and click **Test connection**. The test requests the read-only `workspace_info` tool with at most 128 output tokens and may incur API charges. Streaming, tools, and usage are detected from actual responses; untested features remain unknown.
5. Open **Chat**, select the profile, and set an estimated spend limit. Write a message, expand **Review outbound conversation**, and approve transmission before sending. Use **Stop response** to cancel or **+ New chat** to discard in-memory context.

Chat supports text and bounded tool-call roundtrips. The only executable tool is `workspace_info`, which returns public application metadata. Model output cannot execute browser actions, shell commands, or arbitrary tools. Rendering treats responses as text.

Failed or stopped exchanges are excluded from later model context. Requests are never silently replayed; retry explicitly after resolving an error. Rate-limit `Retry-After` cooldowns are honored. Editing a destination invalidates capability results and removes its old key; enter a new key and test again.

Usage distinguishes reported tokens from unavailable accounting. Cost estimates use the saved pricing version and separate cached-input rates. Missing rates, unsupported cache-write pricing, or absent provider usage produce an unavailable estimate. Budget preflight uses a conservative token estimate and bounds tool rounds; it is not a guarantee of the provider's final bill.

## Connect an installed AI CLI

Open **Models & Privacy → Connect your CLI**. Rovdo checks fixed executable names on PATH and common Windows/macOS/Linux installation paths when you open model settings; **Refresh CLIs** rescans. It never installs, updates, signs in or opens a login page automatically. Install/authenticate the CLI yourself using its official instructions. Credentials remain managed by the CLI; environment-only API credentials are deliberately not forwarded by Rovdo.

| CLI | Current integration |
| --- | --- |
| Claude Code | Restricted text chat on the documented 2.1.248+ version range within 2.1.x; all built-in/MCP tools, hooks, skills and session persistence disabled. Other versions are unavailable until reviewed. |
| Ollama | Installed model discovery via `ollama list`; text chat reuses Rovdo's compatible API at `127.0.0.1:11434/v1`. Start the server and install models separately. Rovdo never pulls a model. |
| OpenAI Codex | Restricted text chat for **0.165.0 only**. Tools, hooks, skills, user configuration and session persistence disabled; read-only sandbox and no approvals remain enforced. Other versions require another isolation review. |
| Gemini CLI, Qwen Code | Installation/version detection and saved model preferences; **restricted chat unavailable**. Their full tool/configuration isolation has not been verified here, so Rovdo does not run unrestricted inference. |

Codex retains its existing login; Rovdo never reads or copies its credentials. Codex **Default** uses the CLI's built-in model because user configuration is ignored; select a custom model ID if needed. Global `~/.codex/AGENTS.md` and `AGENTS.override.md` must be absent or empty: the reviewed CLI still loads them despite ignoring user configuration, so Rovdo refuses inference when either contains content. Rovdo never modifies those files. Refresh, save your model, then explicitly approve **Test** before selecting Codex in Chat. Text responses and reported token counts are supported; token streaming, vision, structured output and tool calling are not claimed. Read-only alone is insufficient to prevent file reads: the fixed tool/configuration restrictions are essential.

The opt-in native isolation test uses a temporary credential-free home and a hostile **local mock Responses server**, never a paid provider. In PowerShell, set `$env:ROVDO_CODEX_VERIFY_EXECUTABLE` to the absolute installed `codex.exe` path, then run `npx vitest run apps/desktop/src/main/codex-native.test.ts`. On macOS/Linux, export the same variable pointing to the native executable. The native check has been run on Windows with 0.165.0; other platforms still need native verification. Normal CI also tests mock Codex detection, restrictions, version changes, context, usage, settings and Electron chat.

Expand **Configure**, keep **Default** or choose a discovered/custom model ID, then save. Claude Default copies only the bounded `model` preference from `~/.claude/settings.json` into restricted mode; hooks, helpers and other user/project settings are not loaded. Without that preference, the CLI selects its default. Ollama has no configured chat default, so it uses the first alphabetically listed installed model. Ollama custom IDs must already appear in its installed list. Other CLIs do not have an assumed universal model-list command. Preferences and tested sharing permissions persist locally. An unchanged tested CLI/model reconnects after local detection on restart without an inference request. Executable/version, effective model or reviewed isolation-policy changes invalidate approval and require a new test and authorization. A failed test blocks chat until a successful re-test; it does not discard permission choices for the unchanged identity.

**Test** shows the exact small prompt and requires approval. Tests are cancellable and bounded to 20 seconds. After success, choose **Chat messages** and optionally **Selected files and folders** in the permissions dialog. Select **CLI · …** in **Chat**; ordinary messages use this remembered approval. **Manage access** in Chat or **Manage permissions / Revoke access** in Models & Privacy changes or removes it. Changing permissions clears that conversation. Review the outbound conversation at any time. Only completed exchanges are carried forward; stopping cancels the process/request. CLI connections accept text and selected text snapshots, without browser, shell or filesystem tools, vision or structured-output claims. Streaming is marked tested only when observed.

**Local executable does not mean local inference or free usage.** Claude and the other hosted CLIs may send content to remote services configured outside Rovdo; Ollama may use local or cloud-backed models. Subscriptions, usage limits and charges can apply. CLI cards/chat display **Cost unknown / managed by CLI**; Rovdo's API spending limits are not enforced for CLI usage. Rovdo adds no credentials, repository contents, candidate profile or jobs automatically. Explicitly attached content is sent as reference text; inspect it for secrets before sending. CLI-managed account identity is opaque to Rovdo: executable/model trust cannot detect an account switch inside the CLI; revoke approval when changing accounts or remote CLI configuration. CLIs remain trusted installed software, not OS-sandboxed untrusted programs.

Interface references: [Claude CLI flags](https://code.claude.com/docs/en/cli-reference), [Codex CLI](https://developers.openai.com/codex/cli/reference), [Gemini policies](https://geminicli.com/docs/reference/policy-engine/), [Qwen settings](https://qwenlm.github.io/qwen-code-docs/en/users/configuration/settings/), [Ollama compatibility](https://docs.ollama.com/api/openai-compatibility). Existing API profiles, budgeted tool chat and browser workflows remain available separately.

### Chat attachments and local dictation

Chat keeps its model selector and **+ New chat** above the scrollable conversation, with the composer at the bottom. **Enter** sends; **Shift+Enter** inserts a line break. API profiles retain per-message consent and estimated spending limits; CLI costs remain unknown/managed by the CLI.

Use **+ > Choose files / Choose folders** to select multiple local items through native pickers. Remove chips before sending or expand **Review outbound conversation** to inspect the exact text. Text/code files, PDF and DOCX are supported; images and binary attachments are unavailable. Selection snapshots are memory-only, expire after 30 minutes, and are bounded to 20 files, 5 MB source bytes per selection and 64 KB combined extracted text. Folder traversal is bounded; hidden entries, dependency/build trees and symbolic links/junctions are excluded. Oversized selections fail explicitly rather than silently truncating. PDF/DOCX extraction uses the existing isolated document worker. Selected folders grant a bounded snapshot, never ongoing access or CLI filesystem tools. Removing unsent chips or starting a new chat discards their capabilities. Sent reference content remains visible in the current in-memory conversation until reset.

The microphone beside Send offers optional offline dictation on **Windows with an installed System.Speech-compatible recognizer and desktop microphone permission**. Approve microphone use, then start/stop listening; text is added to the draft and never sent automatically. Listening stops when sending, resetting, leaving Chat, or closing Rovdo, with a five-minute session limit. Missing recognizers, microphone denial and unsupported systems leave typing available. Rovdo does not record/upload audio and has no remote transcription fallback; macOS/Linux dictation is currently unavailable. See Microsoft's [desktop recognition engine documentation](https://learn.microsoft.com/en-us/dotnet/api/system.speech.recognition.speechrecognitionengine.-ctor?view=netframework-4.8).

Windows dictation now dispatches recognition events from a compiled native .NET event bridge, with interim hypotheses, processing state and segment-based final-text deduplication. A controlled locally synthesized WAV is recognized by the production bridge in the opt-in test: set `ROVDO_SPEECH_VERIFY=1` and run `npx vitest run apps/desktop/src/main/dictation-native.test.ts`. No microphone is opened by this test. Real microphone/language quality is device-dependent and must be checked interactively; macOS/Linux remain explicitly unsupported instead of falling back to a nonfunctional Chromium or remote paid service.

## Browser workspace

Open **Browser**, choose a tested model and enter a task, start URL, then expand **Scope and safety settings** to enter exact allowed HTTPS origins and visible text that will verify completion. Review the model destination and consent to sharing bounded page observations. A separate Chromium window opens with a fresh session. Review each proposed click, fill or selection before approving it; use **Pause** or **Stop** from Rovdo at any time.

The timeline persists verified action metadata and costs. Input values are excluded from observations and audit events. After a restart, interrupted runs pause for reconciliation; resuming opens a fresh browser without replaying past actions. CAPTCHA and MFA prompts pause for human review. The current browser worker supports public, read-only navigation and reversible DOM steps; final submissions, browser network writes, login credentials, uploads, downloads and screenshot retention are disabled. Authenticated session reuse and application submission belong to later milestones.

Default limits are 20 actions, 50,000 tokens, an estimated $0.50 and five minutes per UI run. **Execution limits** permits bounded changes within the existing runtime policy. Editing task settings revokes consent. Missing model accounting stops continuation. Cost estimates are subject to provider billing and cannot guarantee the final charge.

## Appearance and accessibility

Use **Appearance** in the top bar to select **Light**, **Dark**, or **System**. The setting persists locally across restarts. System follows OS appearance changes automatically. Semantic colors apply to navigation, profiles, imports, search, cards, ranking, chat, models, browser controls and application dialogs; branding switches to the existing light/dark owl assets. Native window decorations and external OS dialogs remain subject to platform capabilities; the Windows credential dialog body follows Rovdo's selected appearance without exposing keys to the renderer.

Controls have labels and visible keyboard focus, a skip-to-content link, reduced-motion support and responsive layouts. Desktop tests cover both palettes, WCAG AA text contrast for semantic color pairs, keyboard operation and live System changes; hosted cross-platform/native-dialog appearance still needs CI/manual validation.

## OS credential vault requirements

- **Windows:** Windows Credential Manager; native entry uses Windows Forms through the built-in Windows PowerShell. No key is passed in process arguments or environment variables.
- **macOS:** Keychain and a native hidden-answer password dialog.
- **Linux:** an unlocked Secret Service vault (for example, GNOME Keyring) and Zenity for native entry. No in-memory-keyring or plaintext fallback is used. Compatible profiles explicitly configured without authentication do not need a vault.

On Ubuntu, install native entry/vault support with `sudo apt-get install gnome-keyring zenity dbus-x11`. Run inside a graphical desktop session with a session D-Bus and unlocked keyring. An unavailable vault is reported visibly and blocks credential-dependent requests.

An optional HTTPS CONNECT proxy can be configured without embedded credentials. TLS verification stays enabled. Authenticated proxies and provider-specific transports beyond the common text/function-tool API are not supported in this preview.

## Privacy and security

The renderer has no Node access and no direct network access. Its isolated preload exposes specific, schema-validated settings, appearance, chat, browser and career commands; every privileged request checks the owning window and main frame. The local asset protocol restricts file access; navigation, new windows, and device permissions are blocked. Application diagnostics accept only predefined metadata fields and do not serialize arbitrary messages or errors.

Provider/appearance settings, usage, profile versions, public jobs, directory/source health, saved searches, feedback/applied/read markers, ranking caches, saved opportunities, advisory reviews and redacted browser checkpoints persist in `rovdo.sqlite` under Electron's application user-data directory. Keys stay in the OS vault, scoped to a profile and destination. SQLite is not encrypted; it contains no key values. Chat history stays in memory and is cleared when its window closes. Browser tasks and bounded observations are persisted for recovery; avoid including unnecessary personal information. Electron also creates normal local runtime/cache files.

There is no analytics or mandatory hosted applicant database. Hosted providers receive only the context you approve; their own retention policies apply. Main-process requests validate destinations, pin public DNS results and reject LAN/metadata targets. Provider and ATS requests reject redirects; browser redirects must remain inside the approved origin scope. Explicit loopback model endpoints are isolated from public browser/source permissions. SDK logging and tracing are disabled; ambient credential/header settings cannot replace the selected vault key. Local-first storage does not imply local inference.

See [SECURITY.md](SECURITY.md) for vulnerability reporting and [CONTRIBUTING.md](CONTRIBUTING.md) for development practices.

## Evidence and application readiness

Technical ranking uses only verified, supported qualifications. Additional supporting sources cannot lower an existing qualification's confidence; extraction confidence, optional source reliability, and user verification are distinct. Verified contradictions exclude a claim until resolved. Legacy and structured qualifications are reconciled through a non-destructive compatibility view; original profile versions, saved jobs and ranking presets remain intact.

The local `ApprovedApplicationContext` contract prepares Phase 4 with an explicitly selected job, approved candidate claims and evidence, parsed requirements, ranking configuration, template reference and version/content hashes. `buildApprovedApplicationContext` creates a reproducible snapshot; `validateApprovedApplicationContext` checks its schemas and SHA-256 bindings. Hashes provide integrity checks, not authorization signatures. This release does not generate documents or submit applications.

New snapshots also bind a versioned deterministic decision, including unresolved eligibility and assessment completeness. Long fact references use full-ID SHA-256 bindings. Historical v1 snapshots remain readable; their hashes describe their captured content and do not establish current approval after evidence, job identity or ranking changes.

Import failures distinguish unsupported files, unreadable/scanned documents, malformed content, limits, timeouts, invalid proposals and provider failures. Your saved profile is unchanged after a failed import. Critical qualification review and the final merge confirmation remain separate steps. Deterministic import, editing, verification, discovery and ranking work without AI.

See [Security](SECURITY.md) for reporting and [Quality](QUALITY.md) for synthetic benchmark interpretation.
