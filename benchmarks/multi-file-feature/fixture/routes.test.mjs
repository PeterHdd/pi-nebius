import assert from "node:assert/strict";
import { test } from "node:test";
import { handle } from "./routes.mjs";

test("created task starts incomplete", async () => {
  const response = await handle(
    new Request("http://local/tasks", {
      method: "POST",
      body: JSON.stringify({ title: "A task" }),
    }),
  );
  assert.equal(response.status, 201);
  assert.equal((await response.json()).completed, false);
});
