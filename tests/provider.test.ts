import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createModels } from "@earendil-works/pi-ai";
import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";
import nebius from "../src/index.ts";
import { parseModels } from "../src/models.ts";
import { nebiusProvider } from "../src/provider.ts";

test("native provider resolves environment auth without a persistent login", async () => {
  const original = process.env.NEBIUS_API_KEY;
  try {
    const provider = nebiusProvider(parseModels({ object: "list", data: [{ id: "test/model" }] }));
    assert.equal(provider.auth.apiKey?.login, undefined);
    const models = createModels();
    models.setProvider(provider);
    delete process.env.NEBIUS_API_KEY;
    assert.equal(await models.checkAuth("nebius"), undefined);
    process.env.NEBIUS_API_KEY = "fake-key";
    assert.equal((await models.checkAuth("nebius"))?.source, "NEBIUS_API_KEY");
  } finally {
    if (original === undefined) delete process.env.NEBIUS_API_KEY;
    else process.env.NEBIUS_API_KEY = original;
  }
});

test("Pi's actual extension loader awaits discovery and registers provider and refresh command", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-nebius-loader-"));
  const oldKey = process.env.NEBIUS_API_KEY;
  const oldDir = process.env.PI_CODING_AGENT_DIR;
  process.env.NEBIUS_API_KEY = "fake-key";
  process.env.PI_CODING_AGENT_DIR = dir;
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ object: "list", data: [{ id: "test/model" }] }),
  );
  try {
    const loader = new DefaultResourceLoader({
      cwd: dir,
      agentDir: dir,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      extensionFactories: [nebius],
    });
    await loader.reload();
    const result = loader.getExtensions();
    assert.deepEqual(result.errors, []);
    assert.equal(result.extensions.length, 1);
    assert.ok(result.extensions[0]?.commands.has("nebius-refresh"));
    assert.equal(result.runtime.pendingNativeProviderRegistrations.length, 1);
    assert.equal(
      result.runtime.pendingNativeProviderRegistrations[0]?.provider.getModels()[0]?.id,
      "test/model",
    );
  } finally {
    if (oldKey === undefined) delete process.env.NEBIUS_API_KEY;
    else process.env.NEBIUS_API_KEY = oldKey;
    if (oldDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = oldDir;
    await rm(dir, { recursive: true, force: true });
  }
});
