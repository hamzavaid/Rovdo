# Security policy

Rovdo is an early development preview. There are no supported production releases or signed installers yet. Security fixes target the current main branch.

## Reporting a vulnerability

Use GitHub's **Security → Report a vulnerability** option when available. If private reporting is unavailable, contact the repository maintainer through the contact information on their GitHub profile to arrange a private channel. A public issue may request a private reporting channel, but should not contain exploit details.

Include the affected commit, operating system, a minimal reproduction with synthetic data, expected behavior, observed impact, and relevant redacted diagnostics. Never include API keys, passwords, cookies, resumes, or other personal data. Response times are not guaranteed during early development.

## Current security boundary

The foundation uses a sandboxed renderer with context isolation, a narrow read-only preload bridge, validated IPC, restricted local assets, and blocked renderer egress. It does not yet implement credential storage, model providers, browser agents, or an action approval engine.

Changes that expand IPC, network access, filesystem access, dependencies, permissions, or logging require explicit tests for the expanded boundary. Live external submissions and destructive actions must not be used in automated verification.
