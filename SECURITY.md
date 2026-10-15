# Security policy

Rovdo is an early development preview. There are no supported production releases or signed installers yet. Security fixes target the current main branch.

## Reporting a vulnerability

Use GitHub's **Security → Report a vulnerability** option when available. If private reporting is unavailable, contact the repository maintainer through the contact information on their GitHub profile to arrange a private channel. A public issue may request a private reporting channel, but should not contain exploit details.

Include the affected commit, operating system, a minimal reproduction with synthetic data, expected behavior, observed impact, and relevant redacted diagnostics. Never include API keys, passwords, cookies, resumes, or other personal data. Response times are not guaranteed during early development.

## Current security boundary

The desktop uses a sandboxed renderer with context isolation, specific validated preload methods, sender/main-frame checks, restricted local assets, and blocked renderer egress. Main-process SDK adapters handle model requests; no provider or vault module is importable by the renderer.

API keys enter through native password dialogs and persist only in the OS credential vault. The renderer receives credential status, never key values. SQLite stores nonsecret settings and numeric usage; chat stays in memory. SDK logs/tracing are disabled, errors are translated to fixed codes, and known credentials echoed across response fragments are redacted. Transient main-process/native memory necessarily holds credentials during authorized operations; no heap snapshots or raw error exports are collected by Rovdo.

Network controls restrict requests to the configured base path, validate and pin DNS destinations, reject redirects, preserve TLS verification, and permit HTTP only for explicit loopback-compatible endpoints. Models can call only the built-in read-only `workspace_info` tool. Browser agents and consequential action approvals are not implemented yet.

Changes that expand IPC, network access, filesystem access, dependencies, permissions, or logging require explicit tests for the expanded boundary. Live external submissions and destructive actions must not be used in automated verification.
