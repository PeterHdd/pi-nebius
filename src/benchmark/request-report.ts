import type { RunResult } from "./types.ts";

const number = (value: number | null | undefined) =>
  value == null ? "n/a" : value.toLocaleString("en-US");
// biome-ignore lint/suspicious/noControlCharactersInRegex: remove terminal control characters from labels
const label = (value: string) => value.replace(/[\x00-\x1f\x7f-\x9f]/g, " ").slice(0, 80);
const table = (rows: string[][]) => {
  const widths =
    rows[0]?.map((_, index) => Math.max(...rows.map((row) => row[index]?.length ?? 0))) ?? [];
  return rows.map((row) =>
    row
      .map((cell, index) => cell.padEnd(widths[index] ?? 0))
      .join(" │ ")
      .trimEnd(),
  );
};

export function requestReport(run: RunResult): string[] {
  const requests = run.observation.requests;
  const tools = run.observation.tools ?? [];
  const rows = [["Request", "Kind", "Input", "Δ input", "Output", "Cached", "Tools produced"]];
  const sizes = [
    ["Request", "System B", "Schemas B", "User B", "Assistant B", "Tool results B", "Other B"],
  ];
  for (const [index, request] of requests.entries()) {
    const input = request.usage?.inputTokens;
    const previous = requests[index - 1]?.usage?.inputTokens;
    const delta = input != null && previous != null ? input - previous : null;
    rows.push([
      String(request.request ?? index + 1),
      request.purpose,
      number(input),
      delta !== null && delta > 0 ? `+${number(delta)}` : number(delta),
      number(request.usage?.outputTokens),
      number(request.usage?.cachedInputTokens),
      request.generatedToolCalls?.length
        ? request.generatedToolCalls.map((tool) => label(tool.name)).join(", ")
        : "—",
    ]);
    const bytes = request.context?.bytes;
    sizes.push([
      String(request.request ?? index + 1),
      ...[
        bytes?.system,
        bytes?.tools,
        bytes?.user,
        bytes?.assistant,
        bytes?.toolResults,
        bytes?.other,
      ].map(number),
    ]);
  }
  const input = run.tokens.cumulativeInputTokens;
  const output = run.tokens.cumulativeOutputTokens;
  rows.push([
    "TOTAL",
    "all attempts",
    number(input),
    "—",
    number(output),
    number(run.tokens.cachedInputTokens),
    "",
  ]);
  const last = run.tokens.lastRequestInputTokens;
  const amplification = run.tokens.inputAmplificationVsLastRequest;
  const total = input != null && output != null ? input + output : null;
  const consumption =
    run.success && run.validation.checked
      ? "Tokens to validated solution"
      : run.failure !== null
        ? "Tokens consumed before failure"
        : "Tokens consumed (correctness not checked)";
  const lines = [
    "",
    `Request trace: ${label(run.model)} #${run.run}`,
    ...table(rows),
    `${consumption}: ${number(total)} (input ${number(input)} + output ${number(output)}).`,
    `Last agent request input: ${number(last)}; input amplification: ${amplification == null ? "n/a" : `${amplification.toFixed(2)}x`}.`,
    "",
    "Context composition — measured JSON bytes (B), NOT token attribution:",
    ...table(sizes),
  ];
  if (tools.length) {
    lines.push("", "Tool results — model-facing text after Pi processing:");
    const toolRows = [
      [
        "Tool",
        "From request",
        "Text bytes",
        "Lines",
        "Included in requests",
        "Repeated arguments",
        "Same result",
      ],
    ];
    for (const [index, tool] of tools.entries()) {
      const included = requests
        .filter((request) => request.context?.toolResults.some((result) => result.id === tool.id))
        .map((request) => request.request);
      const reference = (id: string | null | undefined) => {
        const at = tools.findIndex((item) => item.id === id);
        return at < 0 ? "—" : `T${at + 1}`;
      };
      toolRows.push([
        `T${index + 1} ${label(tool.name)}`,
        number(tool.request),
        number(tool.output?.bytes),
        number(tool.output?.lines),
        requests.every((request) => request.context != null)
          ? included.join(", ") || "none"
          : `${included.join(", ") || "none observed"} (partial)`,
        reference(tool.repeatedArgumentsOf),
        reference(tool.repeatedOutputOf),
      ]);
    }
    lines.push(...table(toolRows));
    const large = tools
      .map((tool, index) => ({ tool, index }))
      .filter(({ tool }) => (tool.output?.bytes ?? 0) >= 16384);
    for (const { tool, index } of large)
      lines.push(
        `Observation: T${index + 1} returned ${number(tool.output?.bytes)} text bytes (large-output threshold: 16 KiB).`,
      );
    if (tools.some((tool) => tool.repeatedArgumentsOf))
      lines.push(
        "Repeated arguments/results are candidates to inspect, not proof of unnecessary work or unchanged files.",
      );
  }
  return lines;
}
