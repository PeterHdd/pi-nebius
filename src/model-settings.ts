import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isRecord, type NebiusModel } from "./models.ts";

export const efforts = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export interface ModelSettings {
  temperature?: number;
  reasoningEffort?: (typeof efforts)[number];
  maxTokens?: number;
  contextWindow?: number;
  reasoning?: boolean;
}
export type ModelSettingsMap = Record<string, ModelSettings>;
export const settingsPath = (agentDir: string) =>
  join(agentDir, "pi-nebius", "model-settings.json");

export function validateSettings(value: unknown): ModelSettings {
  if (!isRecord(value)) throw new Error("Model settings must be an object.");
  const allowed = ["temperature", "reasoningEffort", "maxTokens", "contextWindow", "reasoning"];
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(`Unknown model setting: ${key}`);
    const v = value[key];
    if (key === "temperature" && (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 2))
      throw new Error("Temperature must be between 0 and 2.");
    if (
      (key === "maxTokens" || key === "contextWindow") &&
      (typeof v !== "number" || !Number.isSafeInteger(v) || v <= 0)
    )
      throw new Error(`${key} must be a positive integer.`);
    if (key === "reasoningEffort" && !efforts.includes(v as (typeof efforts)[number]))
      throw new Error("Invalid reasoning effort.");
    if (key === "reasoning" && typeof v !== "boolean")
      throw new Error("Reasoning must be a boolean.");
  }
  if (
    typeof value.maxTokens === "number" &&
    typeof value.contextWindow === "number" &&
    value.maxTokens > value.contextWindow
  )
    throw new Error("Maximum output tokens cannot exceed the context window.");
  return { ...value } as ModelSettings;
}

export async function loadSettings(path: string): Promise<ModelSettingsMap> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
  const value: unknown = JSON.parse(text);
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.models))
    throw new Error("Invalid Nebius model settings file.");
  return Object.fromEntries(
    Object.entries(value.models).map(([id, settings]) => [id, validateSettings(settings)]),
  );
}

export async function saveModelSettings(
  path: string,
  id: string,
  settings: ModelSettings,
): Promise<ModelSettingsMap> {
  // Re-read before each edit so unrelated changes from another Pi session are retained.
  const models = await loadSettings(path);
  const next = validateSettings(settings);
  const entries = Object.entries(models).filter(([key]) => key !== id);
  if (Object.keys(next).length) entries.push([id, next]);
  const updated = Object.fromEntries(entries);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify({ version: 1, models: updated }, null, 2)}\n`, {
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
  return updated;
}

export function applyModelSettings(model: NebiusModel, settings: ModelSettings = {}): NebiusModel {
  const contextWindow = settings.contextWindow ?? model.contextWindow;
  return {
    ...model,
    contextWindow,
    maxTokens: Math.min(settings.maxTokens ?? model.maxTokens, contextWindow),
    reasoning: settings.reasoning ?? model.reasoning,
  };
}

/** Apply only supported request overrides; never store prompts or messages. */
export function applyRequestSettings(
  payload: unknown,
  model: NebiusModel,
  settings: ModelSettings = {},
): unknown {
  if (!isRecord(payload)) return payload;
  const result = { ...payload };
  if (
    settings.temperature !== undefined &&
    model.nebiusSupportedParameters?.includes("temperature")
  )
    result.temperature = settings.temperature;
  if (
    settings.reasoningEffort !== undefined &&
    model.reasoning &&
    model.compat?.supportsReasoningEffort
  )
    result.reasoning_effort = settings.reasoningEffort;
  if (settings.maxTokens !== undefined) {
    delete result.max_completion_tokens;
    result.max_tokens = Math.min(settings.maxTokens, model.contextWindow);
  }
  return result;
}

export function requestSettings(payload: unknown): Record<string, unknown> {
  if (!isRecord(payload)) return {};
  return Object.fromEntries(
    ["temperature", "reasoning_effort", "max_tokens", "max_completion_tokens", "top_p"]
      .filter((key) => payload[key] !== undefined)
      .map((key) => [key, payload[key]]),
  );
}
