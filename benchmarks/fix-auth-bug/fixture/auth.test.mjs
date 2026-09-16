import assert from "node:assert/strict";
import { test } from "node:test";
import { canRefresh } from "./auth.mjs";

test("unexpired refresh token", () => {
  assert.equal(canRefresh({ expiresAt: 2000, revoked: false }, 1_999_000), true);
});
test("expiry boundary", () => {
  assert.equal(canRefresh({ expiresAt: 2000, revoked: false }, 2_000_000), false);
});
