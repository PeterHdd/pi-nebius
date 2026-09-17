# Contributing

Use Node 22.19+ on macOS or Linux. Pi development dependencies are locked to the
tested release; retain the lockfile and update both Pi packages together.

```bash
npm ci
npm run check
npm run version:check
npm run security:check
npm run package:check
```

`check` runs TypeScript, Biome, the build, and credential-free tests. Security checks
download checksum-pinned official tools; package checks install a temporary tarball
with the tested Pi peers. Both require network access. Tests need loopback sockets
and permission to launch/stop subprocesses. Do not provide live API keys to CI.

Keep changes focused and add regression tests for behavior changes. Use a descriptive
Conventional Commit message (`feat:`, `fix:`, `docs:`, or `chore:`). Release Please
generates the version and changelog; do not bump them manually. Report whether a test used mocks or
live Nebius; a scripted tool loop is not a hosted-model benchmark.

Never commit credentials, `.env` files, private fixtures, `node_modules`, or generated
benchmark results. The secret scanner scans Git-visible files and history, so a
credential committed and later deleted must still be revoked and removed from history.

Release Please generates changelog/version updates in a release PR; merging it publishes
the GitHub release after CI passes. The **Publish to npm** workflow then verifies the
tagged release and publishes the same version to npm with provenance. README updates
on npm ship with the next package version; pushing documentation alone does not publish.
Changes to workflow permissions,
tool checksum pins, dependency lockfiles, and authentication deserve particular review.

PR descriptions are maintained by the **PR description** workflow. Write meaningful
commit subjects and optional bullet points in commit bodies: these populate Changes.
Validation reports actual CI job/step outcomes for the latest PR commit and updates
when CI runs. Add context or live-testing evidence under Notes, outside the
`auto-pr` markers. The workflow preserves that text and leaves Release Please PRs
alone. It uses the built-in GitHub token; no additional secret or AI service is needed.
It becomes active after the workflow reaches the default branch. For existing PRs
without markers, it appends its generated section without deleting your description.


## npm trusted publishing setup

In the npm settings for `pi-nebius`, add a **GitHub Actions** trusted publisher:

- Organization or user: `PeterHdd`
- Repository: `pi-nebius`
- Workflow filename: `publish.yml`
- Environment: leave blank
- Allowed actions: enable direct publishing with `npm publish`

No npm token is required. Keep `RELEASE_PLEASE_TOKEN` configured: it allows the
GitHub release created by Release Please to trigger the publishing workflow.
See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/).

After merging a change, wait for CI and merge the generated release PR. Once the
GitHub release appears, check **Actions → Publish to npm**. If publishing fails,
fix the configuration and rerun the failed workflow. npm versions are immutable;
an already published version cannot be replaced. Do not republish `0.3.0` to update
its README: use the next Release Please version.
