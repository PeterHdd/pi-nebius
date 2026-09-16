import assert from "node:assert/strict";
import { test } from "node:test";
import { handle } from "./app.mjs";

test("health", async () =>
  assert.deepEqual(await handle(new Request("http://local/health")).json(), { ok: true }));
test("sum endpoint", async () =>
  assert.deepEqual(await handle(new Request("http://local/api/sum?a=2&b=3")).json(), { sum: 5 }));
