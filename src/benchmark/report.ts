import type { Results } from "./types.ts";

export function terminalReport(results: Results): string {
  const unchecked = results.definition.validationMode === "none";
  const number = (value: number | null, decimals = 1) =>
    value === null ? "n/a" : value.toFixed(decimals);
  const rows = [
    [
      "MODEL",
      unchecked ? "FINISHED" : "SUCCESS",
      "MED COST",
      "MED WALL",
      "MEAN INPUT",
      "MEAN OUTPUT",
      "MEAN TURNS",
      "MEAN TOOLS",
    ],
    ...results.aggregates.map((group) => [
      group.model,
      `${unchecked ? results.runs.filter((run) => run.model === group.model && run.failure === null).length : group.successes}/${group.runs}`,
      group.costUsd.median === null ? "n/a" : `$${group.costUsd.median.toFixed(5)}`,
      group.wallTimeMs.median === null ? "n/a" : `${(group.wallTimeMs.median / 1000).toFixed(2)}s`,
      number(group.inputTokens.mean, 0),
      number(group.outputTokens.mean, 0),
      number(group.turns.mean),
      number(group.toolCalls.mean),
    ]),
  ];
  const widths =
    rows[0]?.map((_, index) => Math.max(...rows.map((row) => row[index]?.length ?? 0))) ?? [];
  return [
    `Benchmark: ${results.definition.name}`,
    `Completed: ${results.runs.length}/${results.plannedRuns} (${results.status})`,
    ...(unchecked
      ? ["Correctness: not checked. Finished means the agent completed without an execution error."]
      : []),
    "",
    ...rows.map((row) =>
      row
        .map((cell, index) => cell.padEnd(widths[index] ?? 0))
        .join("  ")
        .trimEnd(),
    ),
    "",
    "Input/output = cumulative provider-reported usage across HTTP attempts, not final context size.",
    "All completed runs, including failures, contribute. Unknown costs/tokens are excluded, never zero-filled.",
    "Per-run values, missing counts, ranges and standard deviations are in results.json.",
  ].join("\n");
}
