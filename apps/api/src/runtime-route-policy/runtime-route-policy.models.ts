export type RuntimeRoutePolicyReadinessMode =
  | "auto_with_clarification"
  | "agent_requested"
  | "required_slots";

export type RuntimeRoutePolicyAnnouncementMode = "template" | "none";

export type RuntimeRoutePolicyFallbackTarget =
  | "clarify_source_agent"
  | "human_escalation"
  | "exit";

export interface RuntimeRoutePolicy {
  schemaVersion: 1;
  version: number;
  confidenceThreshold: number;
  readinessMode: RuntimeRoutePolicyReadinessMode;
  maxClarificationTurns: number;
  announcementMode: RuntimeRoutePolicyAnnouncementMode;
  fallbackTarget: RuntimeRoutePolicyFallbackTarget;
  updatedBy: string;
  updatedAt: string;
}

export interface UpdateRuntimeRoutePolicyInput {
  expectedVersion: number;
  reason: string;
  confidenceThreshold?: number | undefined;
  readinessMode?: RuntimeRoutePolicyReadinessMode | undefined;
  maxClarificationTurns?: number | undefined;
  announcementMode?: RuntimeRoutePolicyAnnouncementMode | undefined;
  fallbackTarget?: RuntimeRoutePolicyFallbackTarget | undefined;
}

export const runtimeRoutePolicyReadinessModes = [
  "auto_with_clarification",
  "agent_requested",
  "required_slots",
] as const satisfies readonly RuntimeRoutePolicyReadinessMode[];

export const runtimeRoutePolicyAnnouncementModes = [
  "template",
  "none",
] as const satisfies readonly RuntimeRoutePolicyAnnouncementMode[];

export const runtimeRoutePolicyFallbackTargets = [
  "clarify_source_agent",
  "human_escalation",
  "exit",
] as const satisfies readonly RuntimeRoutePolicyFallbackTarget[];

export const defaultRuntimeRoutePolicy: RuntimeRoutePolicy = {
  schemaVersion: 1,
  version: 1,
  confidenceThreshold: 0.72,
  readinessMode: "auto_with_clarification",
  maxClarificationTurns: 2,
  announcementMode: "template",
  fallbackTarget: "clarify_source_agent",
  updatedBy: "system",
  updatedAt: "2026-06-16T00:00:00.000Z",
};
