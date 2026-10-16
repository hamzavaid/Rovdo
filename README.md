# Rovdo

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="apps/desktop/src/renderer/assets/inverted_rovdo_logo.png" />
    <img src="apps/desktop/src/renderer/assets/rovdo_logo.png" alt="Rovdo owl logo" width="240" height="240" />
  </picture>
</p>

A local-first, open-source desktop workspace for AI-assisted browser workflows, with bring-your-own-model support.

Rovdo is being built to help users discover relevant jobs, prepare fact-grounded application documents, and review browser actions before submission. Its planned discovery engine uses deterministic filters and local search without requiring an AI key. Model-assisted work will use a provider selected by the user.

**Status: Browser + Jobs developer preview.** Discover and rank jobs from public Greenhouse, Lever and Ashby company feeds without AI. Maintain a verified candidate profile and save opportunities. Optional BYOK models support streaming chat, advisory shortlist review and scoped browser tasks with human approvals. Document generation and application submission are planned for later milestones.

## Quick start

Prerequisites:

- Node.js 24 LTS and npm 11. The minimum supported Node version is 22.13.
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

## Browser workspace

Open **Browser**, choose a tested model and enter a task, start URL, exact allowed HTTPS origins, and visible text that will verify completion. Review the model destination and consent to sharing bounded page observations. A separate Chromium window opens with a fresh session. Review each proposed click, fill or selection before approving it; use **Pause** or **Stop** from Rovdo at any time.

The timeline persists verified action metadata and costs. Input values are excluded from observations and audit events. After a restart, interrupted runs pause for reconciliation; resuming opens a fresh browser without replaying past actions. CAPTCHA and MFA prompts pause for human review. The current browser worker supports public, read-only navigation and reversible DOM steps; final submissions, browser network writes, login credentials, uploads, downloads and screenshot retention are disabled. Authenticated session reuse and application submission belong to later milestones.

Limits are 20 actions, 50,000 tokens, an estimated $0.50 and five minutes per UI run. Missing model accounting stops continuation. Cost estimates are subject to provider billing and cannot guarantee the final charge.

## Candidate profile and job discovery

1. Open **Profile**, add facts with an evidence reference or explicit assertion, check each fact you verify, and save. Unverified facts do not affect matching. Legal work authorization and citizenship must be your own assertions. Set roles, exclusions, locations, work modes, seniority levels and salary preferences; ranking weights are editable and must sum to one. Structured JSON fact imports stay unverified and cannot overwrite existing facts. File-based resume parsing belongs to the document milestone.
2. Open **Jobs → Add a reviewed public company source**. Select Greenhouse, Lever or Ashby, enter the employer and its public board/tenant identifier, and confirm that you reviewed its access terms. Lever supports global and EU public endpoints. Sources default to daily polling and can be disabled or given another interval. No source directory or global job coverage is bundled.
3. Choose **Poll due sources**. Rovdo also checks due sources each minute while running. It respects persisted deadlines, one request per second per ATS origin, Retry-After cooldowns, bounded pages and failure backoff. Public reads require no model or private recruiter credentials. Source health distinguishes failures, empty feeds and searches with zero matches.
4. Search and filter by company, work mode or saved state. Results show a bounded score, verified skill matches, explicit gaps, tri-state eligibility evidence, provenance and scoring/profile versions. Browse in pages of 50. Hard failures are excluded by default; unknown requirements stay visible for review. Possible duplicates need review, while identical canonical targets are merged with their provenance preserved.
5. Save opportunities independently of any model. For optional AI notes, choose **Preview optional AI review**, select a model, review the exact outbound facts/job excerpt and destination, and approve transmission. UI reviews one saved job with an estimated $0.10 cap; the service supports at most five. Advisory notes cannot alter eligibility, ranking or source facts. Reviews are cached by content, profile and model versions.

Polling uses transactional page checkpoints and resumes interrupted cursors. Complete snapshots alone count toward the removal grace period; outages do not remove accepted or saved jobs. Conditional caching is used for whole-board responses when offered. Paginated Lever responses are read page by page, without assuming a page ETag validates the whole board. Source opt-out is checked again before accepting a response.

Eligibility extraction is deliberately conservative and supports a versioned set of explicit phrases; unsupported legal/education terms require review. Missing facts never become invented qualifications. Match scores are deterministic preferences, not a guarantee of suitability or legal eligibility. The synthetic 1,000-job corpus measures repeatability and known fixture labels, not live coverage or real-world accuracy. Candidate data is stored locally in SQLite; whole-database encryption is not claimed.

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
| `npm run build` | Compile renderer, main process, and preload into `apps/desktop/dist` |
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
packages/career/      Verified profile contracts, eligibility and weighted ranking
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

The renderer has no Node access and no direct network access. Its isolated preload exposes specific, schema-validated settings, chat, browser and career commands; every privileged request checks the owning window and main frame. The local asset protocol restricts file access; navigation, new windows, and device permissions are blocked. Application diagnostics accept only predefined metadata fields and do not serialize arbitrary messages or errors.

Provider settings, usage, profile versions, public jobs, source health, saved opportunities, advisory reviews and redacted browser checkpoints persist in `rovdo.sqlite` under Electron's application user-data directory. Keys stay in the OS vault, scoped to a profile and destination. SQLite is not encrypted; it contains no key values. Chat history stays in memory and is cleared when its window closes. Browser tasks and bounded observations are persisted for recovery; avoid including unnecessary personal information. Electron also creates normal local runtime/cache files.

There is no analytics or mandatory hosted applicant database. Hosted providers receive only the context you approve; their own retention policies apply. Main-process requests validate destinations, pin public DNS results and reject LAN/metadata targets. Provider and ATS requests reject redirects; browser redirects must remain inside the approved origin scope. Explicit loopback model endpoints are isolated from public browser/source permissions. SDK logging and tracing are disabled; ambient credential/header settings cannot replace the selected vault key. Local-first storage does not imply local inference.

See [SECURITY.md](SECURITY.md) for vulnerability reporting and [CONTRIBUTING.md](CONTRIBUTING.md) for development practices.

## License

Rovdo's original code is available under [Apache-2.0](LICENSE). Dependencies retain their respective licenses.
