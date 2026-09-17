#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { discoverModels, MISSING_KEY } from "../discovery.ts";
import { loadDefinition, positive } from "./definition.ts";
import { redactor } from "./instrumentation.ts";
import { terminalReport } from "./report.ts";
import { runBenchmark } from "./runner.ts";

const HELP = `Usage: pi-nebius benchmark --benchmark DIRECTORY --models ID,ID [options]

  --benchmark PATH   Directory with benchmark.yaml, or YAML/JSON definition file
  --models IDS       Comma-separated, exact Nebius model IDs (no automatic selection)
  --runs N           Repetitions per model (default: 1)
  --timeout SECONDS  Per-agent deadline, including worker/session startup
  --output PATH      New result directory (must not already exist)
  --concurrency N    v1 supports 1 only: identical Pi prompts without cwd rewriting
  --help             Show this help

Each run receives a fresh fixture copy and an isolated Pi configuration.
Pi tools have normal host access: filesystem copies are not a security sandbox.
Use a disposable machine/container for untrusted fixtures or model-generated shell commands.
No API key or prompt/response/tool content is retained in request traces.
`;

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--help" || args[0] === "-h" || args.length === 0) {
    console.log(HELP);
    return;
  }
  if (args.shift() !== "benchmark")
    throw new Error("Expected the benchmark subcommand. Use --help.");
  const { values } = parseArgs({
    args,
    strict: true,
    options: {
      benchmark: { type: "string" },
      models: { type: "string" },
      runs: { type: "string" },
      timeout: { type: "string" },
      output: { type: "string" },
      concurrency: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) {
    console.log(HELP);
    return;
  }
  if (!values.benchmark || !values.models) throw new Error("--benchmark and --models are required");
  const runs = positive(Number(values.runs ?? 1), "runs", 1000);
  const concurrency = positive(Number(values.concurrency ?? 1), "concurrency", 1);
  const ids = values.models.split(",").map((id) => id.trim());
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length)
    throw new Error("--models must contain nonempty, unique exact IDs");
  if (runs * ids.length > 10000) throw new Error("At most 10,000 runs per invocation");
  const { definition, directory } = await loadDefinition(values.benchmark);
  if (values.timeout) definition.timeout = positive(Number(values.timeout), "timeout");
  const apiKey = process.env.NEBIUS_API_KEY?.trim();
  if (!apiKey) throw new Error(MISSING_KEY);
  const cache = await mkdtemp(join(tmpdir(), "pi-nebius-benchmark-discovery-"));
  const discovered = await discoverModels({ apiKey, agentDir: cache, force: true }).finally(() =>
    rm(cache, { recursive: true, force: true }),
  );
  if (discovered.warning) process.stderr.write(`${discovered.warning}\n`);
  const models = ids.map((id) => {
    const model = discovered.models.find((candidate) => candidate.id === id);
    if (!model)
      throw new Error(
        `Requested model was not discovered: ${id}. Check its exact ID and your access.`,
      );
    return model;
  });
  const output = resolve(
    values.output ??
      join(
        "benchmark-results",
        `${new Date().toISOString().replaceAll(":", "-")}-${randomUUID().slice(0, 8)}`,
      ),
  );
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);
  try {
    const results = await runBenchmark({
      definition,
      directory,
      models,
      runs,
      concurrency,
      output,
      apiKey,
      signal: controller.signal,
      onRun: (run) =>
        process.stderr.write(`${run.model} #${run.run}: ${run.success ? "PASS" : run.failure}\n`),
    });
    console.log(terminalReport(results));
    console.log(`Results: ${join(output, "results.json")}`);
    process.exitCode =
      results.status === "cancelled" ? 130 : results.runs.every((run) => run.success) ? 0 : 1;
  } finally {
    process.removeListener("SIGINT", abort);
    process.removeListener("SIGTERM", abort);
  }
}
void main().catch((error) => {
  console.error(redactor([process.env.NEBIUS_API_KEY ?? ""])(String(error)));
  process.exitCode = 2;
});
