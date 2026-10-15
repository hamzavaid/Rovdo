# Rovdo

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="apps/desktop/src/renderer/assets/inverted_rovdo_logo.png" />
    <img src="apps/desktop/src/renderer/assets/rovdo_logo.png" alt="Rovdo owl logo" width="240" height="240" />
  </picture>
</p>

A local-first, open-source desktop workspace for AI-assisted browser workflows, with bring-your-own-model support.

Rovdo is being built to help users discover relevant jobs, prepare fact-grounded application documents, and review browser actions before submission. Its planned discovery engine uses deterministic filters and local search without requiring an AI key. Model-assisted work will use a provider selected by the user.

**Status: foundation preview.** The current application provides a secure desktop shell, shared validation contracts, structured diagnostics, and automated checks. Provider connections, job discovery, document generation, and browser automation are planned; they are not available in this preview.

## Quick start

Prerequisites:

- Node.js 24 LTS and npm 11. The minimum supported Node version is 22.13.
- Git and a graphical desktop session on Windows, macOS, or Linux.
- Internet access for dependency installation and the first Electron binary download.

```sh
git clone https://github.com/hamzavaid/Rovdo.git
cd Rovdo
npm ci
npm run dev
```

The app opens the workspace overview with its connection and privacy status. No account, API key, or environment file is needed. This preview does not run automation or send application data to external services.

`npm run dev` builds the application and launches Electron. Restart it after source changes. To launch an existing build:

```sh
npm start
```

The build is a local development application, not an installer or signed release.

## Development commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Build and open the desktop application |
| `npm run build` | Compile renderer, main process, and preload into `apps/desktop/dist` |
| `npm run lint` | Lint source and configuration with zero warnings allowed |
| `npm run typecheck` | Check strict TypeScript contracts |
| `npm test` | Run Vitest unit and boundary tests |
| `npm run test:watch` | Run unit tests in watch mode |
| `npm run test:e2e` | Launch the built Electron app and verify isolation and local IPC |
| `npm run check` | Run lint, typecheck, unit tests, build, and desktop smoke |

Build before running E2E tests directly. Playwright drives Electron itself; no additional browser download is required. On headless Linux, install the system libraries and use a virtual display:

```sh
npx playwright install-deps chromium
xvfb-run --auto-servernum npm run check
```

CI runs the foundation checks on Windows, macOS, and Linux, plus a dependency audit.

## Project structure

```text
apps/desktop/         Electron main, sandboxed preload, React renderer
packages/shared/      Zod contracts, shared types, error codes
packages/agent-core/  Safe structured diagnostics; future runtime boundary
tests/e2e/            Electron smoke tests using synthetic data
scripts/              Build and launch helpers
.github/workflows/    Cross-platform CI
```

The stack is Electron, React, TypeScript, Vite, Zod, Vitest, and Playwright Test. Runtime and tooling versions are pinned in the workspace manifests and lockfile. Additional modules will be introduced with their development milestones.

## Privacy and security

The foundation renderer has no Node access and no direct network access. Its isolated preload exposes a single read-only metadata method. The local asset protocol restricts file access; navigation, new windows, and device permissions are blocked. Application diagnostics accept only predefined metadata fields and do not serialize arbitrary messages or errors.

Electron may create local runtime and cache files in the operating system's application-data directory. The preview has no analytics, model connections, credential storage, or applicant database. Future hosted-model features will require explicit data-sharing controls: local-first storage does not mean hosted inference stays on the device.

See [SECURITY.md](SECURITY.md) for vulnerability reporting and [CONTRIBUTING.md](CONTRIBUTING.md) for development practices.

## License

Rovdo's original code is available under [Apache-2.0](LICENSE). Dependencies retain their respective licenses.
