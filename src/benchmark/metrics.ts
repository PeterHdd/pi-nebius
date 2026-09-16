import type {
  Distribution,
  ModelAggregate,
  ModelPricing,
  RequestTrace,
  RunResult,
  TokenTotals,
} from "./types.ts";

export function tokenTotals(requests: RequestTrace[]): TokenTotals {
  const sum = (field: "inputTokens" | "outputTokens" | "cachedInputTokens" | "reasoningTokens") =>
    requests.reduce((total, request) => total + (request.usage?.[field] ?? 0), 0);
  const complete = (
    field: "inputTokens" | "outputTokens" | "cachedInputTokens" | "reasoningTokens",
  ) => requests.length > 0 && requests.every((request) => request.usage?.[field] != null);
  const input = complete("inputTokens") ? sum("inputTokens") : null;
  const last =
    requests.filter((request) => request.purpose === "agent").at(-1)?.usage?.inputTokens ?? null;
  return {
    cumulativeInputTokens: input,
    cumulativeOutputTokens: complete("outputTokens") ? sum("outputTokens") : null,
    cachedInputTokens: complete("cachedInputTokens") ? sum("cachedInputTokens") : null,
    reasoningTokens: complete("reasoningTokens") ? sum("reasoningTokens") : null,
    observedInputTokens: sum("inputTokens"),
    observedOutputTokens: sum("outputTokens"),
    requestsWithUsage: requests.filter(
      (request) => request.usage?.inputTokens != null && request.usage.outputTokens != null,
    ).length,
    usageComplete: complete("inputTokens") && complete("outputTokens"),
    lastRequestInputTokens: last,
    finalContextSizeTokens: null,
    inputAmplification: null,
    inputAmplificationVsLastRequest:
      input !== null && last !== null && last > 0 ? input / last : null,
  };
}

export function requestCost(request: RequestTrace, pricing: ModelPricing | null): number | null {
  const usage = request.usage;
  if (!pricing || usage?.inputTokens == null || usage.outputTokens == null) return null;
  const cachedRate = pricing.cachedInputPerMillion ?? pricing.inputPerMillion;
  if (usage.cachedInputTokens === null && cachedRate !== pricing.inputPerMillion) return null;
  const cached = usage.cachedInputTokens ?? 0;
  if (cached > usage.inputTokens) return null;
  // Reasoning tokens are a subset of output: never charge for them twice.
  return (
    ((usage.inputTokens - cached) * pricing.inputPerMillion +
      cached * cachedRate +
      usage.outputTokens * pricing.outputPerMillion) /
      1_000_000 +
    (pricing.requestUsd ?? 0)
  );
}
export function totalCost(requests: RequestTrace[], pricing: ModelPricing | null) {
  const costs = requests.map((request) => requestCost(request, pricing));
  const known = costs.filter((cost): cost is number => cost !== null);
  const observed = known.length ? known.reduce((a, b) => a + b, 0) : null;
  return {
    estimatedCostUsd: costs.length > 0 && known.length === costs.length ? observed : null,
    observedEstimatedCostUsd: observed,
  };
}
export function distribution(values: Array<number | null>): Distribution {
  const known = values
    .filter((value): value is number => value !== null && Number.isFinite(value))
    .sort((a, b) => a - b);
  const count = known.length;
  if (!count)
    return {
      count: 0,
      missing: values.length,
      mean: null,
      median: null,
      min: null,
      max: null,
      standardDeviation: null,
    };
  const mean = known.reduce((a, b) => a + b, 0) / count;
  return {
    count,
    missing: values.length - count,
    mean,
    median: ((known[Math.floor((count - 1) / 2)] ?? 0) + (known[Math.floor(count / 2)] ?? 0)) / 2,
    min: known[0] ?? null,
    max: known.at(-1) ?? null,
    standardDeviation: Math.sqrt(
      known.reduce((total, value) => total + (value - mean) ** 2, 0) / count,
    ),
  };
}
export function aggregate(runs: RunResult[]): ModelAggregate[] {
  return [...new Set(runs.map((run) => run.model))].map((model) => {
    const group = runs.filter((run) => run.model === model);
    const successes = group.filter((run) => run.success).length;
    return {
      model,
      runs: group.length,
      successes,
      successRate: successes / group.length,
      costUsd: distribution(group.map((run) => run.estimatedCostUsd)),
      wallTimeMs: distribution(group.map((run) => run.wallTimeMs)),
      inputTokens: distribution(group.map((run) => run.tokens.cumulativeInputTokens)),
      outputTokens: distribution(group.map((run) => run.tokens.cumulativeOutputTokens)),
      turns: distribution(group.map((run) => run.agentTurns)),
      toolCalls: distribution(group.map((run) => run.toolCalls)),
    };
  });
}
/** Union, rather than sum, avoids double-counting parallel tool/request intervals. */
export function intervalDuration(
  intervals: Array<{ startedAtMs: number | null; endedAtMs: number | null }>,
): number {
  const ordered = intervals
    .filter(
      (item): item is { startedAtMs: number; endedAtMs: number } =>
        item.startedAtMs !== null && item.endedAtMs !== null,
    )
    .sort((a, b) => a.startedAtMs - b.startedAtMs);
  let total = 0;
  let end = 0;
  for (const item of ordered) {
    total += Math.max(0, item.endedAtMs - Math.max(end, item.startedAtMs));
    end = Math.max(end, item.endedAtMs);
  }
  return total;
}
