# Rovdo

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="apps/desktop/src/renderer/assets/inverted_rovdo_logo.png" />
    <img src="apps/desktop/src/renderer/assets/rovdo_logo.png" alt="Rovdo owl logo" width="240" height="240" />
  </picture>
</p>

A local-first, open-source desktop workspace for AI-assisted browser workflows, with bring-your-own-model support.

Rovdo is being built to help users discover relevant jobs, prepare fact-grounded application documents, and review browser actions before submission. Its discovery engine uses deterministic qualification matching, filters and local search without requiring an AI key. Optional model-assisted work uses a provider selected by the user.

**Status: v0.3.5 - Automatic Job Discovery, Advanced Search & Dark Mode.** Discover and rank jobs across a verified directory of public Greenhouse, Lever, Ashby and SmartRecruiters employer feeds without AI. Maintain a verified candidate profile and save opportunities. Optional BYOK models support streaming chat, advisory shortlist review and scoped browser tasks with human approvals. Document generation and application submission are planned for later milestones.

## Quick start

Prerequisites:

- Node.js 24 LTS and npm 11. The minimum supported Node version is 22.23.2.
- Git and a graphical desktop session on Windows, macOS, or Linux.
- Internet access for dependency installation and the first Electron binary download.

```sh
git clone https://github.com/hamzavaid/Rovdo.git
cd Rovdo
npm ci
npx playwright install chromium
npm run dev
```

The app opens the workspace overview without a Rovdo account or environment file. Configuring providers does not make a network request; connection tests, chat and browser model requests require explicit consent.

`npm run dev` builds the application and launches Electron. Restart it after source changes. To launch an existing build:

```sh
npm start
```

The build is a local development application, not an installer or signed release.

## Connect a model and chat

1. Open **Models & Privacy → New profile**. Choose a provider, enter a model ID available to your account, and set output-token and timeout limits. Hosted providers use their official endpoints. Compatible endpoints accept public HTTPS URLs or explicit loopback URLs such as `http://127.0.0.1:11434/v1`.
2. Enter the current input/output USD rates per million tokens, optional cached-input rate, and a pricing version or date. Save the profile. Rates are user maintained; no model names or prices are treated as permanent defaults. Pricing is optional for connection tests and required for budgeted chat. Use zero only for a verified free endpoint.
3. Choose **Enter API key securely**. A native password dialog sends the value directly to the privileged process and OS vault. There is no API-key input or read-key API in the web renderer. For a compatible server that requires no authentication, select **This compatible endpoint does not require an API key** instead.
4. Review the saved destination, approve the small connection-test prompt, and click **Test connection**. The test requests the read-only `workspace_info` tool with at most 128 output tokens and may incur API charges. Streaming, tools, and usage are detected from actual responses; untested features remain unknown.
5. Open **Chat**, select the profile, and set an estimated spend limit. Write a message, expand **Review outbound conversation**, and approve transmission before sending. Use **Stop response** to cancel or **New conversation** to discard in-memory context.

Chat supports text and bounded tool-call roundtrips. The only executable tool is `workspace_info`, which returns public application metadata. Model output cannot execute browser actions, shell commands, or arbitrary tools. Rendering treats responses as text.

Failed or stopped exchanges are excluded from later model context. Requests are never silently replayed; retry explicitly after resolving an error. Rate-limit `Retry-After` cooldowns are honored. Editing a destination invalidates capability results and removes its old key; enter a new key and test again.

Usage distinguishes reported tokens from unavailable accounting. Cost estimates use the saved pricing version and separate cached-input rates. Missing rates, unsupported cache-write pricing, or absent provider usage produce an unavailable estimate. Budget preflight uses a conservative token estimate and bounds tool rounds; it is not a guarantee of the provider's final bill.

## Workspace navigation

The sidebar groups implemented tools into **Workspace** (Overview, Chat, Browser), **Career** (Jobs, Profile), and **Settings** (Models & Privacy). Overview shows actual indexed jobs, saved opportunities, source health, model readiness, recorded collection/browser activity and API usage. **Review saved opportunities** opens Jobs with Saved only selected. Loading or unavailable data is identified explicitly. Pending actions show progress and prevent duplicate submissions; ongoing job collection identifies the sources being processed.

Light / Dark / System appearance applies across all workspaces and persists locally. Keyboard users can skip to content and use native buttons, disclosures and labeled controls. Chat prioritizes its conversation and bottom composer; **Budget & destination** exposes request limits. The first-model guide walks through configuration, the OS vault and an explicitly approved connection test.

## Browser workspace

Open **Browser**, choose a tested model and enter a task, start URL, then expand **Scope and safety settings** to enter exact allowed HTTPS origins and visible text that will verify completion. Review the model destination and consent to sharing bounded page observations. A separate Chromium window opens with a fresh session. Review each proposed click, fill or selection before approving it; use **Pause** or **Stop** from Rovdo at any time.

The timeline persists verified action metadata and costs. Input values are excluded from observations and audit events. After a restart, interrupted runs pause for reconciliation; resuming opens a fresh browser without replaying past actions. CAPTCHA and MFA prompts pause for human review. The current browser worker supports public, read-only navigation and reversible DOM steps; final submissions, browser network writes, login credentials, uploads, downloads and screenshot retention are disabled. Authenticated session reuse and application submission belong to later milestones.

Default limits are 20 actions, 50,000 tokens, an estimated $0.50 and five minutes per UI run. **Execution limits** permits bounded changes within the existing runtime policy. Editing task settings revokes consent. Missing model accounting stops continuation. Cost estimates are subject to provider billing and cannot guarantee the final charge.

## Candidate profile and job discovery

1. Open **Profile**, choose Skills, Experience, Education, Projects or Identity & eligibility, and add facts with an evidence reference or explicit assertion, check each fact you verify, and save. Unverified facts do not affect matching. Legal work authorization and citizenship must be your own assertions. Use **Preferences** for roles, exclusions, locations, work modes, seniority levels and salary preferences; ranking configurations are selected in Jobs. Under **Imports**, import a local PDF, DOCX, TXT, Markdown or structured JSON profile, paste your LinkedIn content, or choose your LinkedIn archive ZIP. Public GitHub imports read repository metadata, languages and README files only after consent. Edit the preview, select qualifications to verify, and merge; verified originals are preserved. Citizenship, authorization and clearance need separate explicit confirmation. Scanned PDFs require text or a different source; OCR is not included.
2. Open **Jobs**, choose a **Search scope**, and select **Search**. **Search All Companies** is the default scope; no employer name or ATS tenant identifier is required. The finite starter directory contains Figma (Greenhouse), Palantir Technologies (Lever), Linear (Ashby), and SmartRecruiters, validated on 18 October 2026. Sources start daily polling after the first search and remain enabled across restarts. Coverage reflects these supported employers, not every company worldwide. Choose **Selected company** to search one employer using the same filters. Jobs separates **Search & results**, **Ranking & matching**, and **Sources & coverage**. Compact **Saved searches** stay below the results; source controls are in Sources & coverage. Disable a source beside its title in the verified directory, or remove it with the small **x** in its Source health card; subsequent searches preserve your opt-out. Removal keeps collected jobs, saved opportunities and source evidence. Enable it again explicitly in the directory or add it under Advanced Source Management.
3. Results appear as sources finish. Use **Refresh employer feeds** in the search section to collect due verified feeds. Rovdo also checks due sources each minute while running. It respects persisted deadlines, one request per second per ATS origin, Retry-After cooldowns, bounded pages and failure backoff. Public reads require no model or private recruiter credentials. Source health distinguishes failures, empty feeds and searches with zero matches.
4. Search and expand **Advanced search filters** for role family, internship season, graduation window, experience level, location/remote jurisdiction, work mode, published annual salary/currency, posting age, minimum score and eligibility outcome. Unknown salary or posting dates do not pass explicit numeric/freshness filters. Graduation filtering retains unspecified windows for review. Filters narrow results without changing the candidate profile or ranking configuration. Results show a bounded score, verified skill matches, explicit gaps, tri-state eligibility evidence, provenance and scoring/profile versions. Browse in pages of 50 after score ordering. Save named searches, mark jobs relevant/irrelevant, record an applied marker, or mark postings as read. Feedback and applied markers never change technical qualification scores or submit an application. Hard failures are excluded by default; unknown requirements stay visible for review. Possible duplicates need review, while identical canonical targets are merged with their provenance preserved.
5. Save opportunities independently of any model. For optional AI notes, choose **Preview optional AI review**, select a model, review the exact outbound facts/job excerpt and destination, and approve transmission. UI reviews one saved job with an estimated $0.10 cap; the service supports at most five. Advisory notes cannot alter eligibility, ranking or source facts. Reviews are cached by content, profile and model versions.

### Choose a ranking method

Open **Jobs / Ranking & matching / Ranking preset**, select a method, then **Use as default ranking**. The default persists locally; selecting a preset for inspection does not change the active ranking.

| Preset | Purpose |
| --- | --- |
| Legacy v1 | Original deterministic-v1 scoring and 35/20/15/20/10 weights |
| Technical Balanced v2 | Requirement-centric skills/experience/projects/seniority/role/depth/education/lexical weights of 30/19/14/10/8/7/4/3, normalized over active criteria |
| Technical Conservative v2 | Stronger verified-evidence thresholds and direct requirements |
| Technical Lenient v2 | More project and curated transferable-skill credit; hard legal restrictions still apply |
| Opportunity Hybrid | Separate opportunity-fit method including location, salary and company preferences |

Technical Skills uses searchable category chips with verification indicators. Select a chip to review its evidence or edit it; **+ Add** opens evidence-backed skill entry. Import previews use compact skill chips with one selected editor.

Structured qualification records expose source evidence and editable fields. Editing clears verification; explicit re-verification adds a user assertion without deleting the original evidence. Save candidate profile to persist the revised record.

Custom weight controls pair 0-100 sliders with number inputs. Optional **Auto-balance weights** redistributes other components automatically; **Normalize to 100%** normalizes an under-allocated draft. Confidence and coverage inputs are percentages while stored values retain their original scale. **Allocation preview** shows normalized component shares; **Preview saved ranking** compares real indexed jobs using saved configurations. Unsaved edits are not used in job-score previews. In manual mode their combined total cannot exceed 100; reduce one weight before increasing another. Saving requires a total of exactly 100. Existing relative weights are shown as percentage drafts without changing stored scores until you save. Threshold and gate descriptions explain shortlist rules and eligibility checks.

Built-in presets are immutable. Select **Clone selected ranking** beside **Use as default ranking**. The clone is automatically named `Name_clone` (with a numeric suffix if needed), selected, and opened for editing. Only custom/created configurations can be renamed; built-in names remain read-only. Edit its name, valid component weights, required/preferred multipliers, evidence floor, gates and shortlist thresholds; save and optionally make it the default. Renaming preserves revision history. Deleting a custom default returns to Legacy v1. Only components belonging to the selected method are editable. **Create technical ranking** starts from Balanced with an automatic clone name. Import/export configurations as copyable JSON under **Manage ranking profiles**; imports receive a new identity and never overwrite an existing profile. **Reset custom configuration to preset** creates a new revision while preserving the custom name. Job cards can compare the selected ranking with another built-in or custom method against the same evidence; scores from different methods are not probabilities.

Technical scores use job requirements and bound verified evidence, not the number of skills on a resume. Related technologies are not automatically interchangeable. Missing evidence stays unknown; missing job criteria are inactive. Job details show normalized contributions, required-skill coverage, source excerpts, evidence IDs and algorithm/configuration versions. Preference fit and eligibility remain separate from technical qualification. BM25 retrieves jobs and does not dominate qualification scoring. [Taxonomy scope and primary references](packages/career/TAXONOMY.md).

Import limits are 5 MB per local file and bounded decompression/text extraction. Text heuristics currently recognize English section/date patterns; review every preview. Public GitHub imports are limited to ten repositories in the UI (twenty through the validated service), respect persisted rate limits and stop after sixty seconds. Stars, forks and timestamps do not prove authorship, proficiency or employment duration. Imports and profile review drafts are stored locally in unencrypted SQLite; no document is sent to an AI provider by importing it.

Provisional hand-authored comparison fixtures measure Precision@10/NDCG@10 for regression analysis. Independent recruiter validation is pending. Research-derived weights are configurable starting points, not validated accuracy claims.

### Source coverage and reliability

The directory stores stable employer identities/aliases, board identifiers, provenance, policy status, verification hashes and refresh dates. **Verified source directory** shows coverage and health. Expired verification metadata on approved sources is refreshed during Search All Companies; policy blocks and user opt-outs are preserved. An unsuccessful refresh cannot erase cached or saved jobs.

**Discover another permitted employer source** accepts a public careers URL or supported board URL and a reviewed access-policy reference. With your explicit permission it checks robots restrictions, reads one bounded page, and validates up to three supported feeds or same-origin `JobPosting` JSON-LD records. It does not recursively crawl or open restricted platforms. Manual tenant registration remains under **Advanced Source Management**. Workday is not enabled: no documented, authorized employer-specific integration was supplied, and there is no assumed universal Workday search API.

Collection uses at most three concurrent origins (hard maximum four), serial requests within each origin, persisted quotas, a two-minute source budget, bounded pages and Retry-After handling. SmartRecruiters uses documented company listing/detail routes with bounded paging. Invalid individual records are quarantined; partial snapshots cannot mark missing jobs closed. Empty feeds, failures and zero matching results remain distinct. Canonical company aliases and exact requisition/URL deduplication retain normalized source-specific records and provenance; approximate title/location duplicates remain flagged for review.

SQL applies structured filters and paginates after cached score ordering. Unchanged listing text avoids FTS rewrites. Qualification scores are reused across filters/searches; cache keys bind job content and eligibility state, candidate evidence/preferences, taxonomy/parser/scorer and ranking configuration. Time-dependent evidence (ongoing employment, graduation, expiring certifications) also binds the evaluation date. Legacy v1 retains its query-dependent BM25 behavior and may rescore when that lexical input changes. Search feedback does not train or alter the scorer.

### Appearance and accessibility

Use **Appearance** in the top bar to select **Light**, **Dark**, or **System**. The setting persists locally across restarts. System follows OS appearance changes automatically. Semantic colors apply to navigation, profiles, imports, search, cards, ranking, chat, models, browser controls and application dialogs; branding switches to the existing light/dark owl assets. Native window decorations and external OS dialogs remain subject to platform capabilities; the Windows credential dialog body follows Rovdo's selected appearance without exposing keys to the renderer.

Controls have labels and visible keyboard focus, a skip-to-content link, reduced-motion support and responsive layouts. Desktop tests cover both palettes, WCAG AA text contrast for semantic color pairs, keyboard operation and live System changes; hosted cross-platform/native-dialog appearance still needs CI/manual validation.

Polling uses transactional page checkpoints and resumes interrupted cursors. Complete snapshots alone count toward the removal grace period; outages do not remove accepted or saved jobs. Conditional caching is used for whole-board responses when offered. Paginated Lever responses are read page by page, without assuming a page ETag validates the whole board. Source opt-out is checked again before accepting a response.

Eligibility extraction is deliberately conservative and supports a versioned set of explicit phrases; unsupported legal/education terms require review. Missing facts never become invented qualifications. Match scores are deterministic indicators, not a guarantee of suitability or legal eligibility. The synthetic 1,000-job corpus measures repeatability and known fixture labels, not live coverage or real-world accuracy. Candidate data is stored locally in SQLite; whole-database encryption is not claimed.

## OS credential vault requirements

- **Windows:** Windows Credential Manager; native entry uses Windows Forms through the built-in Windows PowerShell. No key is passed in process arguments or environment variables.
- **macOS:** Keychain and a native hidden-answer password dialog.
- **Linux:** an unlocked Secret Service vault (for example, GNOME Keyring) and Zenity for native entry. No in-memory-keyring or plaintext fallback is used. Compatible profiles explicitly configured without authentication do not need a vault.

On Ubuntu, install native entry/vault support with `sudo apt-get install gnome-keyring zenity dbus-x11`. Run inside a graphical desktop session with a session D-Bus and unlocked keyring. An unavailable vault is reported visibly and blocks credential-dependent requests.

An optional HTTPS CONNECT proxy can be configured without embedded credentials. TLS verification stays enabled. Authenticated proxies and provider-specific transports beyond the common text/function-tool API are not supported in this preview.

## Development commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Build and open the desktop application |
| `npm run build` | Compile renderer, main process, preload and bounded import worker into `apps/desktop/dist` |
| `npm run lint` | Lint source and configuration with zero warnings allowed |
| `npm run typecheck` | Check strict TypeScript contracts |
| `npm test` | Run Vitest unit and boundary tests |
| `npm run test:watch` | Run unit tests in watch mode |
| `npm run test:e2e` | Verify Electron isolation, native-vault use, settings restart, and mock-provider chat |
| `npm run check` | Run lint, typecheck, unit tests, build, and desktop smoke |

Build before running E2E tests directly. Playwright drives Electron and isolated Chromium fixtures; install Chromium with `npx playwright install chromium`. Tests use synthetic credentials in the real OS vault and remove them afterward. Provider HTTP responses are mocked or served by an explicit loopback fixture; no paid provider requests are made. On headless Linux, install system libraries and run an isolated D-Bus/keyring session with a virtual display:

```sh
npx playwright install-deps chromium
sudo apt-get install gnome-keyring zenity dbus-x11 libdbus-1-3
dbus-run-session -- sh -c 'printf "rovdo-ci-fixture\n" | gnome-keyring-daemon --unlock --components=secrets; xvfb-run --auto-servernum npm run check'
```

CI is configured to run these checks on Windows, macOS, and Linux, plus a dependency audit. Local acceptance has been verified on Windows; other platforms require their CI results before release.

## Project structure

```text
apps/desktop/         Electron main, sandboxed preload, React renderer
packages/shared/      Zod contracts, shared types, error codes
packages/agent-core/  Policy, approvals, bounded browser loop, safe diagnostics
packages/browser-worker/ Disposable Chromium sessions and semantic DOM tools
packages/career/      Versioned requirements, eligibility, taxonomy and pure ranking
packages/profile-import/ Bounded document, LinkedIn archive and public GitHub imports
packages/job-sources/ Greenhouse, Lever and Ashby public-feed adapters
packages/job-discovery/ Durable polling, origin quotas and failure recovery
packages/providers/   Provider-independent gateway and official SDK adapters
packages/storage/     SQLite WAL settings, run checkpoints, jobs and FTS5
tests/e2e/            Electron, vault, browser and career checks with synthetic data
scripts/              Build and launch helpers
.github/workflows/    Cross-platform CI
```

The stack is Electron, React, TypeScript, Vite, Zod, Vitest, and Playwright Test. Runtime and tooling versions are pinned in the workspace manifests and lockfile. Additional modules will be introduced with their development milestones.

## Privacy and security

The renderer has no Node access and no direct network access. Its isolated preload exposes specific, schema-validated settings, appearance, chat, browser and career commands; every privileged request checks the owning window and main frame. The local asset protocol restricts file access; navigation, new windows, and device permissions are blocked. Application diagnostics accept only predefined metadata fields and do not serialize arbitrary messages or errors.

Provider/appearance settings, usage, profile versions, public jobs, directory/source health, saved searches, feedback/applied/read markers, ranking caches, saved opportunities, advisory reviews and redacted browser checkpoints persist in `rovdo.sqlite` under Electron's application user-data directory. Keys stay in the OS vault, scoped to a profile and destination. SQLite is not encrypted; it contains no key values. Chat history stays in memory and is cleared when its window closes. Browser tasks and bounded observations are persisted for recovery; avoid including unnecessary personal information. Electron also creates normal local runtime/cache files.

There is no analytics or mandatory hosted applicant database. Hosted providers receive only the context you approve; their own retention policies apply. Main-process requests validate destinations, pin public DNS results and reject LAN/metadata targets. Provider and ATS requests reject redirects; browser redirects must remain inside the approved origin scope. Explicit loopback model endpoints are isolated from public browser/source permissions. SDK logging and tracing are disabled; ambient credential/header settings cannot replace the selected vault key. Local-first storage does not imply local inference.

See [SECURITY.md](SECURITY.md) for vulnerability reporting and [CONTRIBUTING.md](CONTRIBUTING.md) for development practices.

## License

Rovdo's original code is available under [Apache-2.0](LICENSE). Dependencies retain their respective licenses.
