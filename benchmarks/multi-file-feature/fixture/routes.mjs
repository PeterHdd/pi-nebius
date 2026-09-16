import { serialize } from "./serialize.mjs";
import { create, list } from "./store.mjs";
export async function handle(request) {
  const path = new URL(request.url).pathname;
  if (path === "/tasks" && request.method === "GET") return Response.json(list().map(serialize));
  if (path === "/tasks" && request.method === "POST") {
    const { title } = await request.json();
    return Response.json(serialize(create(title)), { status: 201 });
  }
  return Response.json({ error: "Not found" }, { status: 404 });
}
