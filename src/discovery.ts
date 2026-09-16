import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { BASE_URL, isRecord, type NebiusModel, parseModels } from "./models.ts";

export const MISSING_KEY = 'Nebius Token Factory: set export NEBIUS_API_KEY="..." and restart Pi.';
const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_BYTES = 4 * 1024 * 1024;

export class DiscoveryError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export interface DiscoveryOptions {
  apiKey?: string;
  agentDir: string;
  fetch?: typeof globalThis.fetch;
  now?: number;
  force?: boolean;
  signal?: AbortSignal;
}

export interface DiscoveryResult {
  models: NebiusModel[];
  source: "network" | "cache" | "stale" | "none";
  warning?: string;
}

export function cachePath(agentDir: string, apiKey: string): string {
  const fingerprint = createHash("sha256").update(`${BASE_URL}\0${apiKey}`).digest("hex");
  return join(agentDir, "cache", "pi-nebius", `${fingerprint}.json`);
}

async function readCache(
  path: string,
): Promise<{ checkedAt: number; models: NebiusModel[] } | undefined> {
  try {
    const raw = await readFile(path, "utf8");
    if (Buffer.byteLength(raw) > MAX_BYTES) return undefined;
    const value: unknown = JSON.parse(raw);
    if (
      !isRecord(value) ||
      value.version !== 1 ||
      typeof value.checkedAt !== "number" ||
      !Number.isFinite(value.checkedAt) ||
      !Array.isArray(value.models)
    )
      return undefined;
    // Cache only normalized discovery fields, and remap through the same validation path.
    return {
      checkedAt: value.checkedAt,
      models: parseModels({ object: "list", data: value.models }),
    };
  } catch {
    return undefined;
  }
}

async function writeCache(path: string, models: NebiusModel[], checkedAt: number): Promise<void> {
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(
      temp,
      JSON.stringify({
        version: 1,
        checkedAt,
        models: models.map((model) => ({
          id: model.id,
          name: model.name,
          context_length: model.contextWindow,
          architecture: {
            modality: model.input.includes("image") ? "text+image->text" : "text->text",
          },
          supported_features: model.reasoning ? ["reasoning"] : [],
          supported_sampling_parameters: model.compat?.supportsReasoningEffort
            ? ["reasoning_effort"]
            : [],
        })),
      }),
      { mode: 0o600, flag: "wx" },
    );
    await rename(temp, path);
  } finally {
    await unlink(temp).catch(() => {});
  }
}

export async function discoverModels(options: DiscoveryOptions): Promise<DiscoveryResult> {
  const key = options.apiKey?.trim();
  if (!key) return { models: [], source: "none", warning: MISSING_KEY };
  const path = cachePath(options.agentDir, key);
  const cached = await readCache(path);
  const now = options.now ?? Date.now();
  if (!options.force && cached && now >= cached.checkedAt && now - cached.checkedAt < TTL_MS) {
    return { models: cached.models, source: "cache" };
  }
  try {
    const signal = AbortSignal.any([
      AbortSignal.timeout(8000),
      ...(options.signal ? [options.signal] : []),
    ]);
    const response = await (options.fetch ?? globalThis.fetch)(`${BASE_URL}/models?verbose=true`, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      signal,
      redirect: "error",
    });
    if (!response.ok) {
      await response.body?.cancel();
      const detail =
        response.status === 401 || response.status === 403
          ? "Token Factory rejected the credentials; check NEBIUS_API_KEY and project access."
          : response.status === 429
            ? "Token Factory rate limit reached."
            : response.status >= 500
              ? "Token Factory is temporarily unavailable."
              : "Token Factory model discovery failed.";
      const retry = response.headers.get("retry-after");
      // Do not log arbitrary error bodies: they may echo credentials/request headers.
      const safeRetry = retry && /^[\w ,:+.-]{1,100}$/.test(retry) ? ` Retry-After: ${retry}.` : "";
      throw new DiscoveryError(`HTTP ${response.status}: ${detail}${safeRetry}`, response.status);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new DiscoveryError("Empty Token Factory model response.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES)
          throw new DiscoveryError("Token Factory model response exceeds 4 MiB.");
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    let payload: unknown;
    try {
      payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new DiscoveryError("Malformed JSON in Token Factory model response.");
    }
    const models = parseModels(payload);
    try {
      await writeCache(path, models, now);
    } catch {
      return {
        models,
        source: "network",
        warning: "Nebius models loaded, but the metadata cache could not be written.",
      };
    }
    return { models, source: "network" };
  } catch (error) {
    const authFailure =
      error instanceof DiscoveryError && (error.status === 401 || error.status === 403);
    if (authFailure) await unlink(path).catch(() => {});
    const fallback = !authFailure && !options.signal?.aborted ? cached : undefined;
    const detail =
      error instanceof DiscoveryError
        ? error.message
        : error instanceof Error && error.message.startsWith("Malformed Token Factory")
          ? error.message
          : "Token Factory model discovery could not complete (connectivity, timeout, or cancellation).";
    return {
      models: fallback?.models ?? [],
      source: fallback ? "stale" : "none",
      warning: `Nebius: ${detail} ${fallback ? "Using stale cached models." : "Use models.json for an offline model definition, then retry with /nebius-refresh."}`,
    };
  }
}
