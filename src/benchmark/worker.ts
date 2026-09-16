import type { ProviderStreams } from "@earendil-works/pi-ai";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { nebiusProvider } from "../provider.ts";
import { Instrumentation, redactor } from "./instrumentation.ts";
import type { WorkerInput, WorkerMessage } from "./types.ts";

async function run(input: WorkerInput) {
  const redact = redactor([input.apiKey]);
  const send = (message: WorkerMessage) => {
    if (process.connected) process.send?.(JSON.parse(redact(JSON.stringify(message))), () => {});
  };
  const start = performance.now();
  const observer = new Instrumentation(
    (observation) => send({ type: "observation", observation }),
    () => performance.now() - start,
    redact,
  );
  let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
  let cancelled = false;
  let error: string | null = null;
  const settings = SettingsManager.inMemory();
  const effectiveSettings: Record<string, unknown> = {
    configuration: settings.getGlobalSettings(),
    tools: input.definition.tools,
    compaction: settings.getCompactionSettings(),
    retry: settings.getRetrySettings(),
    providerRetry: settings.getProviderRetrySettings(),
    thinkingLevel: settings.getDefaultThinkingLevel() ?? "medium",
    resourcePolicy: "no external extensions, skills, context files, prompt templates, or themes",
    sdkCwd: ".",
  };
  const abort = () => {
    cancelled = true;
    void session?.abort().catch(() => {});
  };
  process.on("message", (message) => {
    if (message === "abort") abort();
    if (message === "shutdown") process.exit(0);
  });
  process.on("SIGTERM", abort);
  try {
    const base = nebiusProvider([input.model]);
    const baseStreams: ProviderStreams = base;
    const provider = {
      ...base,
      // Key arrives over IPC, never in argv, config files, or child tool environments.
      auth: {
        apiKey: {
          name: "NEBIUS_API_KEY",
          async resolve() {
            return { auth: { apiKey: input.apiKey }, source: "NEBIUS_API_KEY (ephemeral IPC)" };
          },
        },
      },
      stream: ((model, context, options) =>
        baseStreams.stream(model, context, {
          ...options,
          fetch: observer.observeFetch(options?.fetch ?? globalThis.fetch),
        })) as typeof base.stream,
      streamSimple: ((model, context, options) =>
        base.streamSimple(model, context, {
          ...options,
          fetch: observer.observeFetch(options?.fetch ?? globalThis.fetch),
        })) as typeof base.streamSimple,
    };
    const runtime = await ModelRuntime.create({
      authPath: `${input.agentDir}/auth.json`,
      modelsPath: null,
      modelsStorePath: `${input.agentDir}/models-store.json`,
      allowModelNetwork: false,
    });
    const loader = new DefaultResourceLoader({
      cwd: ".",
      agentDir: input.agentDir,
      settingsManager: settings,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      ...(input.definition.systemPrompt ? { systemPrompt: input.definition.systemPrompt } : {}),
      extensionFactories: [
        (pi) => {
          pi.registerProvider(provider);
          pi.on("before_agent_start", (event) => {
            observer.systemPrompt(event.systemPrompt);
          });
        },
      ],
    });
    await loader.reload();
    if (loader.getExtensions().errors.length)
      throw new Error("Pi could not load benchmark instrumentation");
    ({ session } = await createAgentSession({
      cwd: ".",
      agentDir: input.agentDir,
      modelRuntime: runtime,
      model: input.model,
      settingsManager: settings,
      resourceLoader: loader,
      sessionManager: SessionManager.inMemory("."),
      tools: input.definition.tools,
    }));
    session.subscribe((event) => observer.onEvent(event));
    effectiveSettings.effectiveThinkingLevel = session.thinkingLevel;
    if (cancelled) throw new Error("Cancelled during Pi initialization");
    await session.prompt(input.definition.task);
  } catch (caught) {
    error = redact(String(caught));
  } finally {
    session?.dispose();
    await new Promise<void>((resolve) => {
      if (!process.connected) {
        resolve();
        return;
      }
      process.send?.({ type: "done", error, effectiveSettings } satisfies WorkerMessage, () =>
        resolve(),
      );
    });
    // Parent cleans any detached tool descendants, then requests shutdown.
  }
}

if (process.send)
  process.once("message", (input: WorkerInput) => {
    void run(input).catch(() => {
      process.exitCode = 1;
      process.disconnect?.();
    });
  });
