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
commit message; no special commit syntax or automatic version inference is required.
Update the changelog for user-visible changes. Report whether a test used mocks or
live Nebius; a scripted tool loop is not a hosted-model benchmark.

Never commit credentials, `.env` files, private fixtures, `node_modules`, or generated
benchmark results. The secret scanner scans Git-visible files and history, so a
credential committed and later deleted must still be revoked and removed from history.

Releases follow [docs/releasing.md](docs/releasing.md). Changes to workflow permissions,
tool checksum pins, dependency lockfiles, and authentication deserve particular review.
