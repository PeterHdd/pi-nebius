import { type ExtensionAPI, getAgentDir } from "@earendil-works/pi-coding-agent";
import { discoverModels, MISSING_KEY } from "./discovery.ts";
import { nebiusProvider } from "./provider.ts";

export default async function nebius(pi: ExtensionAPI) {
  let pending: Promise<Awaited<ReturnType<typeof discoverModels>>> | undefined;
  const initialize = (force = false) => {
    pending ??= discoverModels({
      apiKey: process.env.NEBIUS_API_KEY,
      agentDir: getAgentDir(),
      force,
    })
      .then((result) => {
        pi.registerProvider(nebiusProvider(result.models));
        return result;
      })
      .finally(() => {
        pending = undefined;
      });
    return pending;
  };
  const initial = await initialize();
  if (initial.warning) process.stderr.write(`${initial.warning}\n`);

  pi.on("session_start", async (_event, ctx) => {
    if (initial.warning && ctx.hasUI) ctx.ui.notify(initial.warning, "warning");
  });
  pi.registerCommand("nebius-refresh", {
    description: "Refresh the Nebius Token Factory model catalog",
    handler: async (_args, ctx) => {
      const result = await initialize(true);
      const message = result.warning ?? `Nebius: loaded ${result.models.length} models.`;
      if (ctx.hasUI) ctx.ui.notify(message, result.warning ? "warning" : "info");
      else process.stderr.write(`${message}\n`);
    },
  });
  pi.on("message_end", async (event) => {
    const message = event.message;
    if (
      message.role !== "assistant" ||
      message.provider !== "nebius" ||
      message.stopReason !== "error"
    )
      return;
    const original = message.errorMessage ?? "Unknown provider error";
    if (original.startsWith("Nebius Token Factory:")) return;
    const hint = /\b(?:401|403)\b/.test(original)
      ? "Token Factory rejected the credentials; check NEBIUS_API_KEY and project access."
      : /\b429\b|rate.?limit/i.test(original)
        ? "Rate limited; retry after the server's requested delay."
        : /\b404\b|model.*(?:not found|unavailable|does not exist)/i.test(original)
          ? "Model unavailable; run /nebius-refresh and select a current model with /model."
          : /\b5\d\d\b/.test(original)
            ? "Token Factory is temporarily unavailable; retry later."
            : /no.*(?:api.?key|auth)|not configured/i.test(original)
              ? MISSING_KEY
              : "Request failed.";
    // Preserve Pi's normalized error, including status, retry hints, and overflow markers.
    return { message: { ...message, errorMessage: `Nebius Token Factory: ${hint}\n${original}` } };
  });
}
