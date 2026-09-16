# Agentic coding benchmarks with Pi + Nebius

This tool measures how a model completes a coding task **through Pi's full agent/tool loop**. It observes Pi; it does not implement an agent, alter model payloads, compress context, rewrite tool results, optimize prompts, or route between models.

A traditional inference benchmark measures `prompt → model → response`. Here the unit is:

```text
task → Pi → model → tool → model → tool → … → deterministic validation
```

Tokens/second alone cannot describe task efficiency. A slower model that solves a task in five turns can finish sooner and cost less than a faster model that needs twenty turns. Results therefore expose success, time, cumulative usage, tools, and cost separately. There is no composite score or LLM judge.

## Install and run

Requirements: **macOS or Linux**, **Node 22.19+**, and the tested **Pi 0.85.1** packages. The source checkout pins development versions; retain `package-lock.json` for reproducibility.

```bash
cd /path/to/pi-nebius
npm ci
npm run build
export NEBIUS_API_KEY="your-key"

npm run benchmark -- \
  --benchmark benchmarks/fix-auth-bug \
  --models 'EXACT_NEBIUS_MODEL_A,EXACT_NEBIUS_MODEL_B' \
  --runs 3 \
  --timeout 120 \
  --output benchmark-results/auth-experiment \
  --pricing my-pricing.yaml
```

Alternatively, after `npm install --global .` from this checkout, use `pi-nebius benchmark ...`. The package is not published to npm. The compiled command can also be invoked with `node dist/benchmark/cli.js benchmark ...`.

Model IDs are exact Nebius IDs such as `vendor/model`, without an extra `nebius/` prefix. The CLI performs one fresh authenticated discovery before the experiment and freezes the selected model definitions. It does not auto-select a model. Discovery and model availability are outside the measured runs. Models absent from discovery fail preflight explicitly.

| Option | Meaning |
| --- | --- |
| `--benchmark` | Directory containing `benchmark.yaml`, or a YAML/JSON file |
| `--models` | Comma-separated exact IDs, each used for every repetition |
| `--runs` | Repetitions per model; default 1 |
| `--timeout` | Agent-process deadline in seconds; overrides the definition |
| `--output` | New directory; existing directories are rejected |
| `--pricing` | Optional dated pricing snapshot; omitted means unknown cost |
| `--concurrency` | **1 only in v1**, for identical unmodified Pi system prompts |

Runs are scheduled round-robin: A1, B1, A2, B2. Ctrl-C stops the active session, retains its partial measurements, writes a cancelled result set, and does not start pending runs. Exit codes: 0 when all runs pass, 1 when any run fails, 2 for configuration/preflight errors, 130 for cancellation. Input/configuration errors before a run begins do not create a complete result set.

### Why v1 is sequential

Pi embeds an absolute working directory in its system prompt. Different simultaneous workspace paths therefore produce different prompts even with identical SDK settings. Rather than modify that prompt, this runner creates each fresh copy at **the same active path**, archives the finished workspace, removes the active copy, and only then starts the next run. The complete prompt hash is recorded and tested for equality within an experiment.

Parallel runs would need an additional isolation layer exposing the same absolute path in each process namespace. That is not implemented in v1. Even with that layer, concurrency can distort latency through provider load, rate limits, shared serving infrastructure, and local CPU contention. Sequential execution is the baseline for latency comparisons. Absolute paths—and therefore prompt hashes—can differ between separate experiments; compare the recorded metadata.

## Architecture

```text
CLI / runner
  ├─ parse benchmark and pricing snapshots
  ├─ freeze fixture + trusted validators
  └─ for each model/repetition:
       fresh active workspace + private Pi config
         → separate Node worker
         → createAgentSession() + existing Nebius provider
         → normal Pi agent/tools
         → stop worker and tool descendants
         → deterministic validators
         → archived files + trace + run.json
  → results.json + aggregate terminal report
```

Pi's public `createAgentSession`, `DefaultResourceLoader`, `SettingsManager.inMemory`, `ModelRuntime`, and `SessionManager.inMemory` establish each session. A native provider is registered through an inline extension, using the existing `nebiusProvider` adapter. `session.prompt`, `session.subscribe`, and `session.abort` drive and observe it. `before_agent_start` records the system-prompt hash and returns nothing. Instrumentation never returns a modified event/payload.

The provider's supported `fetch` injection observes every Chat Completions HTTP attempt, including adapter retries and Pi's own compaction requests. It forwards request arguments and response bytes unchanged. The observer reads only usage and small response metadata fields from the streaming protocol; Pi still parses content, constructs tools, executes them, and manages the conversation.

No user-installed extensions, skills, themes, prompt templates, context files, saved sessions, or `models.json` settings enter a run. This defines the clean benchmark configuration, identically for all models. Pi's own default retries and automatic compaction remain **unchanged**, are recorded, and their requests count toward cost. There is no benchmark-added compression/pruning. Pi can clamp its default thinking level to a model's capabilities; the effective setting and model definition are recorded rather than forced into unsupported behavior.

## Definitions and fixtures

```text
benchmarks/my-task/
  benchmark.yaml
  fixture/             # the agent's starting files
  validation/          # trusted checks, outside its workspace
```

```yaml
schemaVersion: 1
name: my-task
task: |
  Find and fix the bug. Preserve the public API.
fixture: fixture
validationDirectory: validation
tools: [read, bash, edit, write]
timeout: 600
validationTimeout: 60
validation:
  - command: node
    args: [--test, "{validation}/check.test.mjs"]
```

The parser rejects unknown fields, duplicate YAML keys, aliases, invalid deadlines, and paths escaping the definition directory. `systemPrompt` is optional; when omitted the normal Pi prompt is used. Supplying it is an explicit benchmark configuration applied equally to all runs—not a per-model optimization.

Validation accepts command/args objects (recommended), or strings such as `npm test` executed through `/bin/sh -c`. `{validation}` expands to the restored trusted-validator directory. Avoid shell-string interpolation for paths with spaces; use argument arrays. Validation runs with the agent workspace as cwd. All commands must exit zero. Output, exit code, signal, elapsed time, timeout, and truncation state are recorded; output is capped at 256 KiB per command.

Optional `setup` commands run on each fresh copy before Pi starts, with `validationTimeout` as their individual deadline. For dependency installs, supply lockfiles and use reproducible commands such as `npm ci`. The included fixtures have **no external dependencies or setup**. Setup duration is included in run wall time, not agent wall time. The agent deadline excludes validation; each validator has its own deadline.

The fixture snapshot excludes `.git` metadata, rejects symlinks/special files and `.env` credential files, preserves executable file bits and empty directories, and is SHA-256 hashed. Files are copied, never hard-linked. `node_modules` is not silently excluded: prefer setup commands to committing dependency trees. Generated files with links/special entries may prevent archival/hashing; any failure is recorded explicitly.

Trusted validators are copied from the original snapshot after the agent exits, and their hash is checked before and after validation. Agents may run the fixture's visible tests while working; modifying those tests does not replace the trusted checks. Generic `npm test` commands still depend on the workspace's scripts/tests, so use external validators when test tampering would matter.

**Filesystem isolation is not an OS security sandbox.** Pi's ordinary tools retain host access. Copies prevent ordinary run-to-run contamination; they do not constrain a deliberately escaping shell command. Use a disposable machine/container for untrusted tasks. v1 does not implement a container orchestrator. The API key goes to the worker over IPC, remains in memory, and is absent from tool/validation environments, arguments, and configuration files.

### Included suite

| Benchmark | Task and trusted checks |
| --- | --- |
| `fix-auth-bug` | Correct seconds/milliseconds expiry handling, boundary behavior, revocation, and invalid timestamps |
| `add-api-endpoint` | Add `/api/sum` with numeric validation, method handling, JSON responses, and preserved health route |
| `refactor-module` | Extract a shared subtotal helper while preserving calculations and avoiding duplicated reductions |
| `multi-file-feature` | Persist task completion across store, serializer, and PATCH/GET routes |

Tests verify all four original fixtures fail trusted validation and reference solutions pass. Refactor checks include a narrow structural assertion in addition to behavior. These are small deterministic acceptance tests, not a claim to detect arbitrary adversarial solutions or prove general correctness.

## Usage and cumulative tokens

Nebius usage is authoritative. The runner records each response's `prompt_tokens`, `completion_tokens`, optional `prompt_tokens_details.cached_tokens`, and optional `completion_tokens_details.reasoning_tokens`. It does not run a local tokenizer. Repeated cumulative snapshots within one stream replace the request's snapshot; they are not added together.

```text
Request       Input     Output
1             4,200        800
2             9,100      1,200
3            17,300      1,100
4            29,400      2,000
TOTAL        60,000      5,100
```

The final submitted prompt had 29,400 tokens, but the agent consumed **60,000 input tokens** across requests. `prompt_tokens` includes cached input; adding cached tokens again would double-count it. Likewise, reasoning tokens are a subset of completion tokens and must not be added again.

`tokens.cumulativeInputTokens` and `tokens.cumulativeOutputTokens` sum every physical request with complete reported usage, including internal summarization/compaction. If any request lacks the required usage fields, the corresponding total is `null`. `observedInputTokens`, `observedOutputTokens`, `requestsWithUsage`, and `usageComplete` preserve the known partial measurement. Failed requests, disconnected streams, and timeouts are not assumed free. Unreported cached/reasoning fields remain `null`, not zero.

### Amplification and context size

`lastRequestInputTokens` is the provider-reported input size of the last **agent** request, excluding compaction requests. It is not the final conversation size after the model's last output. Exact final context size is unavailable without another provider measurement or local estimation, so `finalContextSizeTokens` and the requested final-context-based `inputAmplification` are explicitly `null`.

The separately named descriptive ratio is:

```text
inputAmplificationVsLastRequest = cumulativeInputTokens / lastRequestInputTokens
```

It describes total input sent relative to the last submitted agent prompt, only when the numerator and denominator are known and the denominator is positive. For the example: `60,000 / 29,400 ≈ 2.04×`. Compaction, caching, model tokenizers, and retries affect this ratio; it is not a measure of wasted tokens or a score.

## Metric boundaries

| Metric | Measurement |
| --- | --- |
| `success` | All configured validation passes, with no timeout/cancellation or unrecovered agent/API error |
| `modelRequests` | Observed physical Chat Completions attempts, including retries |
| `agentTurns` | Pi `turn_start` events; can differ from request count |
| `toolCalls` | Tool calls declared in completed assistant messages |
| `toolErrors` | Tool results marked `isError`; a recovered tool error does not by itself fail a run |
| Individual tools | Name/ID, execution start/end, error flag and redacted failure details; no arguments or successful outputs |
| `wallTimeMs` | From fresh-run setup through Pi, validation and archival; excludes initial discovery/snapshot and final report persistence |
| `agentWallTimeMs` | Worker spawn through shutdown, including Pi initialization and cancellation cleanup |
| `modelRequestWallTimeMs` | Union of completed client-observed request intervals; null when an observed request has no endpoint |
| `toolExecutionTimeMs` | Union of completed tool-execution intervals; null when an execution is still open |
| `timeToFirstContentMs` | First observed text/reasoning/tool delta relative to agent start; a client-visible latency, not exact first-token timing |
| Per-request timing | Monotonic worker-relative start, first content, and completion; differences provide request latencies |
| `modelGenerationTimeMs` | Null: server generation cannot be separated from queuing, networking, and stream consumption |
| `agentOverheadTimeMs` | Null: subtracting potentially overlapping timings would not isolate pure agent overhead |

Instrumentation itself has overhead, including IPC and trace writes. The HTTP observer is backpressure-aware and byte-preserving, but its timing is not server telemetry. Interrupted tool executions may lack complete duration/error information. Counts always describe observed events, not unseen activity before an unresponsive worker was killed.

Failure categories include `validation_failed`, `timeout`, `model_api_error`, `rate_limit`, `tool_error`, `agent_error`, `context_limit`, `cancelled`, and `unknown`. Timeout/cancellation take priority. `tool_error` means failed validation accompanied by tool errors; it does not prove the errors caused the failure. Original redacted details and individual HTTP statuses remain available. Recovered attempt failures remain in the trace even when the task ultimately succeeds.

## Cost and pricing snapshots

The inspected Nebius model schema contains pricing strings, but does not clearly specify their units. Neither catalog defaults nor Pi's zero cost fields are used as prices. Supply verified rates separately:

```yaml
schemaVersion: 1
currency: USD
asOf: 2026-09-16
source: "URL or description of your verified price source"
models:
  vendor/exact-model-id:
    inputPerMillion: 1.00
    outputPerMillion: 2.00
    cachedInputPerMillion: 0.25
```

These numbers illustrate the format, not actual Nebius pricing. See [pricing.example.yaml](../examples/pricing.example.yaml). Optional `requestUsd` adds an explicit fixed charge per usage-reported request if your pricing requires it.

For each request:

```text
((prompt_tokens - cached_tokens) × inputPerMillion
 + cached_tokens × cachedInputPerMillion
 + completion_tokens × outputPerMillion) / 1,000,000
 + optional requestUsd
```

Omitting `cachedInputPerMillion` explicitly uses the normal input rate. When a distinct cached rate is specified but cached usage is missing, cost is unknown. Missing model pricing or any request's required usage makes `estimatedCostUsd` null; `observedEstimatedCostUsd` preserves a subtotal where calculable. Reasoning tokens are already in completion usage. Estimates exclude taxes, credits, tier discounts, billing reconciliation, and undocumented charge categories. The full snapshot, its date/source, and a SHA-256 hash are retained with results.

## Results and reproducibility

```text
OUTPUT/
  results.json                    # versioned experiment + all runs + aggregates
  snapshot/fixture/               # frozen inputs
  snapshot/validation/            # frozen trusted checks
  runs/001-MODEL_HASH/
    run.json                      # individual result, including request/tool arrays
    trace.jsonl                   # incremental observation snapshots; survives worker failure
    workspace/                    # archived agent files
    validation/                   # exact checks executed
    pi/                           # isolated Pi config, without credentials or saved conversation
```

`schemaVersion: 1` applies to result documents and journal entries. Each run includes:

```json
{
  "schemaVersion": 1,
  "benchmark": "fix-auth-bug",
  "model": "vendor/model",
  "modelRevision": null,
  "run": 1,
  "success": true,
  "failure": null,
  "modelRequests": 2,
  "agentTurns": 2,
  "toolCalls": 1,
  "toolErrors": 0,
  "tokens": {
    "cumulativeInputTokens": 320,
    "cumulativeOutputTokens": 60,
    "lastRequestInputTokens": 220,
    "finalContextSizeTokens": null
  },
  "estimatedCostUsd": null,
  "observation": {
    "requests": [
      {"request": 1, "usage": {"inputTokens": 100, "outputTokens": 40}},
      {"request": 2, "usage": {"inputTokens": 220, "outputTokens": 20}}
    ]
  }
}
```

This is an abridged illustrative schema, not a live model result. The complete TypeScript contract is [types.ts](../src/benchmark/types.ts).

Metadata includes timestamp, Pi/package/Node versions, OS/architecture, benchmark definition/hash, fixture hash (including paths/content/executable bits), validator hash, frozen model definitions, effective Pi settings, system-prompt hashes, and pricing snapshot/hash. `.git` history is not required: the fixture content hash identifies the actual inputs. Response `model`, request ID, and `system_fingerprint` are captured when present. A fingerprint is **not** asserted to be a model revision; `modelRevision` remains null because Nebius's inspected catalog has no documented exact revision identifier.

The terminal report shows success counts, median cost/time, and mean cumulative input/output, turns, and tools. JSON also contains means, medians, min/max, population standard deviations, and known/missing counts. Failed runs remain in aggregates; unknown values are excluded from arithmetic, never converted to zero. Every individual result remains available. `results.json` is atomically updated after each completed run and on handled cancellation. An abrupt kill of the runner itself may leave status `running`; journals preserve observations already received, but resumable execution is not implemented.

Traces omit prompts, model text, tool arguments, and successful tool output. Error details and validator logs are retained with the known API key redacted. This cannot identify arbitrary secrets embedded in your own fixtures/logs; use credential-free fixtures. Workspace archives intentionally contain the task's output files.

## Verification and live acceptance

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run benchmark:demo
```

The demo runs real Pi SDK sessions and file tools, with **scripted mock responses and invented prices**. It exercises two mock models × two repetitions and leaves inspectable results in `benchmark-results/mock-demo-*`. It is not evidence about any Nebius-hosted model's performance.

The regression suite covers parsing, pricing, isolation, event instrumentation, fragmented SSE observation, cumulative usage, cost, aggregation, validation, JSON round trips, API errors, graceful cancellation, hard timeout, CLI input handling, all four fixture validators, and real Pi tool loops. Provider-extension tests also remain in the suite.

No live benchmark has been run in this environment: `NEBIUS_API_KEY` was unavailable. To complete that check, choose two tool-capable IDs from your discovered catalog and run the first command above with `--runs 1`. Costs require a verified pricing snapshot. Tests certify the measurement wiring, not the capabilities, stability, or billing behavior of every hosted model.

See [benchmark-research.md](benchmark-research.md) for inspected source APIs and Nebius methodology.
