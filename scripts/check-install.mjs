import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";

// Reproduce Pi's Git install in a clean directory, without build output or dev tools.
const scratch = await mkdtemp(join(tmpdir(), "pi-nebius-install-"));
const oldKey = process.env.NEBIUS_API_KEY;
const oldDir = process.env.PI_CODING_AGENT_DIR;
const oldFetch = globalThis.fetch;
try {
  for (const path of [
    "package.json",
    "package-lock.json",
    "src",
    "tsconfig.json",
    "tsconfig.build.json",
  ])
    await cp(path, join(scratch, path), { recursive: true });
  execFileSync("npm", ["install", "--omit=dev", "--no-audit", "--no-fund"], {
    cwd: scratch,
    stdio: "inherit",
  });
  await assert.rejects(stat(join(scratch, "node_modules/typescript")), { code: "ENOENT" });
  await assert.rejects(stat(join(scratch, "dist")), { code: "ENOENT" });

  process.env.NEBIUS_API_KEY = "fake-install-check-key";
  process.env.PI_CODING_AGENT_DIR = join(scratch, "agent");
  globalThis.fetch = async () => Response.json({ object: "list", data: [{ id: "test/install" }] });
  const loader = new DefaultResourceLoader({
    cwd: scratch,
    agentDir: process.env.PI_CODING_AGENT_DIR,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    additionalExtensionPaths: [join(scratch, "src/index.ts")],
  });
  await loader.reload();
  const result = loader.getExtensions();
  assert.deepEqual(result.errors, []);
  assert.equal(result.extensions.length, 1);
  assert.ok(result.extensions[0].commands.has("nebius-refresh"));
  assert.equal(result.runtime.pendingNativeProviderRegistrations.length, 1);
  assert.equal(
    result.runtime.pendingNativeProviderRegistrations[0].provider.getModels()[0].id,
    "test/install",
  );
  console.log("Production-only Git install and Pi extension loading passed without tsc or dist.");
} finally {
  globalThis.fetch = oldFetch;
  if (oldKey === undefined) delete process.env.NEBIUS_API_KEY;
  else process.env.NEBIUS_API_KEY = oldKey;
  if (oldDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = oldDir;
  await rm(scratch, { recursive: true, force: true });
}
