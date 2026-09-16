// Test-only model transport. Everything else, including Pi tools, is real.
import { readFileSync } from "node:fs";
import "../../dist/benchmark/worker.js";

const solutions = JSON.parse(readFileSync(new URL("./solutions.json", import.meta.url), "utf8"));
let input;
let calls = 0;
process.on("message", (message) => {
  if (message && typeof message === "object" && message.definition) input = message;
});
globalThis.fetch = async (url, init) => {
  if (!String(url).endsWith("/chat/completions"))
    throw new Error("Unexpected HTTP endpoint in test");
  if (process.env.NEBIUS_API_KEY) throw new Error("Key leaked into tool environment");
  if (new Headers(init.headers).get("authorization") !== `Bearer ${input.apiKey}`)
    throw new Error("Missing ephemeral credential");
  const payload = JSON.parse(init.body);
  calls++;
  if (payload.model === "mock/timeout")
    return new Promise((_resolve, reject) => {
      if (init.signal.aborted) reject(new DOMException("aborted", "AbortError"));
      else
        init.signal.addEventListener(
          "abort",
          () => reject(new DOMException("aborted", "AbortError")),
          { once: true },
        );
    });
  if (payload.model === "mock/error")
    return Response.json({ error: { message: `401 rejected ${input.apiKey}` } }, { status: 401 });
  const files = solutions[input.definition.name];
  const delta =
    calls === 1 && payload.model !== "mock/fail"
      ? {
          tool_calls: Object.entries(files).map(([path, content], index) => ({
            index,
            id: `call_${index}`,
            type: "function",
            function: { name: "write", arguments: JSON.stringify({ path, content }) },
          })),
        }
      : { content: "Completed." };
  const finish = delta.tool_calls ? "tool_calls" : "stop";
  const usage = {
    prompt_tokens: calls === 1 ? 100 : 220,
    completion_tokens: calls === 1 ? 40 : 20,
    total_tokens: calls === 1 ? 140 : 240,
    prompt_tokens_details: { cached_tokens: calls === 1 ? 20 : 30 },
    completion_tokens_details: { reasoning_tokens: calls === 1 ? 5 : 2 },
  };
  const chunks = [
    {
      id: `test-${calls}`,
      object: "chat.completion.chunk",
      model: payload.model,
      choices: [{ index: 0, delta, finish_reason: finish }],
    },
    { choices: [], usage },
  ];
  return new Response(
    `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`,
    { headers: { "content-type": "text/event-stream" } },
  );
};
