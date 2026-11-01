# Security policy

Rovdo is an early development preview. There are no supported production releases or signed installers yet. Security fixes target the current main branch.

## Reporting a vulnerability

Use GitHub's **Security → Report a vulnerability** option when available. If private reporting is unavailable, contact the repository maintainer through the contact information on their GitHub profile to arrange a private channel. A public issue may request a private reporting channel, but should not contain exploit details.

Include the affected commit, operating system, a minimal reproduction with synthetic data, expected behavior, observed impact, and relevant redacted diagnostics. Never include API keys, passwords, cookies, resumes, or other personal data. Response times are not guaranteed during early development.

## Current security boundary

The desktop uses a sandboxed renderer with context isolation, specific validated preload methods, sender/main-frame checks, restricted local assets, and blocked renderer egress. Main-process SDK adapters handle model requests; no provider or vault module is importable by the renderer.

API keys enter through native password dialogs and persist only in the OS credential vault. The renderer receives credential status, never key values. SQLite stores nonsecret settings and numeric usage; chat stays in memory. SDK logs/tracing are disabled, errors are translated to fixed codes, and known credentials echoed across response fragments are redacted. Transient main-process/native memory necessarily holds credentials during authorized operations; no heap snapshots or raw error exports are collected by Rovdo.

Provider network controls restrict requests to the configured base path, validate and pin DNS destinations, reject redirects, preserve TLS verification, and permit HTTP only for explicit loopback-compatible endpoints. Provider streams and tool arguments have resource limits. Chat exposes the read-only `workspace_info` tool; later turns must match the visible, approved conversation revision. Tool traces are request-scoped, not hidden future chat history.

The browser runtime uses isolated sandboxed Chromium contexts and validated origin-scoped actions. Observation redaction removes input-like content before checkpoints and model payloads. Navigation and page network traffic remain policy-controlled; sensitive actions require explicit approval, and unsupported submission/upload/login capabilities are blocked. Observable completion assertions do not establish semantic completion of arbitrary real-world tasks. Job collection follows source permissions, robots policy and per-origin cooldowns; an unavailable source is not a successfully searched source.

Document, browser and optional Python workers provide process separation, timeouts and resource bounds. Node/Python processes and third-party native libraries run with the user's privileges: they are not OS security sandboxes against a compromised executable. CLI inference is main-process only, allowlisted, bounded and explicitly approved. Codex is restricted to the specifically verified interface/version and isolated configuration/tool settings; unsupported versions/modes fail closed. CLI-managed authentication is not copied into Rovdo. Remote CLI providers may transmit prompts and charge under their own subscriptions; unknown costs are not reported as free.

Candidate profiles, job evidence and settings are local plaintext SQLite, while API keys use the OS credential vault. Protect local account access, backups and exports accordingly. Optional PII redaction is heuristic and does not guarantee anonymization; review the disclosed outbound payload and destination before consent. Content hashes establish reproducibility and modification detection, not authenticity or an approval signature. Approved application snapshots contain only explicitly selected supported claims and record deterministic eligibility uncertainty; they do not authorize generation or submission.

Changes that expand IPC, network access, filesystem access, dependencies, permissions, or logging require explicit tests for the expanded boundary. Live external submissions and destructive actions must not be used in automated verification.
