import { createHash } from "node:crypto";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { isRecord } from "../models.ts";
import type { Observation, ReportedUsage, RequestTrace } from "./types.ts";

export const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const count = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
export function reportedUsage(value: unknown): ReportedUsage | null {
  if (!isRecord(value)) return null;
  const prompt = isRecord(value.prompt_tokens_details) ? value.prompt_tokens_details : {};
  const completion = isRecord(value.completion_tokens_details)
    ? value.completion_tokens_details
    : {};
  return {
    inputTokens: count(value.prompt_tokens),
    outputTokens: count(value.completion_tokens),
    cachedInputTokens: count(
      prompt.cached_tokens ?? value.prompt_cache_hit_tokens ?? value.cached_tokens,
    ),
    reasoningTokens: count(completion.reasoning_tokens),
    totalTokens: count(value.total_tokens),
  };
}
export function emptyObservation(): Observation {
  return {
    requests: [],
    tools: [],
    agentTurns: 0,
    assistantMessages: 0,
    toolCalls: 0,
    toolCallsByType: {},
    compactions: 0,
    retries: 0,
    agentStartedAtMs: null,
    agentEndedAtMs: null,
    systemPromptHash: null,
    lastAssistantStopReason: null,
    errors: [],
  };
}
export function redactor(secrets: string[]) {
  return (value: string) => {
    let safe = value;
    for (const secret of secrets.filter(Boolean)) safe = safe.split(secret).join("[REDACTED]");
    return safe.replace(/Bearer\s+[^\s"']+/gi, "Bearer [REDACTED]");
  };
}

/** Observer only: never returns modified payloads, tools, messages, or stream bytes. */
export class Instrumentation {
  readonly state = emptyObservation();
  private compacting = false;
  constructor(
    private readonly update: (state: Observation) => void = () => {},
    private readonly now: () => number = () => performance.now(),
    private readonly redact: (text: string) => string = (text) => text,
  ) {}

  systemPrompt(prompt: string) {
    this.state.systemPromptHash = hash(prompt);
    this.publish();
  }
  private publish() {
    this.update(this.state);
  }
  onEvent(event: AgentSessionEvent) {
    const at = this.now();
    switch (event.type) {
      case "agent_start":
        this.state.agentStartedAtMs ??= at;
        break;
      case "agent_settled":
        this.state.agentEndedAtMs = at;
        break;
      case "turn_start":
        this.state.agentTurns++;
        break;
      case "compaction_start":
        this.compacting = true;
        this.state.compactions++;
        break;
      case "compaction_end":
        this.compacting = false;
        break;
      case "auto_retry_start":
        this.state.retries++;
        break;
      case "tool_execution_start":
        this.state.tools.push({
          id: event.toolCallId,
          name: event.toolName,
          startedAtMs: at,
          endedAtMs: null,
          isError: null,
          error: null,
        });
        break;
      case "tool_execution_end": {
        const tool = this.state.tools.find((item) => item.id === event.toolCallId);
        if (tool) {
          tool.endedAtMs = at;
          tool.isError = event.isError;
        }
        break;
      }
      case "message_end": {
        const message = event.message;
        if (message.role === "assistant") {
          this.state.assistantMessages++;
          this.state.lastAssistantStopReason = message.stopReason;
          if (message.errorMessage)
            this.state.errors.push(this.redact(message.errorMessage).slice(0, 8000));
          for (const block of message.content)
            if (block.type === "toolCall") {
              this.state.toolCalls++;
              this.state.toolCallsByType[block.name] =
                (this.state.toolCallsByType[block.name] ?? 0) + 1;
            }
        } else if (message.role === "toolResult") {
          let tool = this.state.tools.find((item) => item.id === message.toolCallId);
          if (!tool) {
            tool = {
              id: message.toolCallId,
              name: message.toolName,
              startedAtMs: null,
              endedAtMs: at,
              isError: message.isError,
              error: null,
            };
            this.state.tools.push(tool);
          }
          tool.isError = message.isError;
          if (message.isError)
            tool.error = this.redact(
              message.content
                .filter((item) => item.type === "text")
                .map((item) => item.text)
                .join("\n"),
            ).slice(0, 4000);
        }
        break;
      }
      default:
        return;
    }
    this.publish();
  }

  observeFetch(fetcher: typeof fetch): typeof fetch {
    return async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (!url.pathname.endsWith("/chat/completions")) return fetcher(input, init);
      const trace: RequestTrace = {
        request: this.state.requests.length + 1,
        purpose: this.compacting ? "compaction" : "agent",
        startedAtMs: this.now(),
        endedAtMs: null,
        firstContentAtMs: null,
        status: null,
        requestId: null,
        servedModel: null,
        systemFingerprint: null,
        finishReason: null,
        usage: null,
        error: null,
        streamComplete: false,
      };
      this.state.requests.push(trace);
      this.publish();
      try {
        const response = await fetcher(input, init);
        trace.status = response.status;
        trace.requestId = response.headers.get("x-request-id");
        this.publish();
        if (!response.body) {
          trace.endedAtMs = this.now();
          this.publish();
          return response;
        }
        const decoder = new TextDecoder();
        let buffer = "";
        let dropped = false;
        const consume = (data: string) => {
          if (data.trim() === "[DONE]") {
            trace.streamComplete = true;
            return;
          }
          let chunk: unknown;
          try {
            chunk = JSON.parse(data);
          } catch {
            return;
          }
          if (!isRecord(chunk)) return;
          if (typeof chunk.model === "string") trace.servedModel = chunk.model;
          if (typeof chunk.system_fingerprint === "string")
            trace.systemFingerprint = chunk.system_fingerprint;
          if (chunk.usage) trace.usage = reportedUsage(chunk.usage);
          for (const choice of Array.isArray(chunk.choices) ? chunk.choices : []) {
            if (!isRecord(choice)) continue;
            if (typeof choice.finish_reason === "string") trace.finishReason = choice.finish_reason;
            if (choice.usage) trace.usage = reportedUsage(choice.usage);
            const delta = isRecord(choice.delta) ? choice.delta : {};
            if (
              trace.firstContentAtMs === null &&
              ([delta.content, delta.reasoning_content, delta.reasoning].some(
                (value) => typeof value === "string" && value.length > 0,
              ) ||
                (Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0))
            )
              trace.firstContentAtMs = this.now();
          }
        };
        const ingest = (bytes: Uint8Array) => {
          if (dropped) return;
          const previous = JSON.stringify([trace.usage, trace.firstContentAtMs]);
          buffer += decoder.decode(bytes, { stream: true });
          if (buffer.length > 1024 * 1024) {
            dropped = true;
            buffer = "";
            trace.error = "Instrumentation frame exceeded 1 MiB; usage may be incomplete";
            return;
          }
          // Line parser handles arbitrary TCP chunking, LF and CRLF. JSON payloads
          // are contained in SSE data lines for Nebius's Chat Completions protocol.
          let newline = buffer.indexOf("\n");
          while (newline >= 0) {
            const line = buffer.slice(0, newline).replace(/\r$/, "");
            buffer = buffer.slice(newline + 1);
            if (line.startsWith("data:")) consume(line.slice(5).trimStart());
            newline = buffer.indexOf("\n");
          }
          if (JSON.stringify([trace.usage, trace.firstContentAtMs]) !== previous) this.publish();
        };
        const reader = response.body.getReader();
        const finish = () => {
          trace.endedAtMs = this.now();
          this.publish();
        };
        const body = new ReadableStream<Uint8Array>({
          pull: async (controller) => {
            try {
              const result = await reader.read();
              if (result.done) {
                buffer += decoder.decode();
                if (buffer.startsWith("data:")) consume(buffer.slice(5).trim());
                if (!response.ok)
                  trace.error = this.redact(`HTTP ${response.status}: ${buffer}`).slice(0, 8000);
                finish();
                controller.close();
                return;
              }
              // Forward exactly the original bytes. Observation is best effort and cannot fail inference.
              try {
                ingest(result.value);
              } catch {
                trace.error = "Instrumentation could not decode response metadata";
              }
              controller.enqueue(result.value);
            } catch (error) {
              trace.error = this.redact(String(error)).slice(0, 8000);
              finish();
              controller.error(error);
            }
          },
          cancel: async (reason) => {
            finish();
            await reader.cancel(reason);
          },
        });
        return new Response(body, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      } catch (error) {
        trace.error = this.redact(String(error)).slice(0, 8000);
        trace.endedAtMs = this.now();
        this.publish();
        throw error;
      }
    };
  }
}
