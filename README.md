# pi-nebius

Nebius Token Factory models in Pi's normal model picker, discovered using your API key.

This package also includes **benchmarks inside Pi**: run `/nebius-benchmark` to enter your own task prompt and compare models on copies of your current project. Results appear in Pi. A standalone CLI also supports scripted tasks and deterministic validation. See [Benchmarking](docs/benchmarking.md) for the CLI, result schema, metrics, and four ready-to-run fixtures.

```bash
npm ci
npm run build
npm run benchmark -- --benchmark benchmarks/fix-auth-bug \
  --models 'EXACT_MODEL_ID_A,EXACT_MODEL_ID_B' --runs 3 \
  --output benchmark-results/auth-comparison
```

Results appear directly in the terminal: each run prints its pass/fail status, followed by a comparison table of success counts, mean input/output tokens, median task duration, observed time to first token (TTFT), end-to-end output throughput, turns, and tool calls. Detailed JSON reports, traces, and workspaces are also saved under `benchmark-results/`; `--output` chooses the directory.

Set `NEBIUS_API_KEY` first. `npm run benchmark:demo` exercises the real Pi runner with scripted model responses, without credentials.

```text
Pi → pi-nebius → https://api.tokenfactory.nebius.com/v1 → model
```

Requires **Node.js 22.19+ and Pi 0.85.1** (the tested version). This targets the current `@earendil-works` Pi packages, not older `@mariozechner` releases. Pi's package instructions require wildcard peer dependencies; that is not a claim that every Pi version is compatible.

## Installation

With Pi already installed:

```bash
pi install git:github.com/PeterHdd/pi-nebius
export NEBIUS_API_KEY="your-api-key"
pi
```

Run `/model`, search for `nebius`, and select a model.

From this checkout:

```bash
cd /path/to/pi-nebius
npm ci
pi install /absolute/path/to/pi-nebius
```

Or try it without adding it to Pi's settings:

```bash
pi -e /absolute/path/to/pi-nebius
```

The provider uses Pi's `pi.extensions` manifest and loads TypeScript directly. Pi installs Git packages with `npm install --omit=dev`; the extension needs no build step. To use the benchmark CLI from a source checkout, run `npm ci` and `npm run build` to generate `dist/`. YAML is the benchmark definition parser; neither component needs a separate server.

Distribution is **GitHub-only**; npm publication is disabled. After the repository and a release tag exist, install with:

```bash
pi install git:github.com/PeterHdd/pi-nebius@v0.1.0
```

This command requires the `v0.1.0` tag to be published first. Git installs require no compiler or development dependencies. Benchmark development uses a separate source checkout with development dependencies installed. Pin a tag for reproducibility; install a newer tag explicitly to upgrade.

See [CONTRIBUTING.md](CONTRIBUTING.md), [CHANGELOG.md](CHANGELOG.md), and [SECURITY.md](SECURITY.md).

## Authentication and usage

```bash
export NEBIUS_API_KEY="your-key"
pi
```

Inside Pi, run `/model` and search for `nebius`. Choose an exact model from the discovered list. Provider ID: `nebius`; display name: `Nebius Token Factory`. Nebius IDs such as `vendor/model` remain unchanged; Pi identifies the pair as `nebius/vendor/model`.

You can also inspect the catalog and select a model explicitly:

```bash
pi --list-models nebius
pi --provider nebius --model 'EXACT_ID_FROM_THE_LIST'
```

`/nebius-refresh` forces discovery again and updates Pi's registered models. If a selected model was removed, use `/model` to choose a current one.

The extension reads `NEBIUS_API_KEY` at startup for discovery and resolves it through Pi's native authentication interface for inference. It has no `/login` flow and never writes the key to a file. Set the variable in the shell that launches Pi; changing a parent shell's environment cannot change an already-running process. Restart Pi after changing it. Pi's explicit CLI/runtime authentication overrides remain Pi features, but discovery specifically requires `NEBIUS_API_KEY`.

## Benchmark inside Pi

After installing the extension, run this inside Pi:

```text
/nebius-benchmark
```

An editor asks for your own task prompt. The benchmark uses your selected Nebius model and a copy of the project directory where Pi is running. To compare models, supply their exact IDs:

```text
/nebius-benchmark --models zai-org/GLM-5.3,moonshotai/Kimi-K2.6 --runs 3
```

This runs the same prompt three times per model, sequentially, starting from the same project snapshot each time. It shows progress and a comparison of input/output tokens, task duration, observed TTFT, output throughput, turns, and tools directly in Pi. Custom prompts report **correctness not checked**; completion does not prove the task was solved.

The snapshot includes current working files, including uncommitted changes, and respects Git ignores. It excludes `.git`, `.pi`, dependency/build folders, prior benchmark results, `.env` files, and `.pem`/`.key` files. Dependencies are not preinstalled; include setup instructions in your task if needed. Links and special files are rejected. Snapshots are limited to 10,000 files / 50 MiB. Run Pi from the project directory you want to benchmark.

Runs use paid inference. Tools have normal host permissions: file copies are not an OS sandbox. Reports and each run's resulting files are retained under `benchmark-results/` in your project.

```text
/nebius-benchmark cancel
/nebius-benchmark help
```

For an optional bundled coding task with automatic correctness tests:

```text
/nebius-benchmark --task fix-auth-bug --runs 3
```

Other bundled tasks: `add-api-endpoint`, `refactor-module`, and `multi-file-feature`. No build step or separate terminal is needed for these Pi commands.

## Dynamic model discovery

The async extension factory calls authenticated `GET /v1/models?verbose=true` before Pi finishes startup. This is the documented verbose variant of `/v1/models`, supplying metadata in addition to IDs. There is **no bundled model catalog**.

| Nebius field | Pi mapping |
| --- | --- |
| `id` | Exact, case-sensitive `model.id` |
| `name` | Display name; defaults to ID |
| `context_length` | `contextWindow`; defaults to 32,768 when absent/invalid |
| `architecture.modality` | Text/image inputs; known non-text-output models are excluded |
| `status` | Only `active` or unspecified models are included |
| `supported_sampling_parameters` contains `reasoning_effort` | Enables reasoning and Pi's standard reasoning-effort control |
| `supported_features` contains `reasoning` | Marks reasoning support without assuming an effort control |
| No documented maximum output length | `maxTokens`: 4,096, capped at a quarter of the context window |

Basic responses containing only IDs are supported. Missing capabilities default to text-only with no explicit reasoning control. Without modality metadata, the endpoint may include models unsuitable for chat; discovery cannot prove tool support. Pick a tool-capable model and run the integration test. Duplicate IDs are deduplicated; malformed lists are rejected rather than silently replacing a good cache with partial data.

### Cache and offline fallback

The cache is under `getAgentDir()/cache/pi-nebius/` (normally `~/.pi/agent/cache/pi-nebius/`). Pi's `PI_CODING_AGENT_DIR` override is respected. Files contain normalized metadata and a timestamp, never the API key. Names use a SHA-256 fingerprint of the endpoint and key to avoid sharing one account's catalog with another key.

- Fresh metadata is used for 24 hours without a discovery request.
- Stale/missing metadata triggers one request, with an 8-second timeout and a 4 MiB response limit.
- Transient failures use stale metadata and display a warning. No cache means no discovered models; Pi continues running.
- A 401/403 invalidates this key's cache. A fresh cache does not validate credentials; inference can still reject a revoked key.
- Successful refresh replaces the catalog, including an authoritative empty list. Failed refresh never updates the cache timestamp.
- Cache writes are atomic and best-effort, with private directory/file permissions. Concurrent Pi processes may each perform discovery; there is no background service or cross-process lock.

Pi now has a shared native model store, but its general provider-level cache is not scoped by the discovery key. This small extension-owned cache makes key isolation explicit and guarantees discovery before model selection. It does not participate in Pi's general remote-catalog refresh; use `/nebius-refresh` or restart Pi.

### Per-model settings

Run `/nebius-model` to choose a discovered model, or `/nebius-model MODEL_ID` to open it directly.
The menu saves temperature, reasoning effort, and maximum output tokens separately for each model.
Blank numeric values or **Inherit** restore defaults; **Reset all overrides** clears that model's settings.
Advanced settings let you override the context window and reasoning capability metadata. These do not
change the server's capabilities. Use verified limits; the default output limit remains 4,096 tokens
when the catalog does not provide a documented output limit.

Temperature and reasoning-effort overrides are sent only when discovery advertises support.
An advertised parameter does not guarantee every value is supported by every model; use its documented values.
Saved request values take precedence over Pi's generated values (including `/thinking` for reasoning effort).
Changes apply to new requests immediately and survive restarts in
`~/.pi/agent/pi-nebius/model-settings.json` (respecting `PI_CODING_AGENT_DIR`).
`/nebius-refresh` preserves saved overrides. External file edits require `/reload`.

Both benchmark entry points use saved settings. In-Pi benchmarks snapshot them when the run starts,
so changing the menu does not change an active comparison. Each run's `effectiveSettings` includes
saved overrides, model limits, and `requestParameters`: the outgoing temperature, reasoning effort,
output limit, and top-p where present, without prompt content. Omitted values mean the request did not
specify them; server defaults are unknown. These parameters are in `results.json`, not the summary table.

### Metadata overrides and user-defined fallback models

Merge the `nebius` provider entry from [examples/models.json](examples/models.json) into `~/.pi/agent/models.json`, replacing the placeholder ID and limits with verified values. Do not overwrite unrelated providers. The extension must remain installed.

Use `modelOverrides` to adjust discovered models and `models` to add explicit models that remain available when discovery is offline. Native providers are composed beneath these settings by Pi. No `apiKey` field is needed in this configuration. Explicitly configured models remain until you remove them, even if the server no longer lists them.


For reasoning models, verify the model's Nebius-specific behavior before overriding `reasoning`, `thinkingLevelMap`, or `compat`. Pi supports model-specific template controls, but this extension does not guess them from model names. Always-on reasoning may still appear in Pi even when explicit effort selection is unavailable.

## Architecture and compatibility

`src/index.ts` is Pi's async extension factory. It registers a native provider with `pi.registerProvider(provider)`, adds `/nebius-refresh`, and supplies provider-specific error guidance through `message_end`.

`src/provider.ts` uses Pi's `createProvider()` and its exported `openAICompletionsApi()` adapter. Pi owns request/message serialization, SSE parsing, multi-turn conversation state, function calls/results, usage accounting, abort handling, retries, and the tool loop. A small fetch decorator retains retry/rate-limit/request-ID headers on HTTP errors; successful response streams pass through unchanged.

Compatibility settings select `system` messages and `max_tokens`, request streamed usage, and disable unsupported assumptions about `store`, strict tools, grammar tools, and reasoning effort. These are model-level properties and can be overridden through Pi.


## Testing

```bash
npm ci
npm run typecheck
npm run lint
npm test
```

Tests cover model parsing/mapping, discovery errors, missing credentials, cache behavior, native authentication, and Pi's actual extension loader. Adapter tests use Pi itself with mocked HTTP responses. The CLI integration test starts a local HTTP server, loads this package in the real Pi CLI, checks `--list-models`, executes a streamed `write` call, checks the generated file, and verifies that the next request contains the tool result. It also checks cache reuse and `models.json` composition. These tests do not require or use a real Nebius key.

### Manual live integration test

In a scratch directory, start Pi, select a tool-capable Nebius model with `/model`, then ask:

> Create a file called nebius-test.txt containing 'Hello from Nebius'.

Verify that Pi shows a successful write-tool execution, the file contains the expected text, and the model responds after receiving the tool result. Check Token Factory's usage view for the request. Ordinary text claiming the file was created is not sufficient.

An opt-in automated equivalent runs a real Pi CLI in a temporary directory, limits its tools to `write`, requires an actual tool event and final response, checks exact file contents, and cleans up afterward:

```bash
export NEBIUS_API_KEY="your-key"
export NEBIUS_MODEL="EXACT_TOOL_CAPABLE_MODEL_ID"
npm run test:live
```

This makes paid inference requests and has a three-minute timeout. It is not part of `npm test`. See [docs/validation.md](docs/validation.md) for what has actually been run.

## Troubleshooting

| Problem | Action |
| --- | --- |
| Missing API key | Run `export NEBIUS_API_KEY="..."` in the launching shell and restart Pi. |
| 401/403 | Token Factory rejected the key or project access. Check the key, permissions, and project; then restart Pi. |
| Model unavailable / 404 | Run `/nebius-refresh`, then `/model`; remove obsolete explicit entries from `models.json`. |
| 429 | Respect the preserved `retry-after` / rate-limit details. Pi handles its normal retry policy; discovery itself does not retry automatically. |
| 5xx | Provider service failure. Retry later; discovery can use stale cached metadata. |
| Connectivity / timeout | Check access to `api.tokenfactory.nebius.com` and Pi's network/proxy settings. Discovery times out after eight seconds. |
| No models without a cache | Add an explicit verified model via the example configuration, or retry discovery once connectivity returns. |
| Model talks but never uses tools | Verify that the chosen model supports functions on Nebius; run the live test or select another model. Discovery alone cannot certify this. |
| Context/output limit errors | Set verified `contextWindow` and `maxTokens` in `modelOverrides`. Defaults are conservative assumptions, not guaranteed endpoint limits. |

## Current limitations

- Live Nebius inference has not been verified in the development environment because no API key was available. Mocked Pi integration tests prove adapter wiring and the tool loop, not every hosted model's capabilities.
- Metadata availability and capability vocabulary vary. Reasoning/vision detection is conservative; model-specific thinking templates require explicit configuration and testing.
- Maximum output limits are defaults; the verbose schema does not expose a documented equivalent of Pi's `maxTokens`.
- Pi's adapter handles `stop`, `length`, and `tool_calls` finish reasons. Its generic stream options do not expose custom stop sequences; advanced extensions can use Pi's `onPayload` hook if needed. No new stop-sequence API is invented here.
- The normal picker/listing integration is tested through Pi's CLI and registry. An interactive terminal screenshot/UI test was not performed.

## License

MIT; see [LICENSE](LICENSE).
