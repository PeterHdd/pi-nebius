# Agentic coding benchmarks with Pi + Nebius

This tool measures how a model completes a coding task **through Pi's full agent/tool loop**. It observes Pi; it does not implement an agent, alter model payloads, compress context, rewrite tool results, optimize prompts, or route between models.

A traditional inference benchmark measures `prompt → model → response`. Here the unit is:

```text
task → Pi → model → tool → model → tool → … → deterministic validation
```

Tokens/second alone cannot describe task efficiency. A slower model that solves a task in five turns can finish sooner than a faster model that needs twenty turns. Results therefore expose success, time, cumulative usage, and tools separately. There is no composite score or LLM judge.

## Run inside Pi

Use `/nebius-benchmark --models ID_A,ID_B --runs 3` to enter your own prompt in an editor. Without `--models`, it uses the currently selected Nebius model. Each run starts from a snapshot of the current project. Results appear in Pi; `/nebius-benchmark cancel` stops the run. See [the README](../README.md#benchmark-inside-pi) for snapshot exclusions and limits.

Custom prompts have `definition.validationMode: "none"`, `validation.checked: false`, and no correctness verdict. `success` remains false because no validator established success; aggregate `successRate` is null. A null `failure` means execution finished without an error, not that the task was solved. The report labels this FINISHED and explicitly says correctness was not checked. Existing validated task reports keep their success semantics.

Use `--task fix-auth-bug` (or another bundled task name) to run a task with deterministic validators instead. Both paths run on the installed host Pi SDK without a compiler or development dependencies.

## Standalone CLI: install and run

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
  --output benchmark-results/auth-experiment
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
| `--concurrency` | **1 only in v1**, for identical unmodified Pi system prompts |

Runs are scheduled round-robin: A1, B1, A2, B2. Ctrl-C stops the active session, retains its partial measurements, writes a cancelled result set, and does not start pending runs. Exit codes: 0 when all runs pass, 1 when any run fails, 2 for configuration/preflight errors, 130 for cancellation. Input/configuration errors before a run begins do not create a complete result set.

### Why v1 is sequential

Pi embeds an absolute working directory in its system prompt. Different simultaneous workspace paths therefore produce different prompts even with identical SDK settings. Rather than modify that prompt, this runner creates each fresh copy at **the same active path**, archives the finished workspace, removes the active copy, and only then starts the next run. The complete prompt hash is recorded and tested for equality within an experiment.

Parallel runs would need an additional isolation layer exposing the same absolute path in each process namespace. That is not implemented in v1. Even with that layer, concurrency can distort latency through provider load, rate limits, shared serving infrastructure, and local CPU contention. Sequential execution is the baseline for latency comparisons. Absolute paths—and therefore prompt hashes—can differ between separate experiments; compare the recorded metadata.

## Architecture

```text
CLI / runner
  ├─ parse benchmark definitions
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

No user-installed extensions, skills, themes, prompt templates, context files, saved sessions, or `models.json` settings enter a run. This defines the clean benchmark configuration, identically for all models. Pi's own default retries and automatic compaction remain **unchanged**, are recorded, and their requests count toward token usage. There is no benchmark-added compression/pruning. Pi can clamp its default thinking level to a model's capabilities; the effective setting and model definition are recorded rather than forced into unsupported behavior.

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

`schemaVersion: 2` applies to result documents and journal entries. Each run includes:

```json
{
  "schemaVersion": 2,
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
  "observation": {
    "requests": [
      {"request": 1, "usage": {"inputTokens": 100, "outputTokens": 40}},
      {"request": 2, "usage": {"inputTokens": 220, "outputTokens": 20}}
    ]
  }
}
```

This is an abridged illustrative schema, not a live model result. The complete TypeScript contract is [types.ts](../src/benchmark/types.ts).

Metadata includes timestamp, Pi/package/Node versions, OS/architecture, benchmark definition/hash, fixture hash (including paths/content/executable bits), validator hash, frozen model definitions, effective Pi settings, system-prompt hashes. `.git` history is not required: the fixture content hash identifies the actual inputs. Response `model`, request ID, and `system_fingerprint` are captured when present. A fingerprint is **not** asserted to be a model revision; `modelRevision` remains null because Nebius's inspected catalog has no documented exact revision identifier.

The terminal report places metrics down rows and models across columns. It shows success counts, median task duration, mean input/output tokens, turns and tools, observed TTFT, end-to-end output throughput, and failure diagnostics. Observed TTFT is the first agent request’s first content timestamp minus that request’s start timestamp, aggregated as the median across runs with known timing. It includes network latency but excludes worker startup; the first nonempty text, reasoning, or tool-function delta counts, while role-only and empty tool headers do not. Streaming chunks may contain multiple tokens, so this is a client-observed approximation of TTFT, not a server token-generation timestamp. Throughput is the sum of output tokens divided by the sum of complete task durations, including network, tools, and validation. It includes failed runs and is unknown if any run lacks output usage or a positive duration. This is not pure model decoding speed. Existing JSON request traces contain the timestamps needed to calculate observed TTFT. JSON also contains means, medians, min/max, population standard deviations, and known/missing counts. Failed runs remain in aggregates; unknown values are excluded from arithmetic, never converted to zero. Every individual result remains available. `results.json` is atomically updated after each completed run and on handled cancellation. An abrupt kill of the runner itself may leave status `running`; journals preserve observations already received, but resumable execution is not implemented.

Traces omit prompts, model text, tool arguments, and successful tool output. Error details and validator logs are retained with the known API key redacted. This cannot identify arbitrary secrets embedded in your own fixtures/logs; use credential-free fixtures. Workspace archives intentionally contain the task's output files.

## Verification and live acceptance

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run benchmark:demo
```

The demo runs real Pi SDK sessions and file tools, with **scripted mock responses**. It exercises two mock models × two repetitions and leaves inspectable results in `benchmark-results/mock-demo-*`. It is not evidence about any Nebius-hosted model's performance.

The regression suite covers parsing, isolation, event instrumentation, fragmented SSE observation, cumulative usage, aggregation, validation, JSON round trips, API errors, graceful cancellation, hard timeout, CLI input handling, all four fixture validators, and real Pi tool loops. Provider-extension tests also remain in the suite.

No live benchmark has been run in this environment: `NEBIUS_API_KEY` was unavailable. To complete that check, choose two tool-capable IDs from your discovered catalog and run the first command above with `--runs 1`. Tests certify the measurement wiring, not the capabilities, stability, or billing behavior of every hosted model.

See [benchmark-research.md](benchmark-research.md) for inspected source APIs and Nebius methodology.

Result schema version 2 removes monetary fields from version 1 (per-run estimates, pricing snapshots, aggregate costs, and the pricing hash). Existing saved results are not rewritten. Task definitions still use schema version 1.


## Request-level observability

After the comparison summary, each run shows its individual HTTP requests: provider-reported
input/output tokens, cached input tokens when available, change in input from the preceding request,
and tool calls produced by the response. A request can produce zero, one, or multiple tool calls.
Retries and compaction requests remain separate rows; a request is not necessarily an agent turn.
Missing usage stays `n/a`, including totals when any required usage is missing.

The context-composition table measures **UTF-8 serialized JSON bytes**, not tokens. Categories are
system/developer messages, tool schemas, user messages, assistant messages (including tool arguments),
tool-result messages, and other messages. Message wrapper fields are included; array separators and
other HTTP payload fields are not. File reads and shell output are subtypes of tool results, not
additional categories. Category token counts are unavailable; no tokenizer estimates are substituted.
Input-token differences are net changes, not causal attribution to the most recent tool.

Tool rows use local labels such as `T1 read` and `T2 bash`. They show model-facing text bytes/lines,
the originating request, and the subsequent request numbers containing that tool-call ID. Repeated
HTTP attempts count as repeated inclusions. These are observations after Pi's tool processing;
original shell stdout/stderr may already have been truncated. Text sizes exclude images. If a request
body cannot be inspected without consuming it, context measurements are unavailable and inclusion
lists are labelled partial.

Outputs of at least 16 KiB receive a large-output observation. Matching tool names and canonicalized
arguments flag repeated operations; matching result content also flags repeated results. This does
not establish that files or external state were unchanged, or that a call was avoidable. No tool calls
are blocked and no output or context is reduced. Only sizes, IDs, names, and per-run keyed fingerprints
are added to traces; successful output, commands, paths in arguments, and prompts are not retained.
Fingerprint keys are ephemeral and are not saved; fingerprints are not comparable across runs.

Input amplification is cumulative input over **all observed HTTP attempts** divided by the final
agent request's input tokens. It is unavailable with incomplete usage or a zero/missing denominator.
Compaction can decrease the denominator, so the ratio is not a waste score. Final-request input also
is not the context size after the response. Successful validated runs show input + output tokens as
**tokens to validated solution**; failures and unvalidated runs are labelled separately. Cached and
reasoning token counters are details of usage, not additional tokens to add to that sum.

These are additive optional fields in result schema 2 (`RequestTrace.context`,
`RequestTrace.generatedToolCalls`, and tool fingerprints/output sizes). Old reports remain readable;
absent observations are unavailable. Individual data remains in `results.json` and the live journals.
