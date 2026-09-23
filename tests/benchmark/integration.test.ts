import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { loadDefinition } from "../../src/benchmark/definition.ts";
import { runCommand } from "../../src/benchmark/process.ts";
import { terminalReport } from "../../src/benchmark/report.ts";
import { runBenchmark } from "../../src/benchmark/runner.ts";
import type { Results } from "../../src/benchmark/types.ts";
import { copyTree, hashTree, treeFiles } from "../../src/benchmark/workspace.ts";
import { parseModels } from "../../src/models.ts";

const root = resolve(import.meta.dirname, "../..");
const workerPath = join(root, "tests/benchmark/mock-worker.mjs");
const fakeKey = "benchmark-test-secret-not-real";

test("all four deterministic suites reject originals and accept reference solutions", {
  timeout: 20000,
}, async () => {
  const scratch = await mkdtemp(join(tmpdir(), "bench-fixtures-"));
  const solutions = JSON.parse(
    await readFile(join(root, "tests/benchmark/solutions.json"), "utf8"),
  ) as Record<string, Record<string, string>>;
  try {
    for (const [name, files] of Object.entries(solutions)) {
      const { definition, directory } = await loadDefinition(join(root, "benchmarks", name));
      const workspace = join(scratch, name);
      await copyTree(join(directory, definition.fixture), workspace);
      const command = {
        command: process.execPath,
        args: ["--test", join(directory, definition.validationDirectory, "check.test.mjs")],
      };
      const initial = await runCommand(command, workspace, 5000);
      assert.notEqual(initial.exitCode, 0, `${name} must not pass without solving the task`);
      for (const [file, contents] of Object.entries(files))
        await writeFile(join(workspace, file), contents);
      const solved = await runCommand(command, workspace, 5000);
      assert.equal(solved.exitCode, 0, `${name}: ${solved.output}`);
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test("real Pi sessions: two models × two runs, fresh isolation, traces and JSON report", {
  timeout: 30000,
}, async () => {
  const scratch = await mkdtemp(join(tmpdir(), "bench-sdk-"));
  try {
    const { definition, directory } = await loadDefinition(join(root, "benchmarks/fix-auth-bug"));
    const originalHash = await hashTree(join(directory, definition.fixture));
    const models = parseModels({
      object: "list",
      data: [
        { id: "mock/pass-a", supported_sampling_parameters: ["temperature", "reasoning_effort"] },
        { id: "mock/pass-b" },
      ],
    });
    const output = join(scratch, "results");
    const results = await runBenchmark({
      definition,
      directory,
      models,
      runs: 2,
      concurrency: 1,
      output,
      apiKey: fakeKey,
      workerPath,
      modelSettings: {
        "mock/pass-a": { temperature: 0.25, reasoningEffort: "low", maxTokens: 333 },
      },
    });
    assert.equal(results.status, "complete");
    assert.equal(results.schemaVersion, 2);
    assert.equal(results.runs.length, 4);
    assert.equal(new Set(results.runs.map((run) => run.workspace)).size, 4);
    for (const run of results.runs) {
      assert.equal(run.success, true, JSON.stringify(run));
      const parameters = run.effectiveSettings.requestParameters as Record<string, unknown>[];
      assert.equal(parameters.length, 2);
      for (const request of parameters) {
        if (run.model === "mock/pass-a")
          assert.deepEqual(request, {
            temperature: 0.25,
            reasoning_effort: "low",
            max_tokens: 333,
          });
        else {
          assert.equal(request.temperature, undefined);
          assert.equal(request.reasoning_effort, undefined);
        }
      }
      assert.equal(run.modelRequests, 2);
      const firstRequest = run.observation.requests[0];
      const secondRequest = run.observation.requests[1];
      assert.ok((firstRequest?.context?.bytes.tools ?? 0) > 0);
      assert.equal(firstRequest?.generatedToolCalls?.[0]?.name, "write");
      assert.equal(run.observation.tools[0]?.request, 1);
      assert.ok((run.observation.tools[0]?.output?.bytes ?? 0) > 0);
      assert.equal(secondRequest?.context?.toolResults[0]?.id, run.observation.tools[0]?.id);
      assert.equal(run.agentTurns, 2);
      assert.equal(run.toolCalls, 1);
      assert.equal(run.toolErrors, 0);
      assert.equal(run.tokens.cumulativeInputTokens, 320);
      assert.equal(run.tokens.cumulativeOutputTokens, 60);
      assert.equal(run.tokens.cachedInputTokens, 50);
      assert.equal(run.tokens.reasoningTokens, 7);
      assert.equal(run.tokens.lastRequestInputTokens, 220);
      assert.equal(run.validation.exitCode, 0);
      assert.equal(run.fixtureHash, originalHash);
      assert.notEqual(run.finalWorkspaceHash, originalHash);
    }
    assert.equal(
      (results.metadata.systemPromptHashes as string[]).length,
      1,
      "Pi's system instructions must be identical",
    );
    assert.equal(await hashTree(join(directory, definition.fixture)), originalHash);
    const serialized = await readFile(join(output, "results.json"), "utf8");
    assert.doesNotMatch(serialized, new RegExp(fakeKey));
    assert.doesNotMatch(
      serialized,
      /"(?:pricing|pricingHash|estimatedCostUsd|observedEstimatedCostUsd|costUsd|cost)"/,
    );
    assert.deepEqual(JSON.parse(serialized), results);
    const report = terminalReport(results);
    assert.match(report, /mock\/pass-a/);
    assert.match(report, /2\/2/);
    for (const path of await treeFiles(output)) {
      assert.ok(
        !(await readFile(join(output, path), "utf8")).includes(fakeKey),
        `Secret in ${path}`,
      );
    }
    await assert.rejects(
      runBenchmark({
        definition,
        directory,
        models,
        runs: 1,
        concurrency: 1,
        output,
        apiKey: fakeKey,
        workerPath,
      }),
      /EEXIST/,
    );
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test("failure runs remain in output: deterministic rejection, API failure, timeout and cancellation", {
  timeout: 60000,
}, async () => {
  const scratch = await mkdtemp(join(tmpdir(), "bench-failures-"));
  try {
    const { definition, directory } = await loadDefinition(join(root, "benchmarks/fix-auth-bug"));
    // These cases must reach the mock response, even on slower CI workers.
    definition.timeout = 20;
    const models = parseModels({
      object: "list",
      data: [{ id: "mock/fail" }, { id: "mock/error" }, { id: "mock/timeout" }],
    });
    const results = await runBenchmark({
      definition,
      directory,
      models: models.filter((model) => model.id !== "mock/timeout"),
      runs: 1,
      concurrency: 1,
      output: join(scratch, "failures"),
      apiKey: fakeKey,
      workerPath,
    });
    assert.equal(results.runs.length, 2);
    const failed = results.runs.find((run) => run.model === "mock/fail");
    assert.equal(failed?.failure, "validation_failed");
    const error = results.runs.find((run) => run.model === "mock/error");
    assert.equal(error?.failure, "model_api_error", JSON.stringify(error));
    assert.equal(error?.tokens.usageComplete, false);
    assert.doesNotMatch(JSON.stringify(error), new RegExp(fakeKey));
    const slowModel = models.find((model) => model.id === "mock/timeout");
    assert.ok(slowModel);
    // Only the deliberate timeout case uses a short deadline.
    const timedOut = await runBenchmark({
      definition: { ...definition, timeout: 1 },
      directory,
      models: [slowModel],
      runs: 1,
      concurrency: 1,
      output: join(scratch, "timeout"),
      apiKey: fakeKey,
      workerPath,
    });
    assert.equal(timedOut.runs.length, 1);
    const timeout = timedOut.runs[0];
    assert.equal(timeout?.failure, "timeout");
    assert.equal(timeout?.tokens.cumulativeInputTokens, null);
    assert.ok((timeout?.wallTimeMs ?? Infinity) < 5000);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 500);
    const cancelled: Results = await runBenchmark({
      definition: { ...definition, timeout: 30 },
      directory,
      models: [slowModel],
      runs: 2,
      concurrency: 1,
      output: join(scratch, "cancelled"),
      apiKey: fakeKey,
      workerPath,
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));
    assert.equal(cancelled.status, "cancelled");
    assert.equal(cancelled.runs.length, 1);
    assert.equal(cancelled.runs[0]?.failure, "cancelled");
    assert.equal(cancelled.plannedRuns, 2);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test("CLI help and argument/key errors require no credentials or provider calls", async () => {
  const cli = join(root, "dist/benchmark/cli.js");
  const help = await runCommand({ command: process.execPath, args: [cli, "--help"] }, root, 3000);
  assert.equal(help.exitCode, 0);
  assert.match(help.output, /--concurrency/);
  const missing = await runCommand(
    {
      command: process.execPath,
      args: [cli, "benchmark", "--benchmark", "benchmarks/fix-auth-bug", "--models", "test/model"],
    },
    root,
    3000,
  );
  assert.equal(missing.exitCode, 2);
  assert.match(missing.output, /NEBIUS_API_KEY/);
  const bad = await runCommand(
    {
      command: process.execPath,
      args: [cli, "benchmark", "--runs", "0", "--benchmark", "x", "--models", "a"],
    },
    root,
    3000,
  );
  assert.equal(bad.exitCode, 2);
  assert.match(bad.output, /runs must/);
});

test("hard timeout kills an unresponsive worker and refuses unsafe output/concurrency settings", {
  timeout: 10000,
}, async () => {
  const scratch = await mkdtemp(join(tmpdir(), "bench-hard-timeout-"));
  try {
    const { definition, directory } = await loadDefinition(join(root, "benchmarks/fix-auth-bug"));
    definition.timeout = 1;
    const models = parseModels({ object: "list", data: [{ id: "mock/hung" }] });
    const options = {
      definition,
      directory,
      models,
      runs: 1,
      concurrency: 1,
      output: join(scratch, "result"),
      apiKey: fakeKey,
      workerPath: join(root, "tests/benchmark/hung-worker.mjs"),
    };
    const results = await runBenchmark(options);
    assert.equal(results.runs[0]?.failure, "timeout");
    assert.ok((results.runs[0]?.wallTimeMs ?? Infinity) < 6000);
    await assert.rejects(runBenchmark({ ...options, concurrency: 2 }), /concurrency 1/);
    await assert.rejects(
      runBenchmark({ ...options, output: join(directory, "fixture/output") }),
      /outside fixture/,
    );
    await symlink(join(directory, "fixture"), join(scratch, "fixture-alias"));
    await assert.rejects(
      runBenchmark({ ...options, output: join(scratch, "fixture-alias/new/output") }),
      /outside fixture/,
    );
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
