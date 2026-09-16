import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import type { Command, CommandResult } from "./types.ts";

export function cleanEnvironment(): NodeJS.ProcessEnv {
  return { PATH: process.env.PATH, LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TZ: "UTC" };
}
export function terminateGroup(pid: number, signal: NodeJS.Signals = "SIGTERM") {
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      /* Already exited. */
    }
  }
}
export async function descendants(pid: number): Promise<number[]> {
  try {
    const { stdout } = await promisify(execFile)("ps", ["-axo", "pid=,ppid="], {
      maxBuffer: 4 * 1024 * 1024,
    });
    const rows = stdout
      .trim()
      .split("\n")
      .map((line) => line.trim().split(/\s+/).map(Number));
    const found = new Set([pid]);
    for (let changed = true; changed; ) {
      changed = false;
      for (const [child, parent] of rows)
        if (child && parent && found.has(parent) && !found.has(child)) {
          found.add(child);
          changed = true;
        }
    }
    found.delete(pid);
    return [...found].reverse();
  } catch {
    return [];
  }
}
export async function runCommand(
  command: Command,
  cwd: string,
  timeoutMs: number,
  signal?: AbortSignal,
  redact: (text: string) => string = (text) => text,
): Promise<CommandResult> {
  const started = performance.now();
  if (signal?.aborted)
    return {
      command,
      exitCode: null,
      signal: "SIGINT",
      durationMs: 0,
      timedOut: false,
      output: "Cancelled before validation",
      outputTruncated: false,
    };
  return new Promise((resolve) => {
    const child = spawn(command.command, command.args, {
      cwd,
      env: cleanEnvironment(),
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    let bytes = 0;
    let truncated = false;
    let timedOut = false;
    let settled = false;
    let force: NodeJS.Timeout | undefined;
    const stop = () => {
      if (!child.pid) return;
      terminateGroup(child.pid);
      force ??= setTimeout(() => {
        if (child.pid) terminateGroup(child.pid, "SIGKILL");
      }, 1000);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, timeoutMs);
    signal?.addEventListener("abort", stop, { once: true });
    const capture = (data: Buffer) => {
      const remaining = 256 * 1024 - bytes;
      if (data.length > remaining) truncated = true;
      if (remaining > 0) {
        chunks.push(data.subarray(0, remaining));
        bytes += Math.min(remaining, data.length);
      }
    };
    child.stdout.on("data", capture);
    child.stderr.on("data", capture);
    const finish = (code: number | null, exitSignal: string | null, error?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (force) clearTimeout(force);
      signal?.removeEventListener("abort", stop);
      // Remove descendants that kept stdio open after their command exited.
      if (child.pid) terminateGroup(child.pid, "SIGKILL");
      resolve({
        command,
        exitCode: code,
        signal: exitSignal,
        durationMs: performance.now() - started,
        timedOut,
        output: redact(error ?? Buffer.concat(chunks).toString("utf8")),
        outputTruncated: truncated,
      });
    };
    child.on("error", (error) => finish(null, null, String(error)));
    child.on("exit", (code, exitSignal) => {
      if (child.pid) terminateGroup(child.pid, "SIGKILL");
      child.once("close", () => finish(code, exitSignal));
    });
  });
}
