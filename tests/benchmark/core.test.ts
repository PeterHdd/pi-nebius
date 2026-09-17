import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { loadDefinition, parseDefinition } from "../../src/benchmark/definition.ts";
import { Instrumentation, redactor, reportedUsage } from "../../src/benchmark/instrumentation.ts";
import {
  aggregate,
  distribution,
  intervalDuration,
  tokenTotals,
} from "../../src/benchmark/metrics.ts";
import { runCommand } from "../../src/benchmark/process.ts";
import { classifyFailure } from "../../src/benchmark/runner.ts";
import type { RequestTrace, RunResult } from "../../src/benchmark/types.ts";
import { copyTree, hashTree } from "../../src/benchmark/workspace.ts";

const definition = "name: sample\ntask: Fix it\nvalidation:\n  - npm test\n";
function request(input: number, output: number, cached: number | null = null): RequestTrace {
  return {
    request: 1,
    purpose: "agent",
    startedAtMs: 0,
    endedAtMs: 10,
    firstContentAtMs: 2,
    status: 200,
    requestId: null,
    servedModel: null,
    systemFingerprint: null,
    finishReason: "stop",
    usage: {
      inputTokens: input,
      outputTokens: output,
      cachedInputTokens: cached,
      reasoningTokens: null,
      totalTokens: input + output,
    },
    error: null,
    streamComplete: true,
  };
}

test("definition parsing accepts YAML/JSON, rejects typos, aliases and invalid commands", () => {
  const parsed = parseDefinition(definition);
  assert.equal(parsed.timeout, 600);
  assert.deepEqual(parsed.validation, [{ command: "/bin/sh", args: ["-c", "npm test"] }]);
  assert.deepEqual(parseDefinition(JSON.stringify(parsed)), parsed);
  for (const extra of [
    "timeout: -1",
    "unknown: true",
    "fixture: ../elsewhere",
    "tools: [bad]",
    "timeout: 1.5",
    "validation: []",
    "schemaVersion: 2",
  ]) {
    assert.throws(() => parseDefinition(`${definition}${extra}\n`));
  }
  assert.throws(() => parseDefinition("name: &a [x]\ntask: *a\nvalidation: []"));
  assert.throws(() => parseDefinition(`${definition}name: duplicate`));
});

test("definition rejects aliased and nested validation directories", async () => {
  const root = await mkdtemp(join(tmpdir(), "bench-paths-"));
  try {
    await mkdir(join(root, "fixture/nested"), { recursive: true });
    await symlink(join(root, "fixture"), join(root, "alias"));
    for (const path of ["./fixture", "alias", "fixture/nested"]) {
      await writeFile(join(root, "benchmark.yaml"), `${definition}validationDirectory: ${path}\n`);
      await assert.rejects(loadDefinition(root), /must not overlap/);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cumulative usage sums every request, never substitutes the final prompt", () => {
  const requests = [
    request(4200, 800),
    request(9100, 1200),
    request(17300, 1100),
    request(29400, 2000),
  ];
  const totals = tokenTotals(requests);
  assert.equal(totals.cumulativeInputTokens, 60000);
  assert.equal(totals.cumulativeOutputTokens, 5100);
  assert.equal(totals.lastRequestInputTokens, 29400);
  assert.equal(totals.inputAmplificationVsLastRequest, 60000 / 29400);
  assert.equal(totals.finalContextSizeTokens, null);
  assert.equal(totals.cachedInputTokens, null);
  requests.push({ ...request(0, 0), usage: null });
  const incomplete = tokenTotals(requests);
  assert.equal(incomplete.cumulativeInputTokens, null);
  assert.equal(incomplete.observedInputTokens, 60000);
  assert.equal(incomplete.requestsWithUsage, 4);
  assert.equal(incomplete.usageComplete, false);
});

test("repeated-run summaries retain variance, failures, and unknown counts", () => {
  assert.deepEqual(distribution([2, null, 4]), {
    count: 2,
    missing: 1,
    mean: 3,
    median: 3,
    min: 2,
    max: 4,
    standardDeviation: 1,
  });
  const runs = [true, false, true].map((success, i) => ({
    model: "mock/model",
    success,
    wallTimeMs: 10 + i,
    tokens: { cumulativeInputTokens: 100 + i, cumulativeOutputTokens: 10 },
    agentTurns: 2,
    toolCalls: 1,
  })) as RunResult[];
  const [summary] = aggregate(runs);
  assert.equal(summary?.successRate, 2 / 3);
  assert.equal(summary?.inputTokens.mean, 101);
  assert.equal(
    intervalDuration([
      { startedAtMs: 0, endedAtMs: 10 },
      { startedAtMs: 5, endedAtMs: 15 },
    ]),
    15,
  );
});

test("workspace copies do not share files; hashes are reproducible; links are rejected", async () => {
  const root = await mkdtemp(join(tmpdir(), "bench-isolation-"));
  try {
    const fixture = resolve("benchmarks/fix-auth-bug/fixture");
    await copyTree(fixture, join(root, "a"));
    await copyTree(fixture, join(root, "b"));
    const original = await hashTree(fixture);
    assert.equal(await hashTree(join(root, "a")), original);
    await writeFile(join(root, "a/auth.mjs"), "changed");
    assert.equal(await hashTree(join(root, "b")), original);
    assert.equal(await hashTree(fixture), original);
    await symlink(join(root, "b/auth.mjs"), join(root, "a/link"));
    await assert.rejects(copyTree(join(root, "a"), join(root, "c")), /links\/special/);
    await symlink(join(root, "b"), join(root, "root-link"));
    await assert.rejects(copyTree(join(root, "root-link"), join(root, "d")), /symbolic link/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Pi event instrumentation distinguishes requested tools, execution errors and turn count", () => {
  let clock = 0;
  const observer = new Instrumentation(undefined, () => clock, redactor(["fake-secret"]));
  observer.onEvent({ type: "agent_start" });
  observer.onEvent({ type: "turn_start", turnIndex: 0, timestamp: 0 } as AgentSessionEvent);
  observer.onEvent({
    type: "message_end",
    message: {
      role: "assistant",
      stopReason: "toolUse",
      api: "openai-completions",
      provider: "nebius",
      model: "test",
      timestamp: 0,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      content: [{ type: "toolCall", id: "a", name: "write", arguments: { content: "not stored" } }],
    },
  } as AgentSessionEvent);
  observer.onEvent({ type: "tool_execution_start", toolCallId: "a", toolName: "write", args: {} });
  clock = 20;
  observer.onEvent({
    type: "tool_execution_end",
    toolCallId: "a",
    toolName: "write",
    result: {},
    isError: true,
  });
  observer.onEvent({
    type: "message_end",
    message: {
      role: "toolResult",
      toolCallId: "a",
      toolName: "write",
      isError: true,
      content: [{ type: "text", text: "fake-secret failed" }],
    },
  } as AgentSessionEvent);
  observer.onEvent({ type: "agent_settled" });
  assert.equal(observer.state.agentTurns, 1);
  assert.equal(observer.state.toolCalls, 1);
  assert.deepEqual(observer.state.toolCallsByType, { write: 1 });
  assert.equal(observer.state.tools[0]?.endedAtMs, 20);
  assert.equal(observer.state.tools[0]?.isError, true);
  assert.doesNotMatch(JSON.stringify(observer.state), /fake-secret|not stored/);
  assert.deepEqual(JSON.parse(JSON.stringify(observer.state)), observer.state);
});

test("HTTP observer preserves byte-for-byte SSE and captures fragmented usage without counting snapshots twice", async () => {
  const payload = [
    {
      model: "served/id",
      system_fingerprint: "fp-test",
      choices: [{ delta: { content: "Hello 😀" }, finish_reason: null }],
    },
    { usage: { prompt_tokens: 40, completion_tokens: 3 }, choices: [] },
    {
      usage: {
        prompt_tokens: 50,
        completion_tokens: 5,
        prompt_tokens_details: { cached_tokens: 10 },
        completion_tokens_details: { reasoning_tokens: 2 },
      },
      choices: [],
    },
  ];
  const text = `${payload.map((item) => `data: ${JSON.stringify(item)}\r\n\r\n`).join("")}data: [DONE]\r\n\r\n`;
  const bytes = new TextEncoder().encode(text);
  let at = 0;
  const response = new Response(
    new ReadableStream({
      pull(controller) {
        if (at === bytes.length) {
          controller.close();
          return;
        }
        controller.enqueue(bytes.slice(at, ++at));
      },
    }),
  );
  const observer = new Instrumentation();
  const wrapped = await observer.observeFetch(async () => response)(
    "https://api.tokenfactory.nebius.com/v1/chat/completions",
  );
  assert.equal(await wrapped.text(), text);
  assert.equal(observer.state.requests.length, 1);
  assert.equal(observer.state.requests[0]?.usage?.inputTokens, 50);
  assert.equal(observer.state.requests[0]?.usage?.reasoningTokens, 2);
  assert.equal(observer.state.requests[0]?.systemFingerprint, "fp-test");
  assert.equal(observer.state.requests[0]?.streamComplete, true);
  assert.equal(tokenTotals(observer.state.requests).cumulativeInputTokens, 50);
  assert.doesNotMatch(JSON.stringify(observer.state), /Hello/);
  assert.equal(reportedUsage({ prompt_tokens: 1, completion_tokens: 2 })?.reasoningTokens, null);
});

test("validation captures exit codes/output, enforces deadlines and omits API keys from subprocess environments", async () => {
  const result = await runCommand(
    {
      command: process.execPath,
      args: ["-e", 'console.log(process.env.NEBIUS_API_KEY ?? "absent"); process.exit(3)'],
    },
    process.cwd(),
    2000,
  );
  assert.equal(result.exitCode, 3);
  assert.match(result.output, /absent/);
  const timed = await runCommand(
    { command: process.execPath, args: ["-e", "setInterval(() => {}, 1000)"] },
    process.cwd(),
    50,
  );
  assert.equal(timed.timedOut, true);
  assert.equal(timed.exitCode, null);
  const missing = await runCommand({ command: "/not/a/command", args: [] }, process.cwd(), 1000);
  assert.equal(missing.exitCode, null);
  assert.match(missing.output, /ENOENT/);
});

test("failure classification gives cancellation/timeouts priority and preserves distinct API/context causes", () => {
  assert.equal(classifyFailure({ timedOut: true, error: "429" }), "timeout");
  assert.equal(classifyFailure({ cancelled: true, timedOut: true }), "cancelled");
  assert.equal(classifyFailure({ error: "context_length_exceeded" }), "context_limit");
  assert.equal(classifyFailure({ error: "HTTP 429" }), "rate_limit");
  assert.equal(classifyFailure({ error: "HTTP 500" }), "model_api_error");
  assert.equal(classifyFailure({ validated: false }), "validation_failed");
  assert.equal(classifyFailure({ validated: false, toolErrors: 2 }), "tool_error");
  assert.equal(classifyFailure({ validated: true, toolErrors: 2 }), null);
});
