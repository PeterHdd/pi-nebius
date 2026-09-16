import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { chunk, sse, usage } from "./helpers.ts";

const root = resolve(import.meta.dirname, "..");
test("real Pi CLI discovers models before selection and completes write-tool loop over HTTP", {
  timeout: 60000,
}, async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-nebius-cli-"));
  const requests: Array<Record<string, unknown>> = [];
  let discoveryCalls = 0;
  let inferenceStatus = 200;
  const server = createServer(async (req, res) => {
    try {
      assert.equal(req.headers.authorization, "Bearer fake-cli-key");
      if (req.url === "/v1/models?verbose=true") {
        discoveryCalls++;
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({ object: "list", data: [{ id: "test/tool", context_length: 32768 }] }),
        );
        return;
      }
      assert.equal(req.url, "/v1/chat/completions");
      let data = "";
      for await (const part of req) data += part;
      const body = JSON.parse(data);
      requests.push(body);
      if (inferenceStatus !== 200) {
        res.writeHead(inferenceStatus, {
          "Content-Type": "application/json",
          "Retry-After": "120",
        });
        res.end(JSON.stringify({ error: { message: "model not found" } }));
        return;
      }
      res.setHeader("Content-Type", "text/event-stream");
      if (requests.length === 1) {
        res.end(
          sse([
            chunk({
              tool_calls: [
                {
                  index: 0,
                  id: "call_write",
                  type: "function",
                  function: { name: "write", arguments: '{"path":"nebius-test.txt",' },
                },
              ],
            }),
            chunk(
              {
                tool_calls: [
                  { index: 0, function: { arguments: '"content":"Hello from Nebius"}' } },
                ],
              },
              "tool_calls",
            ),
            usage,
          ]),
        );
      } else {
        res.end(sse([chunk({ content: "Created nebius-test.txt." }, "stop"), usage]));
      }
    } catch (error) {
      res.writeHead(500);
      res.end(String(error));
    }
  });
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const env = {
      PATH: process.env.PATH,
      PI_CODING_AGENT_DIR: join(dir, "agent"),
      NEBIUS_API_KEY: "fake-cli-key",
      PI_NEBIUS_TEST_SERVER: `http://127.0.0.1:${address.port}`,
    };
    const run = (args: string[]) =>
      new Promise<{ code: number | null; stdout: string; stderr: string }>((resolveRun, reject) => {
        const child = spawn(
          process.execPath,
          [
            "--import",
            join(root, "tests/mock-transport.mjs"),
            join(root, "node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js"),
            "--no-extensions",
            "-e",
            root,
            "--no-skills",
            "--no-prompt-templates",
            "--no-themes",
            ...args,
          ],
          { cwd: dir, env, timeout: 25000 },
        );
        child.stdin.end();
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (data) => {
          stdout += data;
        });
        child.stderr.on("data", (data) => {
          stderr += data;
        });
        child.on("error", reject);
        child.on("close", (code) => resolveRun({ code, stdout, stderr }));
      });
    const listed = await run(["--list-models", "nebius"]);
    assert.equal(listed.code, 0, listed.stderr);
    assert.match(
      listed.stdout,
      /test\/tool/,
      `stderr: ${listed.stderr}; discovery calls: ${discoveryCalls}`,
    );
    const result = await run([
      "--provider",
      "nebius",
      "--model",
      "test/tool",
      "--tools",
      "write",
      "--no-session",
      "--mode",
      "json",
      "-p",
      "Create a file called nebius-test.txt containing 'Hello from Nebius'.",
    ]);
    assert.equal(result.code, 0, `${result.stderr}\n${result.stdout}`);
    assert.equal(await readFile(join(dir, "nebius-test.txt"), "utf8"), "Hello from Nebius");
    assert.equal(discoveryCalls, 1, "second CLI startup must use the cache");
    assert.equal(requests.length, 2);
    const first = requests[0] as {
      tools: Array<{ function: { name: string } }>;
      messages: Array<{ role: string }>;
    };
    assert.ok(first.tools.some((tool) => tool.function.name === "write"));
    assert.equal(first.messages[0]?.role, "system");
    const second = requests[1] as { messages: Array<{ role: string; tool_call_id?: string }> };
    assert.ok(second.messages.some((message) => message.role === "assistant"));
    assert.ok(
      second.messages.some(
        (message) => message.role === "tool" && message.tool_call_id === "call_write",
      ),
    );
    assert.match(result.stdout, /tool_execution_end/);

    inferenceStatus = 404;
    const unavailable = await run([
      "--provider",
      "nebius",
      "--model",
      "test/tool",
      "--tools",
      "write",
      "--no-session",
      "--mode",
      "json",
      "-p",
      "Hello",
    ]);
    assert.match(unavailable.stdout, /Model unavailable/);
    assert.match(unavailable.stdout, /nebius-refresh/);
    assert.match(unavailable.stdout, /retry-after: 120/);
    assert.match(unavailable.stdout, /model not found/);

    const refreshed = await run([
      "--provider",
      "nebius",
      "--model",
      "test/tool",
      "--no-session",
      "-p",
      "/nebius-refresh",
    ]);
    assert.equal(refreshed.code, 0, refreshed.stderr);
    assert.equal(discoveryCalls, 2, "refresh command must bypass the fresh cache");

    // Native provider composition must preserve the documented models.json escape hatch.
    await writeFile(
      join(dir, "agent/models.json"),
      JSON.stringify({
        providers: {
          nebius: {
            models: [{ id: "offline/model", contextWindow: 65536, maxTokens: 8192 }],
            modelOverrides: { "test/tool": { contextWindow: 131072 } },
          },
        },
      }),
    );
    const overridden = await run(["--list-models", "nebius"]);
    assert.equal(overridden.code, 0, overridden.stderr);
    assert.match(overridden.stdout, /offline\/model/);
    assert.match(overridden.stdout, /test\/tool/);

    env.NEBIUS_API_KEY = "";
    const missingKey = await run(["--list-models", "nebius"]);
    assert.equal(missingKey.code, 0, "missing credentials must not crash Pi startup");
    assert.match(missingKey.stderr, /export NEBIUS_API_KEY/);
    assert.doesNotMatch(missingKey.stdout, /test\/tool/);
    assert.equal(discoveryCalls, 2, "missing credentials must not cause a network call");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    await rm(dir, { recursive: true, force: true });
  }
});
