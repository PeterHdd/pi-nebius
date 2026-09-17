# Changelog

Versions use Semantic Versioning. Entries describe changes included in the named version;
a version is released only when its matching Git tag and GitHub release are published.

## [0.3.2](https://github.com/PeterHdd/pi-nebius/compare/v0.3.1...v0.3.2) (2026-09-17)


### Bug Fixes

* launch benchmark workers from installed packages ([f7e717a](https://github.com/PeterHdd/pi-nebius/commit/f7e717a3454ae700451e63f54d78bda1d155d1dd))
* launch benchmark workers from installed packages ([cf516f7](https://github.com/PeterHdd/pi-nebius/commit/cf516f724d0d85ce921e4b0a6347bdcb6b251493))

## [0.3.1](https://github.com/PeterHdd/pi-nebius/compare/v0.3.0...v0.3.1) (2026-09-17)


### Bug Fixes

* enable automated npm publishing and simplify user documentation ([a90b4a4](https://github.com/PeterHdd/pi-nebius/commit/a90b4a40ce7d5bdc8bf8bddb7dc4777c4c68a269))
* enable automated npm publishing and simplify user documentation ([81b6348](https://github.com/PeterHdd/pi-nebius/commit/81b6348f9710d786ff6f8ae18b56716e8c594e73))

## [0.3.0](https://github.com/PeterHdd/pi-nebius/compare/v0.2.1...v0.3.0) (2026-09-17)


### Features

* add persistent per-model Nebius settings ([d1b3114](https://github.com/PeterHdd/pi-nebius/commit/d1b31146abf17d54aa43d57f5c9080072cea78e6))
* add persistent per-model Nebius settings ([b31dce1](https://github.com/PeterHdd/pi-nebius/commit/b31dce1087e41e41482a56634f3dc5f57213bae4))

## [0.2.1](https://github.com/PeterHdd/pi-nebius/compare/v0.2.0...v0.2.1) (2026-09-17)


### Bug Fixes

* clarify auth benchmark requirements and expand visible test ([557271b](https://github.com/PeterHdd/pi-nebius/commit/557271b74b30e457cdeca7b3e3d491e84903eca4))
* clarify auth benchmark requirements and expand visible test ([3d86156](https://github.com/PeterHdd/pi-nebius/commit/3d86156f41677cdd2672fe6b5196e44d2830b5c6))

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
