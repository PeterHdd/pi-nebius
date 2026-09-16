import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { cachePath, discoverModels } from "../src/discovery.ts";
import { BASE_URL, parseModels } from "../src/models.ts";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function setup() {
  const agentDir = await mkdtemp(join(tmpdir(), "pi-nebius-unit-"));
  directories.push(agentDir);
  return { agentDir, apiKey: "fake-unit-key", now: 1000 };
}
const catalog = { object: "list", data: [{ id: "vendor/chat" }] };
const respond = (body: unknown = catalog, status = 200, headers = {}) =>
  (async () => Response.json(body, { status, headers })) as typeof fetch;

test("parses basic and rich models without inventing catalog entries", () => {
  const models = parseModels({
    object: "list",
    data: [
      { id: "z/chat" },
      {
        id: "a/reasoner",
        name: "Reasoner",
        context_length: 131072,
        architecture: { modality: "text+image->text" },
        supported_sampling_parameters: ["reasoning_effort"],
      },
      { id: "embedding", architecture: { modality: "text->embedding" } },
      { id: "image", architecture: { modality: "text->image" } },
      { id: "gone", status: "deleted" },
      { id: "z/chat" },
    ],
  });
  assert.deepEqual(
    models.map((model) => model.id),
    ["a/reasoner", "z/chat"],
  );
  assert.equal(models[0]?.contextWindow, 131072);
  assert.equal(models[0]?.reasoning, true);
  assert.deepEqual(models[0]?.input, ["text", "image"]);
  assert.equal(models[1]?.contextWindow, 32768);
  assert.equal(models[1]?.reasoning, false);
  assert.equal(models[1]?.compat?.maxTokensField, "max_tokens");
  assert.equal(models[1]?.baseUrl, BASE_URL);
  assert.equal(models[1]?.provider, "nebius");
  assert.equal(models[1]?.api, "openai-completions");
});

test("rejects malformed responses and identifiers; accepts authoritative empty catalog", () => {
  for (const payload of [
    null,
    [],
    {},
    { data: [] },
    { object: "list", data: null },
    { object: "list", data: [null] },
    { object: "list", data: [{ id: "" }] },
    { object: "list", data: [{ id: "bad\nname" }] },
  ]) {
    assert.throws(() => parseModels(payload), /Malformed/);
  }
  assert.deepEqual(parseModels({ object: "list", data: [] }), []);
});

test("missing key never fetches or reads an unrelated catalog", async () => {
  const options = await setup();
  const result = await discoverModels({
    ...options,
    apiKey: " ",
    fetch: async () => {
      throw new Error("must not fetch");
    },
  });
  assert.equal(result.source, "none");
  assert.match(result.warning ?? "", /export NEBIUS_API_KEY/);
});

test("requests verbose authenticated discovery and reuses a fresh private cache", async () => {
  const options = await setup();
  let calls = 0;
  const fetcher: typeof fetch = async (url, init) => {
    calls++;
    assert.equal(url, `${BASE_URL}/models?verbose=true`);
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer fake-unit-key");
    assert.equal(init?.redirect, "error");
    assert.ok(init?.signal);
    return Response.json(catalog);
  };
  const result = await discoverModels({ ...options, fetch: fetcher });
  assert.equal(result.source, "network");
  const cached = await discoverModels({ ...options, fetch: fetcher });
  assert.equal(cached.source, "cache");
  assert.deepEqual(cached.models, result.models);
  assert.equal(calls, 1);
  const path = cachePath(options.agentDir, options.apiKey);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.ok(!(await readFile(path, "utf8")).includes(options.apiKey));
  assert.notEqual(path, cachePath(options.agentDir, "another-key"));
});

test("refresh replaces removed models and caches an empty catalog", async () => {
  const options = await setup();
  await discoverModels({ ...options, fetch: respond() });
  const result = await discoverModels({
    ...options,
    force: true,
    fetch: respond({ object: "list", data: [] }),
  });
  assert.deepEqual(result.models, []);
  assert.deepEqual((await discoverModels({ ...options, fetch: respond() })).models, []);
});

test("expired catalogs refresh; transient failures fall back without overwriting freshness", async () => {
  const options = await setup();
  await discoverModels({ ...options, fetch: respond() });
  const path = cachePath(options.agentDir, options.apiKey);
  const before = await readFile(path, "utf8");
  for (const status of [429, 500, 503]) {
    const result = await discoverModels({
      ...options,
      now: 86402000,
      fetch: respond({}, status, { "Retry-After": "12" }),
    });
    assert.equal(result.source, "stale");
    assert.match(result.warning ?? "", new RegExp(`HTTP ${status}`));
    assert.match(result.warning ?? "", /Retry-After: 12/);
    assert.equal(await readFile(path, "utf8"), before);
  }
});

test("401 and 403 invalidate cached discovery without exposing response bodies", async () => {
  const options = await setup();
  for (const status of [401, 403]) {
    await discoverModels({ ...options, fetch: respond() });
    const result = await discoverModels({
      ...options,
      force: true,
      fetch: respond({ detail: options.apiKey }, status),
    });
    assert.equal(result.source, "none");
    assert.deepEqual(result.models, []);
    assert.match(result.warning ?? "", /rejected the credentials/);
    assert.ok(!result.warning?.includes(options.apiKey));
    await assert.rejects(readFile(cachePath(options.agentDir, options.apiKey)));
  }
});

test("malformed JSON, malformed models, network failure and corrupt cache are recoverable", async () => {
  const options = await setup();
  const cases: Array<typeof fetch> = [
    async () => new Response("not-json"),
    respond({ object: "list", data: [{}] }),
    async () => {
      throw new Error(`network error ${options.apiKey}`);
    },
  ];
  for (const fetcher of cases) {
    const result = await discoverModels({ ...options, fetch: fetcher });
    assert.equal(result.source, "none");
    assert.ok(result.warning);
    assert.ok(!result.warning.includes(options.apiKey));
  }
  await discoverModels({ ...options, fetch: respond() });
  await writeFile(cachePath(options.agentDir, options.apiKey), "broken");
  assert.equal((await discoverModels({ ...options, fetch: respond() })).source, "network");
});

test("key changes cannot use another key's cached models", async () => {
  const options = await setup();
  await discoverModels({ ...options, fetch: respond() });
  const result = await discoverModels({ ...options, apiKey: "different", fetch: respond({}, 503) });
  assert.equal(result.source, "none");
});

test("cache write failures do not discard discovered models", async () => {
  const options = await setup();
  await writeFile(join(options.agentDir, "cache"), "blocking file");
  const result = await discoverModels({ ...options, fetch: respond() });
  assert.equal(result.models.length, 1);
  assert.equal(result.source, "network");
  assert.match(result.warning ?? "", /could not be written/);
});

test("oversized responses and aborted discovery fail without corrupting the cache", async () => {
  const options = await setup();
  await discoverModels({ ...options, fetch: respond() });
  const tooLarge = await discoverModels({
    ...options,
    force: true,
    fetch: async () => new Response("x".repeat(4 * 1024 * 1024 + 1)),
  });
  assert.equal(tooLarge.source, "stale");
  assert.match(tooLarge.warning ?? "", /exceeds 4 MiB/);
  const controller = new AbortController();
  controller.abort();
  const aborted = await discoverModels({
    ...options,
    force: true,
    signal: controller.signal,
    fetch: async (_url, init) => {
      init?.signal?.throwIfAborted();
      return Response.json(catalog);
    },
  });
  assert.equal(aborted.source, "none");
  assert.match(aborted.warning ?? "", /cancellation/);
  assert.equal((await discoverModels({ ...options, fetch: respond() })).source, "cache");
});
