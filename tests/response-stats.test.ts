import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { registerResponseStats } from "../src/response-stats.ts";

function harness(provider = "nebius", hasUI = true) {
  let time = 0;
  let status: string | undefined;
  const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => void>();
  const pi = {
    on: (name: string, handler: (event: unknown, ctx: ExtensionContext) => void) => {
      handlers.set(name, handler);
    },
  } as unknown as ExtensionAPI;
  const ctx = {
    hasUI,
    model: { provider },
    ui: {
      setStatus: (_key: string, value: string | undefined) => {
        status = value;
      },
    },
  } as unknown as ExtensionContext;
  registerResponseStats(pi, () => time);
  const message = { role: "assistant", provider, stopReason: "stop", usage: { output: 320 } };
  return {
    emit(name: string, at: number, event: unknown = {}) {
      time = at;
      handlers.get(name)?.(event, ctx);
    },
    delta(at: number, type = "text_delta", delta = "hello") {
      this.emit("message_update", at, { message, assistantMessageEvent: { type, delta } });
    },
    end(at: number, overrides = {}) {
      this.emit("message_end", at, { message: { ...message, ...overrides } });
    },
    status: () => status,
  };
}

test("response timing includes initial wait, ignores empty chunks and excludes tools between requests", () => {
  const h = harness();
  h.emit("before_provider_request", 100);
  h.delta(200, "text_delta", "");
  h.delta(900, "thinking_delta");
  h.delta(1500);
  h.end(4300, { stopReason: "toolUse" });
  assert.equal(h.status(), "Nebius · First content: 0.8s · Response: 4.2s · Output: 320 tokens");
  h.emit("message_end", 10000, { message: { role: "toolResult" } });
  h.emit("before_provider_request", 11000);
  assert.equal(h.status(), undefined);
  h.delta(11200, "toolcall_delta");
  h.end(12000);
  assert.equal(h.status(), "Nebius · First content: 0.2s · Response: 1.0s · Output: 320 tokens");
});

test("other providers and headless runs do not produce statistics", () => {
  for (const h of [harness("other"), harness("nebius", false)]) {
    h.emit("before_provider_request", 0);
    h.delta(100);
    h.end(1000);
    assert.equal(h.status(), undefined);
  }
});

test("failed and aborted requests do not present incomplete usage as final", () => {
  for (const stopReason of ["error", "aborted"]) {
    const h = harness();
    h.emit("before_provider_request", 0);
    h.end(1000, { stopReason });
    assert.equal(
      h.status(),
      `Nebius · First content: n/a · Response: 1.0s · ${stopReason === "error" ? "Failed" : "Aborted"}`,
    );
  }
});

test("model and session changes discard stale timing and status", () => {
  for (const event of ["model_select", "session_start"]) {
    const h = harness();
    h.emit("before_provider_request", 0);
    h.delta(100);
    h.end(500);
    assert.ok(h.status());
    h.emit("before_provider_request", 600);
    h.emit(event, 700);
    h.end(1000);
    assert.equal(h.status(), undefined);
  }
});
