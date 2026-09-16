import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

const invoice = await import(pathToFileURL(resolve("invoice.mjs")));
test("shared subtotal and preserved behavior", async () => {
  assert.equal(typeof invoice.lineSubtotal, "function");
  for (const lines of [
    [],
    [{ price: 10, quantity: 2 }],
    [
      { price: 1.5, quantity: 3 },
      { price: 20, quantity: 2 },
    ],
  ]) {
    const before = JSON.stringify(lines);
    const subtotal = lines.reduce((total, line) => total + line.price * line.quantity, 0);
    assert.equal(invoice.lineSubtotal(lines), subtotal);
    for (const discount of [0, 0.1, 1]) {
      assert.equal(invoice.regularTotal(lines, discount), subtotal * (1 - discount) + 5);
      assert.equal(invoice.priorityTotal(lines, discount), subtotal * (1 - discount) + 15);
    }
    assert.equal(JSON.stringify(lines), before);
  }
  const source = await readFile("invoice.mjs", "utf8");
  assert.equal(
    (source.match(/\.reduce\s*\(/g) ?? []).length,
    1,
    "One shared reduce implementation",
  );
  for (const name of ["regularTotal", "priorityTotal"]) {
    assert.match(invoice[name].toString(), /lineSubtotal\s*\(/, `${name} must call the helper`);
  }
});
