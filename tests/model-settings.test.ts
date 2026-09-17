import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  applyModelSettings,
  applyRequestSettings,
  loadSettings,
  requestSettings,
  saveModelSettings,
  validateSettings,
} from "../src/model-settings.ts";
import { parseModels } from "../src/models.ts";
import { nebiusProvider } from "../src/provider.ts";
import { chunk, sse } from "./helpers.ts";

test("settings persist per model, reset independently, and refuse malformed files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nebius-settings-"));
  const path = join(dir, "settings.json");
  try {
    await saveModelSettings(path, "a", { temperature: 0, maxTokens: 123 });
    await saveModelSettings(path, "b", { reasoningEffort: "high" });
    assert.deepEqual(await loadSettings(path), {
      a: { temperature: 0, maxTokens: 123 },
      b: { reasoningEffort: "high" },
    });
    await saveModelSettings(path, "a", {});
    assert.deepEqual(await loadSettings(path), { b: { reasoningEffort: "high" } });
    await writeFile(path, "broken");
    await assert.rejects(saveModelSettings(path, "a", {}));
    assert.equal(await readFile(path, "utf8"), "broken");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("settings validate limits and leave unsupported request parameters unset", () => {
  for (const settings of [
    { temperature: NaN },
    { temperature: 3 },
    { maxTokens: 0 },
    { maxTokens: 1.5 },
    { maxTokens: 101, contextWindow: 100 },
    { reasoningEffort: "invalid" },
    { reasoning: 1 },
  ])
    assert.throws(() => validateSettings(settings));
  const model = parseModels({ object: "list", data: [{ id: "test" }] })[0];
  assert.ok(model);
  assert.deepEqual(
    applyRequestSettings({}, model, { temperature: 1, reasoningEffort: "high" }),
    {},
  );
  assert.equal(applyModelSettings(model, { contextWindow: 100 }).maxTokens, 100);
});

test("real adapter applies saved overrides and records outgoing settings without prompt content", async () => {
  const base = parseModels({
    object: "list",
    data: [{ id: "test", supported_sampling_parameters: ["temperature", "reasoning_effort"] }],
  })[0];
  assert.ok(base);
  const settings = { temperature: 0.4, reasoningEffort: "low", maxTokens: 222 } as const;
  const model = applyModelSettings(base, settings);
  const recorded: Record<string, unknown>[] = [];
  const provider = nebiusProvider([model], { test: settings }, (payload) =>
    recorded.push(requestSettings(payload)),
  );
  for (const method of ["stream", "streamSimple"] as const) {
    let body: Record<string, unknown> = {};
    const response = await provider[method](
      model,
      { messages: [{ role: "user", content: "private prompt", timestamp: 1 }] },
      {
        apiKey: "test",
        temperature: 1,
        maxTokens: 10,
        onPayload: (payload) => ({ ...(payload as object), temperature: 2 }),
        fetch: async (_url, init) => {
          body = JSON.parse(String(init?.body));
          return new Response(sse([chunk({ content: "ok" }, "stop")]));
        },
      },
    ).result();
    assert.equal(response.stopReason, "stop");
    assert.equal(body.temperature, 0.4);
    assert.equal(body.reasoning_effort, "low");
    assert.equal(body.max_tokens, 222);
    assert.deepEqual(recorded.at(-1), {
      temperature: 0.4,
      reasoning_effort: "low",
      max_tokens: 222,
    });
  }
});

test("interactive menu validates edits, updates the active model, and resets saved settings", async () => {
  const { registerModelSettingsCommand } = await import("../src/model-settings-command.ts");
  const dir = await mkdtemp(join(tmpdir(), "nebius-menu-"));
  const path = join(dir, "settings.json");
  const base = parseModels({
    object: "list",
    data: [{ id: "test", supported_sampling_parameters: ["temperature"] }],
  })[0];
  assert.ok(base);
  type API = import("@earendil-works/pi-coding-agent").ExtensionAPI;
  type Command = Parameters<API["registerCommand"]>[1];
  let command: Command | undefined;
  let settings: import("../src/model-settings.ts").ModelSettingsMap = {};
  const selected: number[] = [];
  const notices: string[] = [];
  const pi = {
    registerCommand: (_name: string, value: Command) => {
      command = value;
    },
    setModel: async (model: typeof base) => {
      selected.push(model.maxTokens);
      return true;
    },
  } as unknown as API;
  registerModelSettingsCommand(pi, {
    path,
    models: () => [base],
    settings: () => settings,
    update: (value) => {
      settings = value;
    },
  });
  const actions = [
    "Temperature:",
    "Temperature:",
    "Maximum output tokens:",
    "Done",
    "Reset all overrides",
    "Done",
  ];
  const inputs = ["3", "0.3", "6000"];
  const ctx = {
    hasUI: true,
    isIdle: () => true,
    model: base,
    modelRegistry: { getAll: () => [applyModelSettings(base, settings.test)] },
    ui: {
      select: async (_title: string, choices: string[]) => {
        const prefix = actions.shift();
        return choices.find((choice) => prefix && choice.startsWith(prefix));
      },
      input: async () => inputs.shift(),
      notify: (message: string) => notices.push(message),
    },
  } as unknown as Parameters<Command["handler"]>[1];
  try {
    assert.ok(command);
    await command.handler("test", ctx);
    assert.deepEqual(await loadSettings(path), { test: { temperature: 0.3, maxTokens: 6000 } });
    assert.ok(notices.some((message) => message.includes("Temperature must")));
    assert.equal(selected.at(-1), 6000);
    await command.handler("test", ctx);
    assert.deepEqual(await loadSettings(path), {});
    assert.equal(selected.at(-1), base.maxTokens);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
