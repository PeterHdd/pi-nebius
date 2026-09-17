# Changelog

Versions use Semantic Versioning. Entries describe changes included in the named version;
a version is released only when its matching Git tag and GitHub release are published.

## [0.1.0]

Development baseline before automated GitHub releases.

- Native Pi provider with authenticated Nebius model discovery and a private metadata cache.
- Agentic benchmark CLI with deterministic validation, isolated runs, request/tool traces,
  cumulative usage and four coding fixtures.
- Credential-free integration tests using real Pi sessions and mocked provider responses.
- GitHub CI, dependency updates, secret scanning, workflow validation, and automated changelogs and GitHub releases.
- Filesystem checks reject overlapping validator paths and symlinked fixture roots/output aliases.

Live Nebius acceptance remains outstanding. Supported baseline: Pi 0.85.1, Node 22.19+,
macOS/Linux; benchmark execution is sequential.
