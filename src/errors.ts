/** Preserve retry diagnostics that Pi's SDK error-to-string conversion otherwise drops. */
export function withErrorDetails(fetcher: typeof fetch): typeof fetch {
  return async (input, init) => {
    const response = await fetcher(input, init);
    if (response.ok) return response; // Successful SSE bodies remain completely untouched.
    const details: string[] = [];
    for (const [name, value] of response.headers) {
      if (
        name === "retry-after" ||
        name === "retry-after-ms" ||
        name === "x-request-id" ||
        name.startsWith("x-ratelimit-") ||
        name.startsWith("ratelimit-")
      ) {
        details.push(`${name}: ${value}`);
      }
    }
    if (details.length === 0) return response;
    const body = await response.text();
    const headers = new Headers(response.headers);
    headers.delete("content-length");
    headers.delete("content-encoding");
    headers.set("content-type", "text/plain; charset=utf-8");
    // Headers come first so Pi's error-body truncation keeps retry diagnostics.
    // The original body is retained verbatim, including context-overflow markers.
    return new Response(`${details.join("\n")}\n${body}`, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}
