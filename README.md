# Rovdo

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="apps/desktop/src/renderer/assets/inverted_rovdo_logo.png" />
    <img src="apps/desktop/src/renderer/assets/rovdo_logo.png" alt="Rovdo owl logo" width="240" height="240" />
  </picture>
</p>

Rovdo is a local-first, open-source desktop workspace for job discovery, verified candidate profiles, and optional AI-assisted chat and browser tasks.

**Status: v0.3.8, pre-Phase 4 stabilization.** Job collection, filtering and deterministic qualification matching work without an AI key. Bring your own API provider or a supported installed CLI for optional model assistance. Document generation and application submission are planned.

## Quick start

Use Node.js 24 LTS and npm 11. The minimum supported Node version is 22.23.2. Windows, macOS and Linux require a graphical desktop session. Dependency installation and the first Electron download need internet access.

```sh
git clone https://github.com/hamzavaid/Rovdo.git
cd Rovdo
npm ci
npx playwright install chromium
npm run dev
```

`npm run dev` builds and launches Electron; restart it after source changes. `npm start` launches an existing build. This is a development application; signed installers are not available. No Rovdo account or environment file is required. Linux credential entry needs an unlocked Secret Service vault and Zenity; see the [vault requirements](USER_GUIDE.md#os-credential-vault-requirements).

## Start using Rovdo

- **Profile:** add or import qualifications, review their evidence, and explicitly verify supported facts.
- **Jobs:** search retained jobs, collect from supported public sources, inspect qualification and eligibility separately, and save opportunities.
- **Models & Privacy / Chat:** configure an API profile or supported installed CLI, approve its connection test, then chat with the selected destination.
- **Browser:** run scoped public browser tasks with review of proposed interactions.

Historical archive URLs are discovery leads; current postings require live validation. Coverage depends on supported sources and their access policies. A score is an explainable indicator, not a hiring probability or guarantee of eligibility.

## Documentation

| Document | Purpose |
| --- | --- |
| [User guide](USER_GUIDE.md) | Profile/imports, jobs, ranking, sources, models, chat, browser and vault setup |
| [Contributing](CONTRIBUTING.md) | Development setup, commands, code map, tests and architecture boundaries |
| [Quality](QUALITY.md) | Matching policies, reproducible benchmarks, evidence and limitations |
| [Security](SECURITY.md) | Vulnerability reporting, privacy and trust boundaries |
| [Glossary](GLOSSARY.md) | Evidence, verification, eligibility and model terminology |
| [Implementation mismatches](MISMATCH.md) | Documentation checks and unresolved differences |
| [Future roadmap](FUTURE.md) | Longer-term feature proposals; extensions may overlap features already available |

Internal design documents and historical evidence remain in the Gitignored `docs/` directory. They are not required to build the public repository.

## Data and privacy

Candidate profiles, jobs and settings are stored locally in unencrypted SQLite. API keys use the OS credential vault. Chat and selected chat attachments stay in memory. Hosted APIs and CLI providers may receive approved content and charge under their own terms; local-first storage does not imply local inference. Review outbound payloads and destinations before approval. See [Security](SECURITY.md).

## License

Rovdo's original code is available under [Apache-2.0](LICENSE). Dependencies retain their respective licenses.
