import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { findPackageJSON } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { MISSING_KEY } from "../discovery.ts";
import type { NebiusModel } from "../models.ts";
import { loadDefinition, positive } from "./definition.ts";
import { redactor } from "./instrumentation.ts";
import { snapshotProject } from "./project.ts";
import { terminalReport } from "./report.ts";
import { runBenchmark } from "./runner.ts";
import type { BenchmarkDefinition } from "./types.ts";

const tasks = ["fix-auth-bug", "add-api-endpoint", "refactor-module", "multi-file-feature"];
const help = `Usage: /nebius-benchmark [--models ID,ID] [--runs N]
Enter your task prompt in the editor. Each run gets a fresh copy of the current project.
Without --models, uses the selected Nebius model. Default: 1 run per model.
Optional: --task NAME uses a bundled task instead (${tasks.join(", ")}).
/nebius-benchmark cancel stops the active benchmark.
Results appear here and in benchmark-results/. Custom prompts have no correctness check.
Copies exclude Git-ignored files, dependencies, build output, and known credential files.
Runs use paid inference and tools with normal host access; copies are not a security sandbox.`;

export async function hostPiEntry(): Promise<string> {
  // The running Pi CLI can be a symlink into a global installation.
  const base = process.argv[1]
    ? pathToFileURL(await realpath(process.argv[1])).href
    : import.meta.url;
  const manifestPath = findPackageJSON("@earendil-works/pi-coding-agent", base);
  if (!manifestPath)
    throw new Error("Cannot locate the host Pi SDK. Use the Node.js Pi installation.");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  return join(dirname(manifestPath), manifest.main);
}

export function registerBenchmarkCommand(pi: ExtensionAPI) {
  let starting = false;
  let active: { controller: AbortController; done: Promise<void> } | undefined;
  const show = (content: string) =>
    pi.sendMessage(
      { customType: "nebius-benchmark", content, display: true },
      { triggerTurn: false },
    );
  pi.registerCommand("nebius-benchmark", {
    description: "Compare models on your prompt: --models ID,ID --runs N; help or cancel",
    handler: async (args, ctx) => {
      const tokens = args.trim().split(/\s+/).filter(Boolean);
      const action = tokens[0];
      if (action === "help" || action === "list") {
        show(help);
        return;
      }
      if (action === "cancel") {
        if (active) {
          active.controller.abort();
          ctx.ui.notify("Stopping benchmark…", "info");
        } else ctx.ui.notify("No benchmark is running.", "info");
        return;
      }
      if (active || starting) {
        ctx.ui.notify("A benchmark is already running. Use /nebius-benchmark cancel.", "warning");
        return;
      }
      const key = process.env.NEBIUS_API_KEY?.trim();
      const redact = redactor([key ?? ""]);
      starting = true;
      let scratch: string | undefined;
      try {
        const { values } = parseArgs({
          args: tokens,
          options: {
            models: { type: "string" },
            runs: { type: "string" },
            task: { type: "string" },
          },
        });
        const runs = positive(Number(values.runs ?? 1), "runs", 1000);
        if (values.task && !tasks.includes(values.task)) throw new Error(help);
        let selected = ctx.model ? [ctx.model] : [];
        if (values.models !== undefined) {
          const ids = values.models.split(",");
          if (ids.some((id) => !id) || new Set(ids).size !== ids.length)
            throw new Error("--models requires unique, comma-separated model IDs.");
          const available = ctx.modelRegistry.getAll();
          selected = ids.map((id) => {
            const model = available.find(
              (candidate) => candidate.provider === "nebius" && candidate.id === id,
            );
            if (!model)
              throw new Error(`Unknown Nebius model: ${id}. Run /nebius-refresh or check /model.`);
            return model;
          });
        }
        if (
          !selected.length ||
          selected.some(
            (model) => model.provider !== "nebius" || model.api !== "openai-completions",
          )
        )
          throw new Error("Select a Nebius model with /model first.");
        const total = runs * selected.length;
        if (total > 10000) throw new Error("At most 10,000 runs per benchmark.");
        if (!key) throw new Error(MISSING_KEY);
        const piEntry = await hostPiEntry();
        let definition: BenchmarkDefinition;
        let directory: string;
        const task = values.task ?? "custom-prompt";
        if (values.task) {
          const root = fileURLToPath(new URL("../../", import.meta.url));
          ({ definition, directory } = await loadDefinition(join(root, "benchmarks", task)));
        } else {
          if (!ctx.hasUI)
            throw new Error("Custom prompts need interactive Pi. Use --task for a bundled task.");
          const prompt = await ctx.ui.editor("Benchmark task — what should each model do?");
          if (!prompt?.trim()) return;
          scratch = await mkdtemp(join(tmpdir(), "pi-nebius-project-"));
          directory = scratch;
          const copied = await snapshotProject(ctx.cwd, join(directory, "fixture"));
          await mkdir(join(directory, "validation"));
          definition = {
            schemaVersion: 1,
            name: task,
            task: prompt.trim(),
            fixture: "fixture",
            validationDirectory: "validation",
            validation: [],
            validationMode: "none",
            setup: [],
            timeout: 600,
            validationTimeout: 60,
            tools: ["read", "bash", "edit", "write", "grep", "find", "ls"],
          };
          ctx.ui.notify(
            `Copied ${copied} project files for comparison. Dependencies and ignored files are excluded.`,
            "info",
          );
        }
        // Snapshot selection; changing the interactive model does not change an active run.
        const models = structuredClone(selected) as NebiusModel[];
        let completed = 0;
        const output = join(ctx.cwd, "benchmark-results", `${task}-${randomUUID()}`);
        const controller = new AbortController();
        show(
          `Starting ${task}: ${models.map((model) => model.id).join(", ")}, ${runs} run(s) each. Uses paid inference; tools have normal host access.\nUse /nebius-benchmark cancel to stop.`,
        );
        ctx.ui.setStatus("nebius-benchmark", `Benchmark: ${task} (0/${total})`);
        const snapshot = scratch;
        scratch = undefined; // The background run owns cleanup from here.
        const done = runBenchmark({
          definition,
          directory,
          models,
          runs,
          concurrency: 1,
          output,
          apiKey: key,
          signal: controller.signal,
          piEntry,
          workerPath: fileURLToPath(
            new URL(
              import.meta.url.endsWith(".ts") ? "./host-worker.ts" : "./host-worker.js",
              import.meta.url,
            ),
          ),
          workerArgs: [piEntry],
          onRun: (run) => {
            ctx.ui.setStatus("nebius-benchmark", `Benchmark: ${task} (${++completed}/${total})`);
            ctx.ui.notify(
              `${run.model} #${run.run}: ${run.failure ?? (run.validation.checked ? "PASS" : "FINISHED (not validated)")}`,
              "info",
            );
          },
        })
          .then((results) => {
            show(redact(`${terminalReport(results)}\nDetails: ${join(output, "results.json")}`));
          })
          .catch((error) => {
            show(redact(`Benchmark failed: ${String(error)}`));
          })
          .finally(async () => {
            try {
              if (snapshot) await rm(snapshot, { recursive: true, force: true });
            } catch (error) {
              ctx.ui.notify(
                redact(`Could not remove temporary snapshot: ${String(error)}`),
                "warning",
              );
            } finally {
              active = undefined;
              ctx.ui.setStatus("nebius-benchmark", undefined);
            }
          });
        active = { controller, done };
      } catch (error) {
        ctx.ui.notify(redact(String(error)), "error");
      } finally {
        if (scratch) await rm(scratch, { recursive: true, force: true });
        starting = false;
      }
    },
  });
  pi.on("session_shutdown", async () => {
    active?.controller.abort();
    await active?.done;
  });
}
