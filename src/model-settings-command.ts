import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  applyModelSettings,
  efforts,
  type ModelSettings,
  type ModelSettingsMap,
  saveModelSettings,
  validateSettings,
} from "./model-settings.ts";
import type { NebiusModel } from "./models.ts";

export function registerModelSettingsCommand(
  pi: ExtensionAPI,
  options: {
    path: string;
    models: () => NebiusModel[];
    settings: () => ModelSettingsMap;
    update: (settings: ModelSettingsMap) => void;
  },
) {
  pi.registerCommand("nebius-model", {
    description: "Configure saved per-model Nebius settings",
    handler: async (args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("/nebius-model requires interactive Pi.", "warning");
        return;
      }
      if (!ctx.isIdle()) {
        ctx.ui.notify("Wait for the current response before changing model settings.", "warning");
        return;
      }
      const models = options.models();
      const id =
        args.trim() ||
        (await ctx.ui.select(
          "Nebius model settings",
          models.map((model) => model.id),
        ));
      if (!id) return;
      const base = models.find((model) => model.id === id);
      if (!base) {
        ctx.ui.notify("Unknown model. Run /nebius-refresh first.", "error");
        return;
      }
      try {
        while (true) {
          const current = options.settings()[id] ?? {};
          const effective = applyModelSettings(base, current);
          const choices = [
            `Temperature: ${current.temperature ?? "inherit"}`,
            `Reasoning effort: ${current.reasoningEffort ?? "inherit"}`,
            `Maximum output tokens: ${current.maxTokens ?? `inherit (${base.maxTokens})`}`,
            "Advanced metadata settings",
            "Reset all overrides",
            "Done",
          ];
          const action = await ctx.ui.select(id, choices);
          if (!action || action === "Done") return;
          const next: ModelSettings = { ...current };
          if (action === "Reset all overrides") {
            for (const key of Object.keys(next)) delete next[key as keyof ModelSettings];
          } else if (action === "Advanced metadata settings") {
            const advanced = await ctx.ui.select(
              "Local metadata only; does not change server capabilities",
              ["Context window", "Reasoning support", "Back"],
            );
            if (!advanced || advanced === "Back") continue;
            if (advanced === "Context window") {
              const value = await ctx.ui.input(
                "Context window: positive integer; blank to inherit",
                String(current.contextWindow ?? ""),
              );
              if (value === undefined) continue;
              if (!value.trim()) delete next.contextWindow;
              else next.contextWindow = Number(value);
            } else {
              const value = await ctx.ui.select("Reasoning support", [
                "Inherit",
                "Enabled",
                "Disabled",
              ]);
              if (!value) continue;
              if (value === "Inherit") delete next.reasoning;
              else next.reasoning = value === "Enabled";
              if (value === "Disabled") delete next.reasoningEffort;
            }
          } else if (action === choices[1]) {
            if (!effective.reasoning || !effective.compat?.supportsReasoningEffort) {
              ctx.ui.notify(
                "The catalog does not advertise reasoning-effort control for this model. No override will be sent.",
                "warning",
              );
              continue;
            }
            const value = await ctx.ui.select(
              "Reasoning effort (saved value overrides Pi's thinking setting)",
              ["Inherit", ...efforts],
            );
            if (!value) continue;
            if (value === "Inherit") delete next.reasoningEffort;
            else next.reasoningEffort = value as ModelSettings["reasoningEffort"];
          } else {
            const temperature = action === choices[0];
            if (temperature && !base.nebiusSupportedParameters?.includes("temperature")) {
              ctx.ui.notify(
                "The catalog does not advertise temperature control for this model. No override will be sent.",
                "warning",
              );
              continue;
            }
            const key = temperature ? "temperature" : "maxTokens";
            const value = await ctx.ui.input(
              temperature
                ? "Temperature: 0–2; blank to inherit"
                : "Maximum output tokens: positive integer; blank to inherit",
              String(current[key] ?? ""),
            );
            if (value === undefined) continue;
            if (!value.trim()) delete next[key];
            else next[key] = Number(value);
          }
          try {
            validateSettings(next);
            if (
              next.maxTokens !== undefined &&
              next.maxTokens > (next.contextWindow ?? base.contextWindow)
            )
              throw new Error("Maximum output tokens cannot exceed the context window.");
          } catch (error) {
            ctx.ui.notify(String(error), "error");
            continue;
          }
          const saved = await saveModelSettings(options.path, id, next);
          options.update(saved);
          if (ctx.model?.provider === "nebius" && ctx.model.id === id) {
            const model = ctx.modelRegistry
              .getAll()
              .find((candidate) => candidate.provider === "nebius" && candidate.id === id);
            if (model) await pi.setModel(model);
          }
          ctx.ui.notify(
            "Saved. New requests use these settings; running benchmarks keep their starting settings.",
            "info",
          );
        }
      } catch (error) {
        ctx.ui.notify(`Could not update Nebius settings: ${String(error)}`, "error");
      }
    },
  });
}
