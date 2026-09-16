import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";

// Reproduce Pi's Git install in a clean directory, without build output or dev tools.
const scratch = await mkdtemp(join(tmpdir(), "pi-nebius-install-"));
const oldKey = process.env.NEBIUS_API_KEY;
const oldDir = process.env.PI_CODING_AGENT_DIR;
const oldFetch = globalThis.fetch;
const server = createServer((_req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.end(
    `data: ${JSON.stringify({
      id: "install-check",
      object: "chat.completion.chunk",
      model: "test/install",
      choices: [{ index: 0, delta: { content: "Done." }, finish_reason: "stop" }],
      usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 },
    })}\n\ndata: [DONE]\n\n`,
  );
});
try {
  for (const path of [
    "package.json",
    "package-lock.json",
    "src",
    "benchmarks",
    "tsconfig.json",
    "tsconfig.build.json",
  ])
    await cp(path, join(scratch, path), { recursive: true });
  execFileSync("npm", ["install", "--omit=dev", "--no-audit", "--no-fund"], {
    cwd: scratch,
    stdio: "inherit",
  });
  await assert.rejects(stat(join(scratch, "node_modules/typescript")), { code: "ENOENT" });
  await assert.rejects(stat(join(scratch, "dist")), { code: "ENOENT" });

  process.env.NEBIUS_API_KEY = "fake-install-check-key";
  process.env.PI_CODING_AGENT_DIR = join(scratch, "agent");
  globalThis.fetch = async () => Response.json({ object: "list", data: [{ id: "test/install" }] });
  const loader = new DefaultResourceLoader({
    cwd: scratch,
    agentDir: process.env.PI_CODING_AGENT_DIR,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    additionalExtensionPaths: [join(scratch, "src/index.ts")],
  });
  await loader.reload();
  const result = loader.getExtensions();
  assert.deepEqual(result.errors, []);
  assert.equal(result.extensions.length, 1);
  assert.ok(result.extensions[0].commands.has("nebius-refresh"));
  const command = result.extensions[0].commands.get("nebius-benchmark");
  assert.ok(command);
  assert.equal(result.runtime.pendingNativeProviderRegistrations.length, 1);
  assert.equal(
    result.runtime.pendingNativeProviderRegistrations[0].provider.getModels()[0].id,
    "test/install",
  );
  console.log("Production-only Git install and Pi extension loading passed without tsc or dist.");
  // Run the actual installed command and source worker against local scripted inference.
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const model = result.runtime.pendingNativeProviderRegistrations[0].provider.getModels()[0];
  model.baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  const messages = [];
  const notices = [];
  let finish;
  let completed = new Promise((resolve) => {
    finish = resolve;
  });
  result.runtime.sendMessage = (message) => {
    messages.push(message.content);
  };
  const ctx = {
    cwd: scratch,
    model,
    modelRegistry: { getAll: () => [model, { ...model, id: "test/second" }] },
    ui: {
      notify: (message) => {
        notices.push(message);
      },
      setStatus: (_key, value) => {
        if (value === undefined) finish();
      },
    },
  };
  await command.handler("help", ctx);
  assert.match(messages.pop(), /Usage: \/nebius-benchmark/);
  await command.handler("--runs 0", ctx);
  assert.match(notices.pop(), /runs must/);
  await command.handler("", { ...ctx, model: undefined });
  assert.match(notices.pop(), /Select a Nebius model/);
  await command.handler("--task fix-auth-bug --runs 2 --models test/install,test/second", ctx);
  await command.handler("--task fix-auth-bug", ctx);
  assert.match(notices.pop(), /already running/);
  let timer;
  try {
    await Promise.race([
      completed,
      new Promise((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(`Benchmark command timed out: ${JSON.stringify({ messages, notices })}`),
            ),
          30000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
  const report = messages.at(-1);
  assert.match(report, /Completed: 4\/4/);
  const results = JSON.parse(await readFile(report.split("Details: ")[1], "utf8"));
  assert.equal(results.aggregates.length, 2);
  assert.deepEqual(
    results.runs.map((run) => run.model),
    ["test/install", "test/second", "test/install", "test/second"],
  );
  assert.equal(
    results.runs[0].failure,
    "validation_failed",
    JSON.stringify(results.runs[0].errors),
  );
  assert.equal(results.runs[0].tokens.cumulativeInputTokens, 100);
  assert.equal(results.runs[0].tokens.cumulativeOutputTokens, 10);
  assert.doesNotMatch(JSON.stringify(results), /fake-install-check-key/);
  const project = join(scratch, "user-project");
  await mkdir(project);
  execFileSync("git", ["init", "--quiet"], { cwd: project });
  await writeFile(join(project, ".gitignore"), "ignored.txt\n");
  await writeFile(join(project, "ignored.txt"), "Ignored project file");
  await writeFile(join(project, "notes.txt"), "Original project content");
  await writeFile(join(project, ".env"), "PRIVATE_KEY=do-not-copy");
  const prompt = "Explain the files in this project without editing them.";
  completed = new Promise((resolve) => {
    finish = resolve;
  });
  await command.handler("--models test/install,test/second", {
    ...ctx,
    cwd: project,
    hasUI: true,
    ui: { ...ctx.ui, editor: async () => prompt },
  });
  try {
    await Promise.race([
      completed,
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Custom prompt benchmark timed out")), 30000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
  const customReport = messages.at(-1);
  assert.match(customReport, /Correctness: not checked/);
  assert.match(customReport, /Completed: 2\/2/);
  const customResults = JSON.parse(await readFile(customReport.split("Details: ")[1], "utf8"));
  assert.equal(customResults.definition.task, prompt);
  assert.equal(customResults.aggregates[0].successRate, null);
  for (const run of customResults.runs) {
    assert.equal(run.failure, null, JSON.stringify(run.errors));
    assert.equal(run.validation.checked, false);
    assert.equal(
      await readFile(join(run.workspace, "notes.txt"), "utf8"),
      "Original project content",
    );
    await assert.rejects(stat(join(run.workspace, ".env")), { code: "ENOENT" });
    await assert.rejects(stat(join(run.workspace, "ignored.txt")), { code: "ENOENT" });
  }
  assert.equal(await readFile(join(project, "notes.txt"), "utf8"), "Original project content");
  completed = new Promise((resolve) => {
    finish = resolve;
  });
  await command.handler("--task fix-auth-bug --runs 3", ctx);
  await command.handler("cancel", ctx);
  try {
    await Promise.race([
      completed,
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Benchmark cancellation timed out")), 10000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
  assert.match(messages.at(-1), /\(cancelled\)/);
  console.log(
    "Installed /nebius-benchmark command completed real Pi inference, validation, and in-session reporting.",
  );
} finally {
  server.closeAllConnections();
  server.close();
  globalThis.fetch = oldFetch;
  if (oldKey === undefined) delete process.env.NEBIUS_API_KEY;
  else process.env.NEBIUS_API_KEY = oldKey;
  if (oldDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = oldDir;
  await rm(scratch, { recursive: true, force: true });
}
