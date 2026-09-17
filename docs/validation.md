# Validation record

Environment: macOS, Node.js **22.22.3**, published Pi / pi-ai **0.85.1**. Date: **2026-09-16**.

## Executed checks

- `npm install`: dependencies installed; npm audit reported zero vulnerabilities.
- `npm run typecheck`: passed against the published Pi types.
- `npm run lint`: passed (Biome recommended rules and formatting).
- `npm test`: **35 tests passed**, no skipped tests (19 provider tests and 16 benchmark tests). Requires permission to bind a local loopback socket.
- `npm pack --dry-run --json`: passed; package includes compiled CLI, extension source, four benchmark fixtures and validators, README, documentation, example configuration, and MIT license; excludes test transport, node_modules, and credentials.
- New-file diffs and package contents reviewed. This is a new standalone repository; no release was published.

## What the tests establish

The production provider delegates to Pi's actual adapter. Mocked HTTP adapter tests cover streaming text, system messages, temperature, maximum output tokens, usage totals, reasoning effort/content/replay, finish reasons, HTTP 401/404/429/500/503 errors, retry-header preservation, and AbortSignal propagation.

Discovery tests cover basic/rich model lists, mapping, duplicate and non-text model filtering, invalid JSON/schema, missing credentials, authenticated requests, cache TTL and permissions, key isolation, forced/empty refresh, stale fallback, 401/403 invalidation, corrupt/unwritable caches, bounded responses, and cancellation.

The **real bundled Pi CLI** is run in an isolated temporary directory with this package loaded by `-e`. A test-only transport routes its requests to a local HTTP server; no genuine API key is used. The test verifies:

1. The async extension loads discovered models before `--list-models`.
2. A subsequent Pi invocation selects the discovered model and reuses its cache.
3. The HTTP response streams a fragmented `write` function call.
4. Pi actually writes `nebius-test.txt` with `Hello from Nebius`.
5. Pi sends an assistant tool call and matching tool-result message in the next HTTP request.
6. The model's mocked final response completes the turn.
7. A disappeared model yields actionable diagnostics while preserving the server error and retry information.
8. `/nebius-refresh` bypasses a fresh cache.
9. Standard `models.json` can add offline models alongside the native catalog.
10. Missing credentials produce setup guidance without crashing Pi or requesting discovery.

These establish provider integration and agent/tool transport. They do **not** establish a live model's willingness or ability to call tools.

## Benchmark verification

The final type check, Biome lint, build, and complete 35-test regression suite passed. Benchmark tests cover definition parsing, copy isolation, event instrumentation, byte-preserving streaming observation, cumulative tokens, repeated-run aggregation, validation, failure classification, JSON serialization, cancellation, and hard worker timeouts. All four original fixtures fail their trusted checks; all four reference solutions pass.

`npm run benchmark:demo` passed with **two mock models × two runs** through real Pi SDK sessions. All four runs passed deterministic validation and shared one system-prompt hash. Each recorded two HTTP requests, two turns, one executed write tool, 320 cumulative input tokens, 60 output tokens, 50 cached input tokens, and seven reasoning tokens. These are scripted measurements, not hosted-model performance.

The retained local result is `benchmark-results/mock-demo-1789550582003/results.json`, with individual runs, traces, and archived workspaces alongside it. Result files are excluded from the distributable package. The demo initially encountered a sandbox IPC permission error and passed after running with the required permission; package inspection similarly required access to npm's cache.

Source changes and package contents were reviewed. v1 supports sequential runs only to preserve Pi's unmodified absolute-path system prompt; exact final context size, server generation time, pure agent overhead, and exact model revisions remain unavailable. See [benchmarking.md](benchmarking.md) for measurement boundaries and live acceptance instructions.

## Not executed

- **Authenticated Nebius discovery and live inference**: no `NEBIUS_API_KEY` was available. The unauthenticated model endpoint returned the expected credentials error; that is not a live inference test.
- **Interactive TUI visual testing**: normal model availability was exercised through Pi's real CLI/registry, not a screenshot of the terminal picker.
- **Every hosted model**, reasoning template, or vision input: requires model-specific live validation. No such claim is made.

To complete the live acceptance check, set `NEBIUS_API_KEY` and `NEBIUS_MODEL` locally and run `npm run test:live` from the source checkout. That script uses the genuine Pi CLI against Token Factory, validates a successful write-tool event, a final model response, and exact file contents, then removes its scratch directory. It may incur inference charges.
