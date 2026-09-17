import { resolve } from "node:path";
import { loadDefinition } from "../../src/benchmark/definition.ts";
import { terminalReport } from "../../src/benchmark/report.ts";
import { runBenchmark } from "../../src/benchmark/runner.ts";
import { parseModels } from "../../src/models.ts";

const { definition, directory } = await loadDefinition("benchmarks/fix-auth-bug");
const models = parseModels({
  object: "list",
  data: [{ id: "mock/model-a" }, { id: "mock/model-b" }],
});
const output = resolve(process.argv[2] ?? `benchmark-results/mock-demo-${Date.now()}`);
const results = await runBenchmark({
  definition,
  directory,
  models,
  runs: 2,
  concurrency: 1,
  output,
  apiKey: "not-a-real-key",
  workerPath: resolve("tests/benchmark/mock-worker.mjs"),
});
console.log("MOCK PROVIDER DEMO — real Pi and validators; scripted responses.");
console.log(terminalReport(results));
console.log(`Results: ${output}/results.json`);
if (results.runs.some((run) => !run.success)) process.exitCode = 1;
