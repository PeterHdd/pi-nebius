import type { NebiusModel } from "../models.ts";

export interface Command {
  command: string;
  args: string[];
}
export interface BenchmarkDefinition {
  schemaVersion: 1;
  name: string;
  task: string;
  fixture: string;
  validationDirectory: string;
  validation: Command[];
  setup: Command[];
  timeout: number;
  validationTimeout: number;
  tools: string[];
  systemPrompt?: string;
  validationMode?: "none";
}
export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
  cachedInputPerMillion?: number;
  requestUsd?: number;
}
export interface PricingSnapshot {
  schemaVersion: 1;
  currency: "USD";
  asOf: string;
  source: string;
  models: Record<string, ModelPricing>;
}
export interface ReportedUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  reasoningTokens: number | null;
  totalTokens: number | null;
}
export interface RequestTrace {
  request: number;
  purpose: "agent" | "compaction";
  startedAtMs: number;
  endedAtMs: number | null;
  firstContentAtMs: number | null;
  status: number | null;
  requestId: string | null;
  servedModel: string | null;
  systemFingerprint: string | null;
  finishReason: string | null;
  usage: ReportedUsage | null;
  error: string | null;
  streamComplete: boolean;
}
export interface ToolTrace {
  id: string;
  name: string;
  startedAtMs: number | null;
  endedAtMs: number | null;
  isError: boolean | null;
  error: string | null;
}
export interface Observation {
  requests: RequestTrace[];
  tools: ToolTrace[];
  agentTurns: number;
  assistantMessages: number;
  toolCalls: number;
  toolCallsByType: Record<string, number>;
  compactions: number;
  retries: number;
  agentStartedAtMs: number | null;
  agentEndedAtMs: number | null;
  systemPromptHash: string | null;
  lastAssistantStopReason: string | null;
  errors: string[];
}
export interface CommandResult {
  command: Command;
  exitCode: number | null;
  signal: string | null;
  durationMs: number;
  timedOut: boolean;
  output: string;
  outputTruncated: boolean;
}
export type Failure =
  | "validation_failed"
  | "timeout"
  | "model_api_error"
  | "rate_limit"
  | "tool_error"
  | "agent_error"
  | "context_limit"
  | "cancelled"
  | "unknown";

export interface WorkerInput {
  definition: BenchmarkDefinition;
  model: NebiusModel;
  agentDir: string;
  apiKey: string;
}
export type WorkerMessage =
  | { type: "observation"; observation: Observation }
  | { type: "done"; error: string | null; effectiveSettings: Record<string, unknown> };

export interface TokenTotals {
  cumulativeInputTokens: number | null;
  cumulativeOutputTokens: number | null;
  cachedInputTokens: number | null;
  reasoningTokens: number | null;
  observedInputTokens: number;
  observedOutputTokens: number;
  requestsWithUsage: number;
  usageComplete: boolean;
  lastRequestInputTokens: number | null;
  finalContextSizeTokens: null;
  inputAmplification: null;
  inputAmplificationVsLastRequest: number | null;
}
export interface RunResult {
  schemaVersion: 1;
  id: string;
  benchmark: string;
  model: string;
  modelRevision: null;
  run: number;
  timestamp: string;
  success: boolean;
  failure: Failure | null;
  errors: string[];
  wallTimeMs: number;
  agentWallTimeMs: number;
  modelRequestWallTimeMs: number | null;
  toolExecutionTimeMs: number | null;
  timeToFirstContentMs: number | null;
  modelGenerationTimeMs: null;
  agentOverheadTimeMs: null;
  agentTurns: number;
  modelRequests: number;
  toolCalls: number;
  toolErrors: number;
  toolCallsByType: Record<string, number>;
  tokens: TokenTotals;
  estimatedCostUsd: number | null;
  observedEstimatedCostUsd: number | null;
  pricing: ModelPricing | null;
  validation: {
    checked?: boolean;
    passed: boolean;
    exitCode: number | null;
    durationMs: number;
    commands: CommandResult[];
  };
  setup: CommandResult[];
  observation: Observation;
  workspace: string;
  fixtureHash: string;
  finalWorkspaceHash: string | null;
  effectiveSettings: Record<string, unknown>;
}
export interface Distribution {
  count: number;
  missing: number;
  mean: number | null;
  median: number | null;
  min: number | null;
  max: number | null;
  standardDeviation: number | null;
}
export interface ModelAggregate {
  model: string;
  runs: number;
  successes: number;
  successRate: number | null;
  costUsd: Distribution;
  wallTimeMs: Distribution;
  inputTokens: Distribution;
  outputTokens: Distribution;
  turns: Distribution;
  toolCalls: Distribution;
}
export interface Results {
  schemaVersion: 1;
  status: "running" | "complete" | "cancelled";
  timestamp: string;
  metadata: Record<string, unknown>;
  definition: BenchmarkDefinition;
  pricing: PricingSnapshot | null;
  plannedRuns: number;
  runs: RunResult[];
  aggregates: ModelAggregate[];
}
