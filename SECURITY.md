# Security policy

This project accepts security fixes for the latest tagged 0.x release and
the default branch. Older versions receive no separate backports.

## Reporting

When this repository is hosted on GitHub, use **Security → Report a vulnerability**
if private vulnerability reporting is enabled. Do not put API keys, private code,
or exploitable details into a public issue. If private reporting is unavailable,
open an issue requesting a private contact without disclosing the vulnerability.
There is no dedicated security mailbox or response-time guarantee yet.

## Trust boundaries

- Pi extensions and built-in tools execute with your host user's access. The benchmark's
  file copies and separate processes are **not an OS sandbox**. Run untrusted tasks in
  a disposable environment. Agents may access paths outside the workspace.
- Benchmark definitions, setup commands, and validators are executable code: review them.
  Restored validators prevent ordinary accidental replacement, not malicious host access.
- The provider reads `NEBIUS_API_KEY`; its cache stores model metadata and a key fingerprint,
  not the key. The normal interactive Pi process inherits your shell environment.
- The benchmark sends its key over private parent/child IPC. Tool and validation subprocesses
  receive an allowlisted environment without that key. Traces redact the known key and bearer
  strings; arbitrary secrets in user fixtures or generated files cannot be reliably identified.
- Network inference sends task context and tool results to Nebius. Follow your own data policy.
- Cache/filesystem checks assume the same host user is trusted. They do not defend against
  an attacker concurrently replacing filesystem entries or controlling the parent process.

## Repository controls

Test/security CI uses read-only tokens and SHA-pinned Actions, no live credentials, and ordinary
`pull_request` triggers. After successful main-branch CI, Release Please updates a
release PR or publishes the merged release. Its dedicated repository-scoped token
is confined to the release workflow, which checks out no code and executes no
repository build scripts. npm publication is disabled with `private: true`.

`npm run security:check` verifies pinned official Gitleaks/actionlint binary checksums,
scans Git-visible first-party files and available commit history with redacted output,
and validates workflows. It downloads executable tools from GitHub. `npm audit` checks
known dependency advisories separately. Neither scan proves the absence of vulnerabilities.

See [the review record](docs/security-review.md) for findings and residual limitations.

The PR-description workflow uses `pull_request_target` and `workflow_run` only to
read GitHub metadata and update the PR body with a scoped write token. It never
checks out PR code, installs dependencies, or consumes workflow artifacts.
