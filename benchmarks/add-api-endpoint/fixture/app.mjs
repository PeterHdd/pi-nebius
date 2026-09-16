export function handle(request) {
  if (new URL(request.url).pathname === "/health" && request.method === "GET") {
    return Response.json({ ok: true });
  }
  return Response.json({ error: "Not found" }, { status: 404 });
}
