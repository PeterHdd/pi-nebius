# Changelog

Versions use Semantic Versioning. Entries describe changes included in the named version;
a version is released only when its matching Git tag and GitHub release are published.

## [0.2.0](https://github.com/PeterHdd/pi-nebius/compare/v0.1.0...v0.2.0) (2026-09-17)


### Features

* add in-Pi benchmarks for custom prompts and bundled tasks ([615c800](https://github.com/PeterHdd/pi-nebius/commit/615c800975288242530a362ee7fd954e1ae08502))
* add Nebius provider and coding benchmarks for Pi ([a770213](https://github.com/PeterHdd/pi-nebius/commit/a7702139910c11afec35235fea785f1b805ad478))
* improve benchmark reporting and automate releases ([fbbca35](https://github.com/PeterHdd/pi-nebius/commit/fbbca35ecf46156616b74a4707d09f2fd85dbe8b))


### Bug Fixes

* **ci:** stabilize benchmark tests and target main branch only ([7ffc127](https://github.com/PeterHdd/pi-nebius/commit/7ffc127e90defa063fb6c66352385b2c9a3cfff1))
* support Pi Git installs without dev dependencies ([18ec13b](https://github.com/PeterHdd/pi-nebius/commit/18ec13b6afba14d3948409e89a358aa4eae0eab4))

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
