import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

const { canRefresh } = await import(pathToFileURL(resolve("auth.mjs")));
test("refresh contract across boundaries and invalid inputs", () => {
  assert.equal(canRefresh({ expiresAt: 2000 }, 1_999_999), true);
  assert.equal(canRefresh({ expiresAt: 2000 }, 2_000_000), false);
  assert.equal(canRefresh({ expiresAt: 2000 }, 2_000_001), false);
  assert.equal(canRefresh({ expiresAt: 2000, revoked: true }, 1000), false);
  assert.equal(canRefresh(null, 1000), false);
  for (const bad of [NaN, Infinity, -Infinity, undefined, "2000"]) {
    assert.equal(
      canRefresh({ expiresAt: bad }, 1000),
      false,
      `expiresAt must be a finite number; received ${String(bad)}`,
    );
    assert.equal(
      canRefresh({ expiresAt: 2000 }, bad),
      false,
      `nowMs must be a finite number; received ${String(bad)}`,
    );
  }
});
