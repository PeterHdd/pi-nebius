import assert from "node:assert/strict";
import { test } from "node:test";
import { priorityTotal, regularTotal } from "./invoice.mjs";

test("totals", () => {
  const lines = [{ price: 10, quantity: 2 }];
  assert.equal(regularTotal(lines, 0.1), 23);
  assert.equal(priorityTotal(lines, 0.1), 33);
});
