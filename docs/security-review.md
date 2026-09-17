# Local security and release review

Reviewed 2026-09-16 on macOS, Node 22.22.3, Pi 0.85.1. Scope: first-party provider,
discovery/cache, benchmark runner/worker, process execution, parsing, filesystem
isolation, credential handling, dependencies, packaging, and workflows. This targeted
engineering review is not an independent penetration test or audit certification.

## Findings addressed

| Finding | Resolution | Evidence |
| --- | --- | --- |
| Different fixture/validator path strings could alias or nest | Compare resolved directories and reject overlap | Tests for relative aliases, symlink aliases and nesting |
| Output parent symlinks could bypass lexical containment checks | Resolve existing ancestors before creating directories | Test for fixture alias with nonexistent output descendants |
| Fixture root could itself be a symlink | Require a real directory at the copy/hash root | Root-link regression test |
| `.env` variants and common key files were not ignored | Ignore `.env.*`, `*.pem`, `*.key`, logs and OS metadata | Git-visible source inspection |
| No repository CI/release controls | SHA-pinned read-only CI, dependency updates, security scans, version consistency, release PRs and automated releases | Local workflow/version validation |
| Accidental npm publication was possible | `private: true`, enforced by version checker; no publish workflow | Package metadata check |

These path fixes protect against static aliases/configuration mistakes, not a malicious
process concurrently changing files or using Pi's shell tools outside the workspace.

## Executed verification

- `npm audit --json`: zero known vulnerabilities, including development dependencies.
- Gitleaks 8.30.1: no findings in Git-visible first-party files, including untracked files.
  There are no commits, so history scanning was explicitly skipped. CI fetches full history.
- actionlint 1.7.12: workflow structure and expressions passed. Optional ShellCheck/Pyflakes
  integration is disabled consistently; those separate tools were not run.
- Security-tool binaries were downloaded from official releases and SHA-256 verified.
- Type checking, Biome lint, build, and 35 tests passed; none skipped.
- A clean tarball install with Pi 0.85.1 peers passed compiled extension import and CLI checks.
- Manifest/lockfile/changelog agreement and matching/mismatched tag checks passed.
- New-file whitespace checks reported no errors.

## Remaining boundaries

Pi tools, setup commands and validators retain host access. Workspace copies are not an
OS sandbox; use a disposable environment for untrusted tasks. A same-user attacker can
escape copies or change trusted files. See [SECURITY.md](../SECURITY.md).

Known credentials are redacted from benchmark traces, but arbitrary secrets in fixtures,
errors, validation logs and archived files cannot be identified reliably. Normal interactive
Pi inherits its shell environment. Dependency install scripts execute during source installs.

Scanners only cover known patterns/advisories; clean output is not proof of security.
No live Nebius acceptance was possible without credentials. GitHub Actions have not run
on GitHub; the configured OS/Node matrix is not claimed as remotely verified. No repository,
commit, tag, release or npm publication was created. Branch/tag rules, push protection and
private reporting must be enabled after repository creation.
