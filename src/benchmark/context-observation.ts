import { isRecord } from "../models.ts";
import type { RequestContext } from "./types.ts";

export function textSize(content: unknown): { bytes: number; lines: number } {
  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content
            .filter(
              (block) => isRecord(block) && block.type === "text" && typeof block.text === "string",
            )
            .map((block) => block.text)
            .join("\n")
        : "";
  return {
    bytes: Buffer.byteLength(text, "utf8"),
    lines: text ? text.split("\n").length - Number(text.endsWith("\n")) : 0,
  };
}

/** Counts serialized JSON bytes, not model tokens. Never retains request content. */
export function observeContext(body: unknown): RequestContext | null {
  if (typeof body !== "string") return null; // Do not consume Request/stream bodies for observation.
  try {
    const payload: unknown = JSON.parse(body);
    if (!isRecord(payload) || !Array.isArray(payload.messages)) return null;
    const bytes = { system: 0, tools: 0, user: 0, assistant: 0, toolResults: 0, other: 0 };
    const toolResults: RequestContext["toolResults"] = [];
    for (const message of payload.messages) {
      const role = isRecord(message) ? message.role : undefined;
      const category =
        role === "system" || role === "developer"
          ? "system"
          : role === "user"
            ? "user"
            : role === "assistant"
              ? "assistant"
              : role === "tool"
                ? "toolResults"
                : "other";
      bytes[category] += Buffer.byteLength(JSON.stringify(message), "utf8");
      if (isRecord(message) && role === "tool" && typeof message.tool_call_id === "string")
        toolResults.push({ id: message.tool_call_id, ...textSize(message.content) });
    }
    if (payload.tools !== undefined)
      bytes.tools = Buffer.byteLength(JSON.stringify(payload.tools), "utf8");
    return {
      measurement: "serialized-json-bytes",
      bytes,
      messageCount: payload.messages.length,
      toolResults,
    };
  } catch {
    return null;
  }
}

/** Stable object-key order lets equivalent argument objects compare within a run. */
export function canonical(value: unknown): string {
  return (
    JSON.stringify(value, (_key, item) =>
      isRecord(item)
        ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
        : item,
    ) ?? "null"
  );
}
