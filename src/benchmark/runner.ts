import { fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
import { mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { arch, platform, release } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { ModelSettingsMap } from "../model-settings.ts";
import type { NebiusModel } from "../models.ts";
import { emptyObservation, hash, redactor } from "./instrumentation.ts";
import { aggregate, intervalDuration, tokenTotals } from "./metrics.ts";
import { cleanEnvironment, descendants, runCommand, terminateGroup } from "./process.ts";
import type {
  BenchmarkDefinition,
  Command,
  Failure,
  Observation,
  Results,
  RunResult,
  WorkerInput,
  WorkerMessage,
} from "./types.ts";
import { copyTree, hashTree } from "./workspace.ts";

export interface RunnerOptions {
  definition: BenchmarkDefinition;
  directory: string;
  models: NebiusModel[];
  modelSettings?: ModelSettingsMap;
  runs: number;
  concurrency: number;
  output: string;
  apiKey: string;
  signal?: AbortSignal;
  onRun?: (result: RunResult) => void;
  /** Injectable worker only for integration tests/embedding; not exposed by the CLI. */
  workerPath?: string;
  workerArgs?: string[];
  /** Host Pi entry when running from a production-only extension installation. */
  piEntry?: string;
}
export function classifyFailure(input: {
  timedOut?: boolean;
  cancelled?: boolean;
  error?: string | null;
  requests?: Observation["requests"];
  validated?: boolean;
  toolErrors?: number;
}): Failure | null {
  if (input.cancelled) return "cancelled";
  if (input.timedOut) return "timeout";
  const error = input.error ?? "";
  if (/context[_ ](?:length|limit)|maximum context|too many tokens|prompt is too long/i.test(error))
    return "context_limit";
  if (/\b429\b|rate.?limit/i.test(error)) return "rate_limit";
  if (error) {
    if (/\b(?:4\d\d|5\d\d)\b|API|connection|fetch|network/i.test(error)) return "model_api_error";
    return "agent_error";
  }
  if (input.validated === false) return input.toolErrors ? "tool_error" : "validation_failed";
  return null;
}
async function atomicJson(path: string, value: unknown, redact: (text: string) => string) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${redact(JSON.stringify(value, null, 2))}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

async function executeAgent(
  input: WorkerInput,
  cwd: string,
  journal: string,
  signal: AbortSignal | undefined,
  workerPath: string | undefined,
  workerArgs: string[] | undefined,
  redact: (text: string) => string,
) {
  let observation = emptyObservation();
  let effectiveSettings: Record<string, unknown> = {};
  let error: string | null = null;
  let timedOut = false;
  let done = false;
  let stopped = false;
  const started = performance.now();
  const worker = workerPath ?? fileURLToPath(new URL("./worker.js", import.meta.url));
  const child = fork(worker, workerArgs ?? [], {
    cwd,
    env: { ...cleanEnvironment(), PI_CODING_AGENT_DIR: input.agentDir },
    execArgv: [],
    detached: true,
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  let stderr = "";
  child.stderr?.on("data", (data) => {
    stderr = (stderr + data).slice(-8000);
  });
  let force: NodeJS.Timeout | undefined;
  let descendantPids: number[] = [];
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (child.pid)
      void descendants(child.pid).then((pids) => {
        descendantPids = pids;
      });
    if (child.connected) child.send("abort", () => {});
    force = setTimeout(() => {
      for (const pid of descendantPids) terminateGroup(pid, "SIGKILL");
      if (child.pid) terminateGroup(child.pid, "SIGKILL");
    }, 2000);
  };
  const timer = setTimeout(() => {
    timedOut = true;
    stop();
  }, input.definition.timeout * 1000);
  signal?.addEventListener("abort", stop, { once: true });
  await new Promise<void>((resolveExit) => {
    child.on("message", (message: WorkerMessage) => {
      if (message.type === "observation") {
        observation = message.observation;
        try {
          appendFileSync(journal, `${redact(JSON.stringify({ schemaVersion: 2, ...message }))}\n`, {
            mode: 0o600,
          });
        } catch (caught) {
          error = `Trace persistence failed: ${caught}`;
          stop();
        }
      } else if (message.type === "settings") {
        effectiveSettings = message.effectiveSettings;
      } else if (message.type === "done") {
        done = true;
        error ??= message.error;
        effectiveSettings = message.effectiveSettings;
        // Pi's shell tools may start detached descendants. Clean those while the
        // worker is still alive, before it can orphan them.
        if (child.pid)
          void descendants(child.pid).then((pids) => {
            for (const pid of pids) terminateGroup(pid, "SIGKILL");
            if (child.connected) child.send("shutdown", () => {});
          });
      }
    });
    child.on("error", (caught) => {
      error = String(caught);
      resolveExit();
    });
    child.on("exit", (code, exitSignal) => {
      if (!done && !timedOut && !signal?.aborted)
        error ??= `Pi worker exited (${code ?? exitSignal}): ${stderr}`;
      resolveExit();
    });
    child.send(input, (caught) => {
      if (caught) {
        error = String(caught);
        stop();
      }
    });
    if (signal?.aborted) stop();
  });
  clearTimeout(timer);
  if (force) clearTimeout(force);
  signal?.removeEventListener("abort", stop);
  for (const pid of descendantPids) terminateGroup(pid, "SIGKILL");
  return {
    observation,
    effectiveSettings,
    error: error ? redact(error) : null,
    timedOut,
    durationMs: performance.now() - started,
  };
}

function expand(command: Command, validationDirectory: string): Command {
  return {
    command: command.command.replaceAll("{validation}", validationDirectory),
    args: command.args.map((arg) => arg.replaceAll("{validation}", validationDirectory)),
  };
}

async function executeRun(
  options: RunnerOptions,
  model: NebiusModel,
  run: number,
  output: string,
  snapshot: string,
  validationSnapshot: string,
  fixtureHash: string,
  validationHash: string,
): Promise<RunResult> {
  const start = performance.now();
  const id = `${String(run).padStart(3, "0")}-${hash(model.id).slice(0, 12)}`;
  const directory = join(output, "runs", id);
  const workspace = join(output, "active-workspace");
  const archivedWorkspace = join(directory, "workspace");
  const agentDir = join(directory, "pi");
  const validationDirectory = join(directory, "validation");
  const redact = redactor([options.apiKey]);
  const result: RunResult = {
    schemaVersion: 2,
    id,
    benchmark: options.definition.name,
    model: model.id,
    modelRevision: null,
    run,
    timestamp: new Date().toISOString(),
    success: false,
    failure: null,
    errors: [],
    wallTimeMs: 0,
    agentWallTimeMs: 0,
    modelRequestWallTimeMs: 0,
    toolExecutionTimeMs: 0,
    timeToFirstContentMs: null,
    modelGenerationTimeMs: null,
    agentOverheadTimeMs: null,
    agentTurns: 0,
    modelRequests: 0,
    toolCalls: 0,
    toolErrors: 0,
    toolCallsByType: {},
    tokens: tokenTotals([]),
    validation: {
      checked: options.definition.validationMode !== "none",
      passed: false,
      exitCode: null,
      durationMs: 0,
      commands: [],
    },
    setup: [],
    observation: emptyObservation(),
    workspace: archivedWorkspace,
    fixtureHash,
    finalWorkspaceHash: null,
    effectiveSettings: {},
  };
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    await mkdir(workspace, { mode: 0o700 });
    await copyTree(snapshot, workspace);
    if ((await hashTree(workspace)) !== fixtureHash)
      throw new Error("Fixture snapshot changed; refusing contaminated run");
    await mkdir(agentDir, { mode: 0o700 });
    // Setup never sees credentials. Pin dependencies in the fixture if setup installs them.
    for (const command of options.definition.setup) {
      const setup = await runCommand(
        command,
        workspace,
        options.definition.validationTimeout * 1000,
        options.signal,
        redact,
      );
      result.setup.push(setup);
      if (setup.exitCode !== 0 || setup.timedOut)
        throw new Error(`Benchmark setup failed: ${setup.output}`);
    }
    const executed = await executeAgent(
      {
        definition: options.definition,
        model,
        agentDir,
        apiKey: options.apiKey,
        modelSettings: options.modelSettings?.[model.id],
      },
      workspace,
      join(directory, "trace.jsonl"),
      options.signal,
      options.workerPath,
      options.workerArgs,
      redact,
    );
    const observation = executed.observation;
    result.observation = observation;
    result.agentWallTimeMs = executed.durationMs;
    result.effectiveSettings = executed.effectiveSettings;
    result.agentTurns = observation.agentTurns;
    result.modelRequests = observation.requests.length;
    result.toolCalls = observation.toolCalls;
    result.toolCallsByType = observation.toolCallsByType;
    result.toolErrors = observation.tools.filter((tool) => tool.isError).length;
    result.modelRequestWallTimeMs = observation.requests.some(
      (request) => request.endedAtMs === null,
    )
      ? null
      : intervalDuration(observation.requests);
    result.toolExecutionTimeMs = observation.tools.some(
      (tool) => tool.startedAtMs !== null && tool.endedAtMs === null,
    )
      ? null
      : intervalDuration(observation.tools);
    const first = observation.requests.find((request) => request.firstContentAtMs !== null);
    result.timeToFirstContentMs =
      first?.firstContentAtMs != null
        ? first.firstContentAtMs - (observation.agentStartedAtMs ?? first.startedAtMs)
        : null;
    result.tokens = tokenTotals(observation.requests);
    result.errors = [...observation.errors, ...(executed.error ? [executed.error] : [])];

    // Restore trusted validators AFTER the agent exits; edited fixture tests cannot replace these.
    if ((await hashTree(validationSnapshot)) !== validationHash)
      throw new Error("Trusted validation snapshot changed");
    await copyTree(validationSnapshot, validationDirectory);
    const validationStart = performance.now();
    for (const command of options.definition.validation) {
      result.validation.commands.push(
        await runCommand(
          expand(command, validationDirectory),
          workspace,
          options.definition.validationTimeout * 1000,
          options.signal,
          redact,
        ),
      );
    }
    result.validation.durationMs = performance.now() - validationStart;
    const passed =
      result.validation.commands.length > 0 &&
      result.validation.commands.every((command) => command.exitCode === 0 && !command.timedOut);
    const integrity = (await hashTree(validationDirectory)) === validationHash;
    if (!integrity) result.errors.push("Trusted validators were modified during validation");
    result.validation.passed = passed && integrity;
    result.validation.exitCode = result.validation.passed
      ? 0
      : (result.validation.commands.find((command) => command.exitCode !== 0)?.exitCode ?? null);
    const finalError =
      executed.error ??
      (["error", "aborted"].includes(observation.lastAssistantStopReason ?? "")
        ? (observation.errors.at(-1) ?? "Agent ended without completing")
        : null);
    result.failure = classifyFailure({
      timedOut: executed.timedOut || result.validation.commands.some((command) => command.timedOut),
      cancelled: options.signal?.aborted,
      error: finalError,
      validated: result.validation.checked ? result.validation.passed : undefined,
      toolErrors: result.toolErrors,
    });
    result.success = result.failure === null && result.validation.passed;
    try {
      result.finalWorkspaceHash = await hashTree(workspace);
    } catch {
      result.errors.push("Final workspace hash unavailable (generated links or unsupported files)");
    }
  } catch (error) {
    result.errors.push(redact(String(error)));
    result.failure = options.signal?.aborted ? "cancelled" : "agent_error";
  }
  try {
    await copyTree(workspace, archivedWorkspace);
  } catch (error) {
    result.errors.push(redact(`Workspace archival failed: ${error}`));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
  result.wallTimeMs = performance.now() - start;
  await atomicJson(join(directory, "run.json"), result, redact);
  return result;
}

export async function runBenchmark(options: RunnerOptions): Promise<Results> {
  if (options.concurrency !== 1)
    throw new Error(
      "v1 requires --concurrency 1 to preserve Pi's exact system prompt and isolate runs without rewriting cwd metadata",
    );
  if (process.platform === "win32")
    throw new Error("v1 requires macOS or Linux for process-tree cancellation");
  // Resolve existing ancestors before creating anything: a symlinked output
  // parent must not smuggle the snapshot back inside its own source tree.
  const canonical = async (path: string): Promise<string> => {
    try {
      return await realpath(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = dirname(path);
      if (parent === path) throw error;
      return resolve(await canonical(parent), relative(parent, path));
    }
  };
  const output = await canonical(resolve(options.output));
  for (const source of [options.definition.fixture, options.definition.validationDirectory]) {
    const inside = relative(await realpath(resolve(options.directory, source)), output);
    if (!isAbsolute(inside) && inside !== ".." && !inside.startsWith(`..${sep}`))
      throw new Error("Output must be outside fixture and validation directories");
  }
  await mkdir(dirname(output), { recursive: true });
  await mkdir(output, { mode: 0o700 }); // Never overwrite or mix result sets.
  const redact = redactor([options.apiKey]);
  const snapshot = join(output, "snapshot", "fixture");
  const validationSnapshot = join(output, "snapshot", "validation");
  await copyTree(join(options.directory, options.definition.fixture), snapshot);
  await copyTree(
    join(options.directory, options.definition.validationDirectory),
    validationSnapshot,
  );
  const fixtureHash = await hashTree(snapshot);
  const validationHash = await hashTree(validationSnapshot);
  const packageJson = JSON.parse(
    await readFile(new URL("../../package.json", import.meta.url), "utf8"),
  );
  // Resolve Pi's installed package through its public entry point, avoiding private exports.
  const piEntry =
    options.piEntry ?? fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
  const piVersion = JSON.parse(
    await readFile(join(dirname(piEntry), "../package.json"), "utf8"),
  ).version;
  const results: Results = {
    schemaVersion: 2,
    status: "running",
    timestamp: new Date().toISOString(),
    metadata: {
      piVersion,
      piNebiusVersion: packageJson.version,
      nodeVersion: process.version,
      os: { platform: platform(), release: release(), architecture: arch() },
      fixtureHash,
      validationHash,
      definitionHash: hash(JSON.stringify(options.definition)),
      modelDefinitions: options.models.map(({ cost: _cost, ...model }) => model),
      concurrency: options.concurrency,
      runsPerModel: options.runs,
      workerImplementation: options.workerPath ?? "built-in Pi SDK worker",
      measurement: "provider-reported usage; client-observed wall times; no local token estimates",
    },
    definition: options.definition,
    plannedRuns: options.runs * options.models.length,
    runs: [],
    aggregates: [],
  };
  await atomicJson(join(output, "results.json"), results, redact);
  // Round-robin order avoids running every repetition of one model in one time window.
  const jobs = Array.from({ length: options.runs }, (_, index) => index + 1).flatMap((run) =>
    options.models.map((model) => ({ run, model })),
  );
  for (const job of jobs) {
    if (options.signal?.aborted) break;
    const result = await executeRun(
      options,
      job.model,
      job.run,
      output,
      snapshot,
      validationSnapshot,
      fixtureHash,
      validationHash,
    );
    results.runs.push(result);
    results.aggregates = aggregate(results.runs);
    options.onRun?.(result);
    await atomicJson(join(output, "results.json"), results, redact);
  }
  results.runs.sort((a, b) => a.run - b.run || a.model.localeCompare(b.model));
  results.status = options.signal?.aborted ? "cancelled" : "complete";
  results.aggregates = aggregate(results.runs);
  results.metadata.systemPromptHashes = [
    ...new Set(results.runs.map((run) => run.observation.systemPromptHash).filter(Boolean)),
  ];
  await atomicJson(join(output, "results.json"), results, redact);
  return results;
}
