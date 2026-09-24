import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Client-observed request timing, separate from tool execution and benchmark runs. */
export function registerResponseStats(pi: ExtensionAPI, now = () => performance.now()) {
  const key = "nebius-response";
  let timing: { started: number; firstContent?: number } | undefined;

  pi.on("session_start", (_event, ctx) => {
    timing = undefined;
    if (ctx.hasUI) ctx.ui.setStatus(key, undefined);
  });
  pi.on("model_select", (_event, ctx) => {
    timing = undefined;
    if (ctx.hasUI) ctx.ui.setStatus(key, undefined);
  });
  pi.on("before_provider_request", (_event, ctx) => {
    timing = ctx.hasUI && ctx.model?.provider === "nebius" ? { started: now() } : undefined;
    if (ctx.hasUI) ctx.ui.setStatus(key, undefined);
  });
  pi.on("message_update", (event) => {
    if (!timing || timing.firstContent !== undefined || event.message.role !== "assistant") return;
    if (event.message.provider !== "nebius") return;
    const delta = event.assistantMessageEvent;
    if (
      (delta.type === "text_delta" ||
        delta.type === "thinking_delta" ||
        delta.type === "toolcall_delta") &&
      delta.delta.length > 0
    ) {
      timing.firstContent = now();
    } else if (delta.type === "toolcall_start") {
      const content = delta.partial.content[delta.contentIndex];
      if (content?.type === "toolCall" && content.name) timing.firstContent = now();
    }
  });
  pi.on("message_end", (event, ctx) => {
    const message = event.message;
    if (message.role !== "assistant") return;
    const current = timing;
    timing = undefined;
    if (!current || !ctx.hasUI || message.provider !== "nebius") return;
    const seconds = (ms: number) => `${(Math.max(0, ms) / 1000).toFixed(1)}s`;
    const first =
      current.firstContent === undefined ? "n/a" : seconds(current.firstContent - current.started);
    const parts = [
      `Nebius · First content: ${first}`,
      `Response: ${seconds(now() - current.started)}`,
    ];
    if (message.stopReason === "error" || message.stopReason === "aborted") {
      parts.push(message.stopReason === "error" ? "Failed" : "Aborted");
    } else {
      const output = message.usage?.output;
      parts.push(`Output: ${Number.isFinite(output) && output >= 0 ? output : "n/a"} tokens`);
    }
    ctx.ui.setStatus(key, parts.join(" · "));
  });
}
