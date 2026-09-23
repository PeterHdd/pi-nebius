import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { observeContext, textSize } from "../../src/benchmark/context-observation.ts";
import { Instrumentation } from "../../src/benchmark/instrumentation.ts";
import { tokenTotals } from "../../src/benchmark/metrics.ts";
import { requestReport } from "../../src/benchmark/request-report.ts";
import type { RunResult } from "../../src/benchmark/types.ts";

const emit = (observer: Instrumentation, event: unknown) =>
  observer.onEvent(event as AgentSessionEvent);
const finish = (observer: Instrumentation, id: string, text: string) =>
  emit(observer, {
    type: "message_end",
    message: {
      role: "toolResult",
      toolCallId: id,
      toolName: "bash",
      isError: false,
      content: [{ type: "text", text }],
    },
  });

test("context attribution measures UTF-8 JSON bytes and never invents tokens", () => {
  const messages = [
    { role: "system", content: "rules" },
    { role: "user", content: "秘密" },
    { role: "assistant", content: "thought" },
    { role: "tool", tool_call_id: "t1", content: "one\ntwo\n" },
    { role: "unknown", content: "other" },
  ];
  const tools = [{ type: "function", function: { name: "bash" } }];
  const observed = observeContext(JSON.stringify({ messages, tools }));
  assert.ok(observed);
  assert.equal(observed.bytes.user, Buffer.byteLength(JSON.stringify(messages[1])));
  assert.equal(observed.bytes.tools, Buffer.byteLength(JSON.stringify(tools)));
  assert.deepEqual(observed.toolResults, [{ id: "t1", bytes: 8, lines: 2 }]);
  assert.equal(
    Object.values(observed.bytes).reduce((a, b) => a + b, 0),
    messages.reduce((a, message) => a + Buffer.byteLength(JSON.stringify(message)), 0) +
      Buffer.byteLength(JSON.stringify(tools)),
  );
  assert.doesNotMatch(JSON.stringify(observed), /秘密|thought|rules/);
  assert.equal(observeContext("broken"), null);
  assert.equal(observeContext(undefined), null);
  assert.deepEqual(
    textSize([
      { type: "image", data: "123" },
      { type: "text", text: "é\n" },
    ]),
    { bytes: 3, lines: 1 },
  );
});

test("traces link tool results to requests, preserve transport, and distinguish repeated arguments from repeated output", async () => {
  const observer = new Instrumentation();
  let expectedBody = "";
  const responseBody =
    'data: {"usage":{"prompt_tokens":100,"completion_tokens":10},"choices":[]}\n\ndata: [DONE]\n\n';
  const fetcher = observer.observeFetch(async (_url, init) => {
    assert.equal(init?.body, expectedBody);
    return new Response(responseBody);
  });
  async function request(messages: unknown[]) {
    expectedBody = JSON.stringify({ messages });
    const response = await fetcher("https://example.test/v1/chat/completions", {
      method: "POST",
      body: expectedBody,
    });
    assert.equal(await response.text(), responseBody);
  }
  await request([{ role: "user", content: "task" }]);
  emit(observer, {
    type: "message_end",
    message: {
      role: "assistant",
      content: [
        {
          type: "toolCall",
          id: "t1",
          name: "bash",
          arguments: { command: "private-command", timeout: 10 },
        },
      ],
      stopReason: "toolUse",
    },
  });
  emit(observer, {
    type: "tool_execution_start",
    toolCallId: "t1",
    toolName: "bash",
    args: { command: "private-command", timeout: 10 },
  });
  finish(observer, "t1", "private-output");
  const toolMessage = { role: "tool", tool_call_id: "t1", content: "private-output" };
  await request([toolMessage]);
  await request([toolMessage]); // Repeated HTTP attempt still counts as an inclusion.
  for (const [id, output] of [
    ["t2", "private-output"],
    ["t3", "changed-output"],
  ]) {
    emit(observer, {
      type: "tool_execution_start",
      toolCallId: id,
      toolName: "bash",
      args: { timeout: 10, command: "private-command" },
    });
    assert.ok(id);
    assert.ok(output);
    finish(observer, id, output);
  }
  assert.equal(observer.state.tools[0]?.request, 1);
  assert.equal(observer.state.tools[1]?.repeatedArgumentsOf, "t1");
  assert.equal(observer.state.tools[1]?.repeatedOutputOf, "t1");
  assert.equal(observer.state.tools[2]?.repeatedArgumentsOf, "t1");
  assert.equal(observer.state.tools[2]?.repeatedOutputOf, null);
  assert.equal(
    observer.state.requests.filter((r) => r.context?.toolResults.some((t) => t.id === "t1")).length,
    2,
  );
  assert.doesNotMatch(
    JSON.stringify(observer.state),
    /private-command|private-output|changed-output/,
  );
  const run = {
    model: "mock",
    run: 1,
    success: true,
    failure: null,
    validation: { checked: true },
    tokens: tokenTotals(observer.state.requests),
    observation: observer.state,
  } as RunResult;
  const report = requestReport(run).join("\n");
  assert.match(report, /Tokens to validated solution: 330/);
  assert.match(report, /input amplification: 3.00x/);
  assert.match(report, /2, 3/);
  assert.match(report, /NOT token attribution/);
  run.success = false;
  run.failure = "validation_failed";
  assert.match(requestReport(run).join("\n"), /Tokens consumed before failure: 330/);
  const first = run.observation.requests[0];
  assert.ok(first);
  first.usage = null;
  run.tokens = tokenTotals(run.observation.requests);
  assert.match(requestReport(run).join("\n"), /Tokens consumed before failure: n\/a/);
});

test("stream-bodied requests are not consumed and missing attribution remains unavailable", async () => {
  const observer = new Instrumentation();
  const request = new Request("https://example.test/v1/chat/completions", {
    method: "POST",
    body: "original",
  });
  const response = await observer.observeFetch(async (input) => {
    assert.equal(await (input as Request).text(), "original");
    return new Response("data: [DONE]\n\n");
  })(request);
  await response.text();
  assert.equal(observer.state.requests[0]?.context, null);
  assert.equal(observer.state.requests[0]?.usage, null);
});
