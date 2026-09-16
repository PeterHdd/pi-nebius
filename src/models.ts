import type { Model } from "@earendil-works/pi-ai";

export const BASE_URL = "https://api.tokenfactory.nebius.com/v1";
export type NebiusModel = Model<"openai-completions">;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Only retain fields we understand: no credentials or arbitrary server data reach the cache. */
export function parseModels(payload: unknown): NebiusModel[] {
  if (!isRecord(payload) || payload.object !== "list" || !Array.isArray(payload.data)) {
    throw new Error("Malformed Token Factory model list: expected { object: 'list', data: [...] }");
  }
  const models = new Map<string, NebiusModel>();
  for (const entry of payload.data) {
    if (
      !isRecord(entry) ||
      typeof entry.id !== "string" ||
      !entry.id.trim() ||
      entry.id.length > 512 ||
      [...entry.id].some(
        (char) => /\s/.test(char) || char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
      )
    ) {
      throw new Error("Malformed Token Factory model list: invalid model identifier");
    }
    if (entry.status != null && entry.status !== "active") continue;
    const modality = isRecord(entry.architecture) ? entry.architecture.modality : undefined;
    // Nebius also serves embeddings and image generation. Only expose text-output models.
    if (typeof modality === "string" && !/->text$/.test(modality)) continue;
    const parameters = Array.isArray(entry.supported_sampling_parameters)
      ? entry.supported_sampling_parameters
      : [];
    const features = Array.isArray(entry.supported_features) ? entry.supported_features : [];
    const effort = parameters.includes("reasoning_effort");
    const contextWindow = positiveInteger(entry.context_length) ?? 32768;
    models.set(entry.id, {
      id: entry.id,
      name: typeof entry.name === "string" && entry.name.trim() ? entry.name : entry.id,
      provider: "nebius",
      api: "openai-completions",
      baseUrl: BASE_URL,
      reasoning: effort || features.includes("reasoning"),
      input:
        typeof modality === "string" && modality.split("->")[0]?.includes("image")
          ? ["text", "image"]
          : ["text"],
      contextWindow,
      // No documented output-token limit or unambiguous price units in the schema.
      maxTokens: Math.min(4096, Math.max(1, Math.floor(contextWindow / 4))),
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      compat: {
        supportsStore: false,
        supportsDeveloperRole: false,
        supportsStrictMode: false,
        supportsOpenAIGrammarTools: false,
        supportsReasoningEffort: effort,
        supportsUsageInStreaming: true,
        maxTokensField: "max_tokens",
      },
    });
  }
  return [...models.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}
