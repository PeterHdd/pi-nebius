import assert from "node:assert/strict";
import { test } from "node:test";
import { canRefresh } from "./auth.mjs";

test("unexpired refresh token", () => {
  assert.equal(canRefresh({ expiresAt: 2000, revoked: false }, 1_999_000), true);
});
test("expiry boundary", () => {
  assert.equal(canRefresh({ expiresAt: 2000, revoked: false }, 2_000_000), false);
});

test("expired, revoked, and missing tokens", () => {
  assert.equal(canRefresh({ expiresAt: 2000 }, 2_000_001), false);
  assert.equal(canRefresh({ expiresAt: 2000, revoked: true }, 1000), false);
  assert.equal(canRefresh(null, 1000), false);
});

for (const invalid of [NaN, Infinity, -Infinity, undefined, "2000"]) {
  test(`rejects invalid expiresAt: ${String(invalid)}`, () => {
    assert.equal(canRefresh({ expiresAt: invalid }, 1000), false);
  });

  test(`rejects invalid nowMs: ${String(invalid)}`, () => {
    assert.equal(canRefresh({ expiresAt: 2000 }, invalid), false);
  });
}
