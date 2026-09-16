import { readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { parse } from "yaml";
import { isRecord } from "../models.ts";
import type { BenchmarkDefinition, Command, PricingSnapshot } from "./types.ts";

export function positive(value: unknown, name: string, maximum = 86400): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > maximum)
    throw new Error(`${name} must be an integer between 1 and ${maximum}`);
  return value;
}
function text(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} must be nonempty text`);
  return value;
}
function fields(value: Record<string, unknown>, allowed: string[]) {
  for (const key of Object.keys(value))
    if (!allowed.includes(key)) throw new Error(`Unknown field: ${key}`);
}
function commands(value: unknown, name: string): Command[] {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array`);
  return value.map((item) => {
    if (typeof item === "string") return { command: "/bin/sh", args: ["-c", text(item, name)] };
    if (!isRecord(item)) throw new Error(`Invalid ${name} command`);
    fields(item, ["command", "args"]);
    if (
      item.args !== undefined &&
      (!Array.isArray(item.args) || item.args.some((arg) => typeof arg !== "string"))
    )
      throw new Error(`${name} args must be strings`);
    return { command: text(item.command, "command"), args: (item.args ?? []) as string[] };
  });
}
function localPath(value: unknown, fallback: string): string {
  const path = value === undefined ? fallback : text(value, "path");
  if (isAbsolute(path) || path.split(/[\\/]/).includes(".."))
    throw new Error("Benchmark paths must be relative and inside its directory");
  return path;
}
export function parseDefinition(source: string): BenchmarkDefinition {
  const value: unknown = parse(source, { maxAliasCount: 0, uniqueKeys: true });
  if (!isRecord(value)) throw new Error("Benchmark definition must be an object");
  fields(value, [
    "schemaVersion",
    "name",
    "task",
    "fixture",
    "validationDirectory",
    "validation",
    "setup",
    "timeout",
    "validationTimeout",
    "tools",
    "systemPrompt",
  ]);
  if (value.schemaVersion !== undefined && value.schemaVersion !== 1)
    throw new Error("Unsupported benchmark schemaVersion");
  const tools = value.tools ?? ["read", "bash", "edit", "write"];
  const available = ["read", "bash", "edit", "write", "grep", "find", "ls"];
  if (
    !Array.isArray(tools) ||
    !tools.length ||
    tools.some((tool) => !available.includes(tool)) ||
    new Set(tools).size !== tools.length
  )
    throw new Error("tools must be a nonempty, unique list of Pi built-in tools");
  const validation = commands(value.validation, "validation");
  if (!validation.length) throw new Error("At least one validation command is required");
  return {
    schemaVersion: 1,
    name: text(value.name, "name"),
    task: text(value.task, "task"),
    fixture: localPath(value.fixture, "fixture"),
    validationDirectory: localPath(value.validationDirectory, "validation"),
    validation,
    setup: commands(value.setup ?? [], "setup"),
    timeout: positive(value.timeout ?? 600, "timeout"),
    validationTimeout: positive(value.validationTimeout ?? 60, "validationTimeout"),
    tools,
    ...(value.systemPrompt === undefined
      ? {}
      : { systemPrompt: text(value.systemPrompt, "systemPrompt") }),
  };
}
export async function loadDefinition(path: string) {
  const definitionFile =
    path.endsWith(".yaml") || path.endsWith(".yml") || path.endsWith(".json")
      ? resolve(path)
      : resolve(path, "benchmark.yaml");
  const source = await readFile(definitionFile, "utf8");
  if (Buffer.byteLength(source) > 1024 * 1024) throw new Error("Definition exceeds 1 MiB");
  const definition = parseDefinition(source);
  const directory = await realpath(dirname(definitionFile));
  const directories: string[] = [];
  for (const child of [definition.fixture, definition.validationDirectory]) {
    const actual = await realpath(join(directory, child));
    directories.push(actual);
    const rel = relative(directory, actual);
    if (!rel || rel.startsWith("..") || isAbsolute(rel))
      throw new Error("Fixture/validation must be separate directories inside the benchmark");
  }
  const [fixture, validators] = directories;
  if (
    fixture &&
    validators &&
    [relative(fixture, validators), relative(validators, fixture)].some(
      (path) => !isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`),
    )
  )
    throw new Error("Fixture and validation directories must be separate and must not overlap");
  return { definition, directory, source };
}
export function parsePricing(source: string): PricingSnapshot {
  const value: unknown = parse(source, { maxAliasCount: 0, uniqueKeys: true });
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    value.currency !== "USD" ||
    !isRecord(value.models)
  )
    throw new Error("Pricing requires schemaVersion: 1, currency: USD, and models");
  fields(value, ["schemaVersion", "currency", "asOf", "source", "models"]);
  text(value.source, "pricing source");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(text(value.asOf, "pricing asOf")) ||
    !Number.isFinite(Date.parse(String(value.asOf))) ||
    new Date(String(value.asOf)).toISOString().slice(0, 10) !== value.asOf
  )
    throw new Error("Pricing asOf must be YYYY-MM-DD");
  for (const [id, pricing] of Object.entries(value.models)) {
    if (!isRecord(pricing)) throw new Error(`Invalid pricing for ${id}`);
    fields(pricing, ["inputPerMillion", "outputPerMillion", "cachedInputPerMillion", "requestUsd"]);
    for (const key of ["inputPerMillion", "outputPerMillion", ...Object.keys(pricing)]) {
      const rate = pricing[key];
      if (typeof rate !== "number" || !Number.isFinite(rate) || rate < 0)
        throw new Error(`Invalid ${key} price for ${id}`);
    }
  }
  return value as unknown as PricingSnapshot;
}
