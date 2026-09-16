import assert from "node:assert/strict";
import { test } from "node:test";
import type { Context } from "@earendil-works/pi-ai";
import { parseModels } from "../src/models.ts";
import { nebiusProvider } from "../src/provider.ts";
import { chunk, sse, usage } from "./helpers.ts";

function fixture(reasoning = false) {
  const [model] = parseModels({
    object: "list",
    data: [
      { id: "test/tool", supported_sampling_parameters: reasoning ? ["reasoning_effort"] : [] },
    ],
  });
  assert.ok(model);
  return { model, provider: nebiusProvider([model]) };
}
const context: Context = {
  systemPrompt: "You are helpful.",
  messages: [{ role: "user", content: "hello", timestamp: 1 }],
};

test("Pi adapter streams text, sends system role, temperature/max tokens, and accounts usage", async () => {
  const { model, provider } = fixture();
  let body: Record<string, unknown> = {};
  const fetcher: typeof fetch = async (_url, init) => {
    body = JSON.parse(String(init?.body));
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-key");
    return new Response(sse([chunk({ content: "Hel" }), chunk({ content: "lo" }, "stop"), usage]), {
      headers: { "Content-Type": "text/event-stream" },
    });
  };
  const stream = provider.streamSimple(model, context, {
    apiKey: "test-key",
    fetch: fetcher,
    temperature: 0.2,
    maxTokens: 100,
    maxRetries: 0,
  });
  const events = [];
  for await (const event of stream) events.push(event.type);
  const result = await stream.result();
  assert.ok(events.includes("text_delta"));
  assert.equal(result.stopReason, "stop");
  assert.deepEqual(result.content, [{ type: "text", text: "Hello" }]);
  assert.equal(result.usage.input, 20);
  assert.equal(result.usage.output, 10);
  assert.equal(result.usage.totalTokens, 30);
  assert.equal(body.temperature, 0.2);
  assert.equal(body.max_tokens, 100);
  assert.equal(body.stream, true);
  assert.equal(body.store, undefined);
  assert.equal(body.reasoning_effort, undefined);
  assert.deepEqual(body.stream_options, { include_usage: true });
  assert.equal((body.messages as Array<{ role: string }>)[0]?.role, "system");
});

test("Pi adapter handles reasoning deltas, replay, and advertised reasoning effort", async () => {
  const { model, provider } = fixture(true);
  let body: Record<string, unknown> = {};
  const fetcher: typeof fetch = async (_url, init) => {
    body = JSON.parse(String(init?.body));
    return new Response(
      sse([chunk({ reasoning_content: "Thinking." }), chunk({ content: "Answer" }, "stop")]),
    );
  };
  const result = await provider
    .streamSimple(model, context, {
      apiKey: "test",
      fetch: fetcher,
      reasoning: "high",
      maxRetries: 0,
    })
    .result();
  assert.equal(body.reasoning_effort, "high");
  assert.ok(
    result.content.some((block) => block.type === "thinking" && block.thinking === "Thinking."),
  );
  await provider
    .streamSimple(
      model,
      {
        ...context,
        messages: [
          ...context.messages,
          result,
          { role: "user", content: "Continue", timestamp: 2 },
        ],
      },
      { apiKey: "test", fetch: fetcher },
    )
    .result();
  const messages = body.messages as Array<{ role: string; reasoning_content?: string }>;
  assert.equal(
    messages.find((message) => message.role === "assistant")?.reasoning_content,
    "Thinking.",
  );
});

test("Pi adapter maps length and tool stop conditions", async () => {
  const { model, provider } = fixture();
  for (const [finish, expected] of [
    ["length", "length"],
    ["tool_calls", "toolUse"],
  ]) {
    const result = await provider
      .streamSimple(model, context, {
        apiKey: "test",
        fetch: async () => new Response(sse([chunk({ content: "text" }, finish)])),
      })
      .result();
    assert.equal(result.stopReason, expected);
  }
});

test("Pi adapter surfaces HTTP errors and server retry delays", async () => {
  const { model, provider } = fixture();
  for (const status of [401, 404, 429, 500, 503]) {
    const result = await provider
      .streamSimple(model, context, {
        apiKey: "test",
        maxRetries: 0,
        fetch: async () =>
          Response.json(
            { error: { message: "model unavailable or request rejected" } },
            { status, headers: { "Retry-After": "120" } },
          ),
      })
      .result();
    assert.equal(result.stopReason, "error");
    assert.match(result.errorMessage ?? "", new RegExp(`${status}`));
    assert.match(result.errorMessage ?? "", /retry-after: 120/);
    assert.match(result.errorMessage ?? "", /model unavailable or request rejected/);
  }
});

test("Pi adapter forwards cancellation to fetch and terminates as aborted", async () => {
  const { model, provider } = fixture();
  const controller = new AbortController();
  const fetcher: typeof fetch = async (_url, init) => {
    assert.ok(init?.signal);
    controller.abort();
    init.signal.throwIfAborted();
    throw new Error("abort not propagated");
  };
  const result = await provider
    .streamSimple(model, context, {
      apiKey: "test",
      fetch: fetcher,
      signal: controller.signal,
      maxRetries: 0,
    })
    .result();
  assert.equal(result.stopReason, "aborted");
});
