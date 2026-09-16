# Research and implementation decisions

Inspected on 2026-09-16, before implementing the provider.

## Pi

The old `badlogic/pi-mono` GitHub repository redirects to `earendil-works/pi`. Current source and the published packages were both version **0.85.1**. Development dependencies are pinned to that release, with the resolved tree in `package-lock.json`.

Official sources inspected:

- [Custom providers](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/custom-provider.md): async extension factories; legacy and native `registerProvider`; compatibility flags; streaming/error semantics.
- [Packages](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md): local and npm installation, TypeScript loading, `pi.extensions`, host peer dependencies.
- [Extensions](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md) and [models.json](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/models.md).
- [Provider example](https://github.com/earendil-works/pi/tree/main/packages/coding-agent/examples/extensions/custom-provider-anthropic) and [SDK extension example](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/sdk/06-extensions.ts).
- [Extension loader](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/extensions/loader.ts): awaits factories and queues native providers before the runtime is bound.
- [Provider architecture](https://github.com/earendil-works/pi/blob/main/packages/ai/src/models.ts), [auth contracts](https://github.com/earendil-works/pi/blob/main/packages/ai/src/auth/types.ts), and [Together provider](https://github.com/earendil-works/pi/blob/main/packages/ai/src/providers/together.ts).
- [OpenAI-compatible adapter](https://github.com/earendil-works/pi/blob/main/packages/ai/src/api/openai-completions.ts): actual serialization, reasoning replay, streamed tool arguments, usage, aborts, stop reasons, and error normalization.

The guide's top-level `openAICompletionsApi` import does not match the published package exports. The verified import is `@earendil-works/pi-ai/api/openai-completions.lazy`. Production code uses this existing adapter, not a custom stream implementation.

Native registration was chosen over legacy `registerProvider("nebius", config)` because native auth can be environment-only with no persistent login, and Pi composes `models.json` overrides over the native model list. `getAgentDir()` supplies the official agent directory. `registerCommand`, `session_start`, and `message_end` provide refresh and actionable diagnostics. Startup diagnostics go to stderr, preserving JSON stdout for machine clients.

Pi also supports `createProvider({ fetchModels })` with its own catalog store. We use an awaited factory and a small key-scoped cache to avoid sharing an account-specific catalog through a provider-only store. No static catalog is necessary. The cache is independent of Pi's general remote-catalog update command.

Pi's `ApiKeyAuth.resolve` reads `ctx.env("NEBIUS_API_KEY")`; omitting `login` makes it ambient-only. Pi's `envApiKeyAuth` helper was inspected but intentionally not used: it also offers a login that stores credentials. The extension does not read/write Pi's credential file.

## Nebius Token Factory

Official sources inspected:

- [List models](https://docs.tokenfactory.nebius.com/api-reference/models/list-models) and the linked [live OpenAPI schema](https://api.tokenfactory.nebius.com/openapi.json), schema version `20260910-cd76b4886`.
- [Chat Completions](https://docs.tokenfactory.nebius.com/api-reference/inference/create-chat-completion).
- [OpenCode integration](https://dev.nebius.com/cookbook/opencode-nebius-token-factory).
- [OpenClaw integration](https://dev.nebius.com/cookbook/openclaw-token-factory).

The schema describes `GET /v1/models`, bearer authorization, and `verbose=true`. Its `ListModelResponse.data` is a union of basic `Model` and `RichModel`. Basic entries include `id`, `created`, `object`, `owned_by`, and optional status. Rich entries add `name`, `context_length`, `architecture.modality`, pricing, and optional feature/sampling-parameter lists. The feature lists are arbitrary strings rather than enumerated capabilities. `per_request_limits` is an undocumented number map; we do not infer a maximum output-token property from it.

A request to the live model endpoint without a key returned an authentication error. No authenticated catalog was available to inspect. Fixtures follow the official schema; they are not represented as recordings of a real account response. The mapper accepts the common `text->text` / `text+image->text` modality notation and requires explicit positive evidence to enable effort controls. Schema-compatible but differently named capabilities can require user overrides.

Chat Completions documents messages, tools/tool choice, streaming with `[DONE]`, `stream_options.include_usage`, temperature, both maximum-token parameter names, stop sequences, and reasoning effort. The adapter uses `max_tokens` and system-role compatibility. Actual support still varies by model.

OpenClaw's official recipe configures the same `/v1` URL as a custom OpenAI-compatible provider with an exact vendor/model ID. OpenCode's recipe uses its built-in Nebius provider and normal model picker. Neither suggests a separate agent runtime is needed. Those integrations' credential persistence is not copied here.

## Deliberate limits

Pricing strings lack documented units in the inspected schema. We leave cost estimates at zero instead of asserting a billing conversion. User-supplied Pi costs must be USD/million tokens. Likewise, output limits and reasoning-template behavior are not guessed from model IDs. These choices favor correct tool transport and explicit configuration over an unreliable metadata catalog.
