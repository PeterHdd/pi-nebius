import { createProvider, type ProviderStreams } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/compat";
import { withErrorDetails } from "./errors.ts";
import { applyRequestSettings, type ModelSettingsMap } from "./model-settings.ts";
import { BASE_URL, type NebiusModel } from "./models.ts";

export function nebiusProvider(
  models: NebiusModel[],
  settings: ModelSettingsMap = {},
  onRequest?: (payload: unknown) => void,
) {
  const adapter = openAICompletionsApi();
  const api: ProviderStreams = {
    stream: (model, context, options) =>
      adapter.stream(model, context, {
        ...options,
        onPayload: async (payload, selected) => {
          const previous = await options?.onPayload?.(payload, selected);
          const adjusted = applyRequestSettings(
            previous ?? payload,
            model as NebiusModel,
            settings[model.id],
          );
          onRequest?.(adjusted);
          return adjusted;
        },
        fetch: withErrorDetails(options?.fetch ?? globalThis.fetch),
      }),
    streamSimple: (model, context, options) =>
      adapter.streamSimple(model, context, {
        ...options,
        onPayload: async (payload, selected) => {
          const previous = await options?.onPayload?.(payload, selected);
          const adjusted = applyRequestSettings(
            previous ?? payload,
            model as NebiusModel,
            settings[model.id],
          );
          onRequest?.(adjusted);
          return adjusted;
        },
        fetch: withErrorDetails(options?.fetch ?? globalThis.fetch),
      }),
  };
  return createProvider({
    id: "nebius",
    name: "Nebius Token Factory",
    baseUrl: BASE_URL,
    models,
    api,
    auth: {
      apiKey: {
        name: "NEBIUS_API_KEY",
        // Ambient-only auth: no login flow and no credential persistence.
        async resolve({ ctx, signal }) {
          signal.throwIfAborted();
          const key = (await ctx.env("NEBIUS_API_KEY"))?.trim();
          return key ? { auth: { apiKey: key }, source: "NEBIUS_API_KEY" } : undefined;
        },
      },
    },
  });
}
