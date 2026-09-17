import assert from "node:assert/strict";
import { test } from "node:test";
import { Instrumentation } from "../../src/benchmark/instrumentation.ts";
import { aggregate } from "../../src/benchmark/metrics.ts";
import { observedTtftMs, outputThroughput, terminalReport } from "../../src/benchmark/report.ts";
import type { Results, RunResult } from "../../src/benchmark/types.ts";

function run(overrides: Partial<RunResult> = {}): RunResult {
  return {
    model: "test/model",
    run: 1,
    success: false,
    failure: "validation_failed",
    errors: [],
    wallTimeMs: 2000,
    agentTurns: 2,
    toolCalls: 1,
    tokens: { cumulativeInputTokens: 1000, cumulativeOutputTokens: 100 },
    observation: { requests: [{ purpose: "agent", startedAtMs: 500, firstContentAtMs: 750 }] },
    validation: {
      checked: true,
      commands: [
        {
          exitCode: 1,
          timedOut: false,
          output:
            "not ok 1 - refresh contract\n  error: 'nowMs must be a finite number; received -Infinity'",
        },
      ],
    },
    ...overrides,
  } as RunResult;
}
test("observed TTFT excludes startup and never substitutes a later request", () => {
  assert.equal(observedTtftMs(run()), 250);
  const missing = run();
  const first = missing.observation.requests[0];
  assert.ok(first);
  first.firstContentAtMs = null;
  missing.observation.requests.push({ ...first, firstContentAtMs: 900 });
  assert.equal(observedTtftMs(missing), null);
});
test("throughput uses total tokens over total duration, including failures, and preserves unknowns", () => {
  assert.equal(outputThroughput([run(), run({ wallTimeMs: 8000 })]), 20);
  assert.equal(outputThroughput([]), null);
  assert.equal(outputThroughput([run({ wallTimeMs: 0 })]), null);
  const missing = run();
  missing.tokens.cumulativeOutputTokens = null;
  assert.equal(outputThroughput([run(), missing]), null);
});
test("report puts models across columns, labels timing and units, and explains validation failures", () => {
  const runs = [run(), run({ model: "test/other" })];
  const results = {
    definition: { name: "example" },
    status: "complete",
    plannedRuns: 2,
    runs,
    aggregates: aggregate(runs),
  } as Results;
  const report = terminalReport(results);
  assert.match(report, /Metric\s+│ test\/model\s+│ test\/other/);
  assert.match(report, /Input tokens \/ run \(mean\).*1,000/);
  assert.match(report, /Observed TTFT \(median\).*0.25 s/);
  assert.match(report, /Throughput \(output tokens\/s\).*50.0/);
  assert.match(report, /nowMs must be a finite number/);
  assert.doesNotMatch(report, /```/);
  results.definition.validationMode = "none";
  assert.match(terminalReport(results), /Correctness: not checked/);
  assert.match(terminalReport(results), /Finished runs \(not validated\)/);
});

test("first content ignores role and empty tool headers, but includes reasoning and tool arguments", async () => {
  for (const [delta, expected] of [
    [{ role: "assistant" }, null],
    [{ tool_calls: [{ index: 0, id: "call_1", function: { name: "", arguments: "" } }] }, null],
    [{ reasoning_content: "Thinking" }, 100],
    [{ tool_calls: [{ index: 0, function: { arguments: "{" } }] }, 100],
  ] as const) {
    const observer = new Instrumentation(
      () => {},
      () => 100,
    );
    const data = `data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`;
    const response = await observer.observeFetch(async () => new Response(data))(
      "https://example.test/chat/completions",
    );
    await response.text();
    assert.equal(observer.state.requests[0]?.firstContentAtMs, expected);
  }
});
