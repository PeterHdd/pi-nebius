# GitHub-only releases

The repository is prepared locally. No GitHub remote, branch rules, commits, tags,
or releases are created by these files. `private: true` prevents accidental npm
publication; it does not prevent a public GitHub repository or Pi Git installation.

## Repository setup (once, on GitHub)

1. Use [PeterHdd/pi-nebius](https://github.com/PeterHdd/pi-nebius), set `main` as the default branch, and push the reviewed source.
2. Verify the `repository`, `homepage`, and `bugs` URLs in package.json point to
   `PeterHdd/pi-nebius`.
3. Enable Actions with read-only default workflow permissions. Allow the official
   SHA-pinned checkout/setup-node Actions. No Nebius or npm secrets are required.
4. After the first CI run, protect `main`: require pull requests, resolved conversations,
   and the **Required checks** status; block force pushes and branch deletion.
   Consider one approving review when there is another maintainer. These repository
   settings cannot be enforced by merely committing YAML files.
5. Restrict creation/update/deletion of `v*` tags to maintainers using a tag ruleset.
   Enable Dependabot alerts/security updates and private vulnerability reporting.
   Enable secret scanning and push protection where available for the repository.

CI runs on pushes to main/master, pull requests, manual dispatch, and weekly schedules.
It tests Node 22.19.0/24 on Linux and Node 22 on macOS. The security job checks all
dependency advisories (fails at high severity), first-party secrets, Git history, and
workflow syntax. Dependabot opens weekly npm and pinned-Action update PRs; no auto-merge
is configured. Custom security-tool versions/checksums in `scripts/security-tools.json`
must be reviewed and updated manually from official release metadata.

## Version policy

- Package version, root lockfile versions, changelog section, and `vVERSION` tag must agree.
- Use SemVer: patch for compatible fixes, minor for features. During 0.x, breaking
  changes also increment the minor version and must be called out explicitly.
- Benchmark JSON uses its own `schemaVersion`; incompatible result-format changes
  increment that independently and require migration notes.
- Pi wildcard peer dependencies follow Pi's package rules. The exact development
  versions and lockfile define the tested baseline, not a promise of all-version compatibility.

For a subsequent version:

```bash
npm version patch --no-git-tag-version
# Add the matching version entry and release notes to CHANGELOG.md.
npm run version:check
npm run check
npm run security:check
npm run package:check
```

For the initial release, keep 0.1.0 and review its existing changelog entry. Complete
the documented live provider tool-call check and two-model benchmark before describing
the release as live-validated. Otherwise clearly retain the outstanding live-validation limitation.

Commit/review the changes first. Then, from the reviewed commit on the default branch:

```bash
git tag -a v0.1.0 -m "pi-nebius v0.1.0"
git push origin v0.1.0
```

Use the actual version for later releases. Never move an existing release tag.
The tag workflow reruns CI and checks the tag/version agreement. Only then does a
separate job create a **draft prerelease**, with no npm publishing or credentials.
Review the generated notes, add validation evidence/limitations, and publish the draft
manually on GitHub when ready. All drafts default to prereleases; explicitly change
that designation only when appropriate. Reruns leave an existing release unchanged.

Users install a tag with `pi install git:github.com/PeterHdd/pi-nebius@v0.1.0`.
For a new pinned version, run the same command with its new tag. GitHub provides source
archives automatically. The extension loads TypeScript through Pi without a build.
The optional benchmark CLI is built explicitly in a development checkout; build output
is not committed. `npm pack` builds it automatically for package archives.

## Workflow security

Actions are pinned to full commit hashes; checkout does not persist credentials.
PR jobs have read-only tokens, use no repository secrets, and do not run under
`pull_request_target`. The final release job alone has `contents: write`; it checks
out no code and runs no repository scripts. Expressions are passed through environment
variables rather than interpolated into shell commands. No cross-run dependency cache
is used. See [GitHub's secure-use guidance](https://docs.github.com/en/actions/reference/security/secure-use).
