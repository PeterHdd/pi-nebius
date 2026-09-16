import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Explicit opt-in, paid inference; never part of npm test.
assert.ok(
  process.env.NEBIUS_API_KEY?.trim(),
  'Set export NEBIUS_API_KEY="..." before the live test.',
);
assert.ok(
  process.env.NEBIUS_MODEL,
  "Set NEBIUS_MODEL to an exact discovered, tool-capable model ID.",
);
const root = resolve(import.meta.dirname, "..");
const dir = await mkdtemp(join(tmpdir(), "pi-nebius-live-"));
try {
  const child = spawn(
    process.execPath,
    [
      join(root, "node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js"),
      "--no-extensions",
      "-e",
      root,
      "--no-skills",
      "--no-prompt-templates",
      "--no-themes",
      "--no-session",
      "--provider",
      "nebius",
      "--model",
      process.env.NEBIUS_MODEL,
      "--tools",
      "write",
      "--mode",
      "json",
      "-p",
      "Use the write tool to create nebius-test.txt containing exactly Hello from Nebius (no newline), then confirm completion.",
    ],
    {
      cwd: dir,
      timeout: 180000,
      env: {
        PATH: process.env.PATH,
        PI_CODING_AGENT_DIR: join(dir, "agent"),
        NEBIUS_API_KEY: process.env.NEBIUS_API_KEY,
      },
    },
  );
  child.stdin.end();
  let stdout = "";
  child.stdout.on("data", (data) => {
    stdout += data;
  });
  // Forward diagnostics but never echo the key, even if an upstream error does.
  child.stderr.on("data", (data) => {
    process.stderr.write(
      String(data)
        .split(process.env.NEBIUS_API_KEY ?? "")
        .join("[redacted]"),
    );
  });
  const code = await new Promise<number | null>((resolveExit, reject) => {
    child.on("error", reject);
    child.on("close", resolveExit);
  });
  assert.equal(code, 0, "Pi live run failed or timed out.");
  const events = stdout
    .split("\n")
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line));
  assert.ok(
    events.some(
      (event) =>
        event.type === "tool_execution_end" && event.toolName === "write" && !event.isError,
    ),
    "No successful write-tool execution was recorded.",
  );
  assert.ok(
    events.some(
      (event) =>
        event.type === "message_end" &&
        event.message?.role === "assistant" &&
        event.message.stopReason === "stop",
    ),
    "Model did not complete the turn after the tool result.",
  );
  assert.equal(await readFile(join(dir, "nebius-test.txt"), "utf8"), "Hello from Nebius");
  console.log(
    `PASS: ${process.env.NEBIUS_MODEL} completed Pi's write-tool loop on Nebius Token Factory.`,
  );
} finally {
  await rm(dir, { recursive: true, force: true });
}
