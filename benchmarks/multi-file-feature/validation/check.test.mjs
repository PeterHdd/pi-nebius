import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

const { handle } = await import(pathToFileURL(resolve("routes.mjs")));
const store = await import(pathToFileURL(resolve("store.mjs")));
const { serialize } = await import(pathToFileURL(resolve("serialize.mjs")));
test("completion persists through store, serializer and HTTP routes", async () => {
  assert.equal(typeof store.setCompleted, "function");
  assert.deepEqual(serialize({ id: "x", title: "X", completed: true }), {
    id: "x",
    title: "X",
    completed: true,
  });
  const created = await handle(
    new Request("http://local/tasks", { method: "POST", body: JSON.stringify({ title: "First" }) }),
  );
  assert.equal(created.status, 201);
  const task = await created.json();
  assert.equal(task.completed, false);
  for (const completed of [true, false]) {
    const patched = await handle(
      new Request(`http://local/tasks/${task.id}`, {
        method: "PATCH",
        body: JSON.stringify({ completed }),
      }),
    );
    assert.equal(patched.status, 200);
    assert.equal((await patched.json()).completed, completed);
    const list = await (await handle(new Request("http://local/tasks"))).json();
    assert.equal(list.find((item) => item.id === task.id).completed, completed);
  }
  for (const body of ['{"completed":"true"}', "{}", "broken-json"]) {
    assert.equal(
      (await handle(new Request(`http://local/tasks/${task.id}`, { method: "PATCH", body })))
        .status,
      400,
    );
  }
  assert.equal(
    (
      await handle(
        new Request("http://local/tasks/missing", { method: "PATCH", body: '{"completed":true}' }),
      )
    ).status,
    404,
  );
  assert.equal(store.setCompleted("missing", true), null);
  assert.equal(store.setCompleted(task.id, true).completed, true);
  assert.equal(store.list().find((item) => item.id === task.id).completed, true);
});
