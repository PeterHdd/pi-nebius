export function sse(chunks: unknown[]): string {
  return `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`;
}
export function chunk(delta: unknown, finish: string | null = null) {
  return {
    id: "completion-test",
    object: "chat.completion.chunk",
    created: 1,
    model: "test/tool",
    choices: [{ index: 0, delta, finish_reason: finish }],
  };
}
export const usage = {
  choices: [],
  usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
};
