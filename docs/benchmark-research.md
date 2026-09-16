# Benchmark research notes

Inspected 2026-09-16. Pi published packages: **0.85.1**. Current repository head during inspection: `60e7e76bd7ea25cad1dd6f3f1ce0d18814a42759`. Nebius OpenAPI version: **20260910-cd76b4886**.

## Pi contracts inspected

- [SDK guide](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md) and [SDK implementation](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/sdk.ts): session creation, isolated resource loaders, normal built-in tools, configured runtime, and in-memory sessions.
- [Extension event types](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/extensions/types.ts): `before_agent_start`, `before_provider_request`, `after_provider_response`, `turn_start`, `message_end`, and tool execution events. Request hooks permit transformation, but this benchmark does not return any modifications.
- [AgentSession](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/agent-session.ts): `subscribe`, `prompt`, `abort`, retry events, compaction events, `agent_settled`, and effective thinking level.
- [System prompt builder](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/system-prompt.ts): includes cwd even when a custom system prompt is supplied. The SDK resolves relative cwd before constructing the session. This drove the sequential fixed-active-path design.
- [Model runtime](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/model-runtime.ts) and [provider contracts](https://github.com/earendil-works/pi/blob/main/packages/ai/src/models.ts): native provider registration and stream options with injected `fetch`.
- [Chat Completions adapter](https://github.com/earendil-works/pi/blob/main/packages/ai/src/api/openai-completions.ts): parses streamed usage, subtracts cache reads/writes from Pi's `usage.input`, tracks reasoning as an output subset, and can default missing usage/detail fields to zero. Raw provider usage is observed to preserve the distinction between absent and zero.
- [Telemetry package](https://github.com/earendil-works/pi/tree/main/packages/telemetry): span context/start/end/event contracts exist. Client spans do not establish server-only generation timing or guarantee a usage measurement for every HTTP retry. The benchmark uses public events and provider transport injection instead of installing a telemetry exporter or patching Pi core.
- [Bash tool](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/tools/bash.ts): cancellation kills process trees, but shell processes can be detached. The runner asks Pi to abort first, then applies a bounded process-tree cleanup fallback. POSIX-only behavior is documented.

`before_provider_request` counts logical adapter calls, not necessarily every HTTP attempt. `after_provider_response` occurs after successful response acquisition and lacks raw stream usage. Neither alone satisfies request-level accounting across retries. The observer therefore instruments the existing adapter's fetch call and passes request arguments and body bytes through unchanged. Session events provide separate turn/tool boundaries; requests during default Pi compaction are labeled and included.

## Nebius usage, models and pricing

- [Chat Completions API](https://docs.tokenfactory.nebius.com/api-reference/inference/create-chat-completion) and [OpenAPI schema](https://api.tokenfactory.nebius.com/openapi.json): `Usage` requires `prompt_tokens`, `completion_tokens`, and `total_tokens`; optional prompt details include `cached_tokens`, and optional completion details include `reasoning_tokens`. Streaming supports `stream_options.include_usage`, which the existing provider already enables.
- [List models](https://docs.tokenfactory.nebius.com/api-reference/models/list-models): `verbose=true` returns rich metadata, including context length, modality, pricing strings, and optional capabilities. `created` and response fingerprints do not establish an immutable model revision. No revision field is documented in `RichModel`.
- Pricing includes `prompt`, `completion`, `request`, and other modality-related strings, but the inspected schema does not define a sufficiently clear unit conversion to Pi's USD/million-token rates. Costs therefore use a separate explicit, dated snapshot and remain unknown when pricing or usage is incomplete.

No live key was available. Documentation defines the supported fields; tests exercise them using schema-shaped fixtures. No fixture is presented as a recording of an authenticated Nebius account response.

## Agentic Cost Benchmark cookbook

Read the official [cookbook article](https://dev.nebius.com/cookbook/agent-cost-benchmark) and its [implementation](https://github.com/nebius/token-factory-cookbook/blob/main/agents/agent-cost-comparison-1/agent_cost_comparison_1.py).

Its methodology runs the same data-analysis task through a filesystem agent with per-model input copies, validates generated JSON against expected values, accumulates message usage/tool counts, and computes costs from configured rates. It retains recoverable usage after errors/timeouts rather than treating failed runs as free. The Pi runner retains these methodological choices while using coding fixtures, external executable validators, and physical-request traces.

The cookbook uses Deep Agents and includes a model-specific harness-middleware workaround. This project copies neither the agent framework nor that behavioral change. It does not import cookbook model prices or benchmark results as current facts about Pi. Our repetitions, timing boundaries, unknown-usage handling, and pricing snapshots are explicit so comparisons can be audited.

## Measurement limits

Provider-reported tokens are exact as reported, not independently audited billing data. Unknown fields remain unknown. Client timings cannot isolate server compute or pure agent overhead. The last submitted prompt is measurable when usage is returned; final conversation token size is not. Model alias drift, serving hardware/load, account quotas, caches, and upstream updates remain external reproducibility limits.
