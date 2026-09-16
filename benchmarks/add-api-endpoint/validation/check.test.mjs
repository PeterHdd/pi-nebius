import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

const { handle } = await import(pathToFileURL(resolve("app.mjs")));
test("HTTP endpoint contract", async () => {
  assert.deepEqual(await handle(new Request("http://local/health")).json(), { ok: true });
  for (const [a, b] of [
    [2, 3],
    [-4, 1.5],
    [0, 0],
    [100, -100],
  ]) {
    const response = await handle(new Request(`http://local/api/sum?a=${a}&b=${b}`));
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /application\/json/);
    assert.deepEqual(await response.json(), { sum: a + b });
  }
  for (const query of [
    "",
    "a=1",
    "b=2",
    "a=&b=2",
    "a=%20&b=2",
    "a=no&b=2",
    "a=Infinity&b=1",
    "a=1e308&b=1e308",
  ]) {
    assert.equal((await handle(new Request(`http://local/api/sum?${query}`))).status, 400);
  }
  assert.equal(
    (await handle(new Request("http://local/api/sum?a=1&b=2", { method: "POST" }))).status,
    405,
  );
  assert.equal((await handle(new Request("http://local/missing"))).status, 404);
});
