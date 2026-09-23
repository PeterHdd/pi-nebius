import { distribution } from "./metrics.ts";
import { requestReport } from "./request-report.ts";
import type { Results, RunResult } from "./types.ts";

/** Client-observed first generated content on the first agent request, not worker startup. */
export function observedTtftMs(run: RunResult): number | null {
  const first = run.observation.requests.find((request) => request.purpose === "agent");
  if (first?.firstContentAtMs == null) return null;
  const elapsed = first.firstContentAtMs - first.startedAtMs;
  return elapsed >= 0 ? elapsed : null;
}

/** End-to-end output rate, including tools, network, setup, and validation. */
export function outputThroughput(runs: RunResult[]): number | null {
  if (
    !runs.length ||
    runs.some((run) => run.tokens.cumulativeOutputTokens === null || run.wallTimeMs <= 0)
  )
    return null;
  const tokens = runs.reduce((sum, run) => sum + (run.tokens.cumulativeOutputTokens ?? 0), 0);
  return tokens / (runs.reduce((sum, run) => sum + run.wallTimeMs, 0) / 1000);
}

function failureDetails(run: RunResult): string {
  const failed = run.validation.commands.find(
    (command) => command.exitCode !== 0 || command.timedOut,
  );
  const output = failed?.output ?? "";
  const reason =
    output.match(/\berror: \|-\n\s+([^\n]+)/)?.[1] ?? output.match(/\berror: (.+)/)?.[1];
  const named = output.match(/not ok \d+ - (.+)/)?.[1];
  const location = output.match(/TestContext[^\n]*\/([^/\n]+\.(?:mjs|js|ts):\d+:\d+)/)?.[1];
  const detail = reason && reason !== "|-" ? reason : named;
  return [run.errors[0] || detail, location]
    .filter(Boolean)
    .join("; ")
    .replace(/\s+/g, " ")
    .slice(0, 350);
}

export function terminalReport(results: Results): string {
  const unchecked = results.definition.validationMode === "none";
  const groups = results.aggregates;
  const runs = groups.map((group) => results.runs.filter((run) => run.model === group.model));
  const number = (value: number | null, decimals = 1) =>
    value === null
      ? "n/a"
      : value.toLocaleString("en-US", {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
        });
  const seconds = (value: number | null) =>
    value === null ? "n/a" : `${number(value / 1000, 2)} s`;
  const rows = [
    ["Metric", ...groups.map((group) => group.model)],
    [
      unchecked ? "Finished runs (not validated)" : "Validated success",
      ...groups.map(
        (group, index) =>
          `${unchecked ? runs[index]?.filter((run) => run.failure === null).length : group.successes}/${group.runs}`,
      ),
    ],
    ["Input tokens / run (mean)", ...groups.map((group) => number(group.inputTokens.mean, 0))],
    ["Output tokens / run (mean)", ...groups.map((group) => number(group.outputTokens.mean, 0))],
    ["Task duration (median)", ...groups.map((group) => seconds(group.wallTimeMs.median))],
    [
      "Observed TTFT (median)",
      ...runs.map((group) => seconds(distribution(group.map(observedTtftMs)).median)),
    ],
    ["Throughput (output tokens/s)", ...runs.map((group) => number(outputThroughput(group)))],
    ["Agent turns / run (mean)", ...groups.map((group) => number(group.turns.mean))],
    ["Tool calls / run (mean)", ...groups.map((group) => number(group.toolCalls.mean))],
  ];
  const widths =
    rows[0]?.map((_, index) => Math.max(...rows.map((row) => row[index]?.length ?? 0))) ?? [];
  const separator = widths.map((width) => "─".repeat(width)).join("─┼─");
  const table = rows.map((row) =>
    row
      .map((cell, index) => cell.padEnd(widths[index] ?? 0))
      .join(" │ ")
      .trimEnd(),
  );
  table.splice(1, 0, separator);
  const failures = results.runs.filter((run) => run.failure !== null);
  return [
    `Benchmark: ${results.definition.name}`,
    `Completed: ${results.runs.length}/${results.plannedRuns} (${results.status})`,
    ...(unchecked
      ? ["Correctness: not checked. Finished means execution completed without an error."]
      : []),
    "",
    ...table,
    "",
    "Tokens include every request in a run. Failed runs contribute to these metrics too.",
    "TTFT: first agent request start → first streamed text/reasoning/tool content; excludes worker startup.",
    "Stream chunks may contain multiple tokens; TTFT is client-observed, not server token timing.",
    "Throughput: total output tokens ÷ total task seconds, including network, tools, and validation.",
    "Unknown values are n/a. Means/medians exclude missing values; throughput needs complete output usage for every run.",
    ...(failures.length
      ? [
          "",
          "Failed runs:",
          ...failures.map((run) => {
            const details = failureDetails(run);
            return `- ${run.model} #${run.run}: ${run.failure}${details ? ` — ${details}` : ""}`;
          }),
        ]
      : []),
    "",
    ...results.runs.flatMap(requestReport),
    "",
    "Request tokens are provider-reported per HTTP attempt, including retries and compaction when observed.",
    "Δ input is the change from the preceding request, not tokens attributable to its tools.",
    "Context sizes are measured UTF-8 JSON bytes including message wrappers; category token counts are unavailable.",
    "Tool text sizes exclude images and may already be truncated by Pi. Commands, arguments, and successful output text are not stored.",
    "Input amplification = cumulative input / last agent request input; not a waste score or final context size.",
    "Detailed per-run measurements and validator output: results.json.",
  ].join("\n");
}
