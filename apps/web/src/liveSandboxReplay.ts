import type { LiveSandboxStreamEvent } from "./liveSandboxSessionApi";
import { summarizeLiveSandboxEvent } from "./liveSandboxEventFormatting";

export interface ReplayedLiveSandboxTranscriptEntry {
  id: string;
  speaker: "caller" | "agent" | "system";
  text: string;
  at: string;
}

export interface ReplayedLiveSandboxRoutingDecision {
  tier: string;
  provider?: string | undefined;
  modelId?: string | undefined;
  source: string;
  matchedRuleId?: string | undefined;
  reason: string;
}

export function buildTranscriptFromLiveSandboxEvents(
  events: LiveSandboxStreamEvent[],
): ReplayedLiveSandboxTranscriptEntry[] {
  const transcript: ReplayedLiveSandboxTranscriptEntry[] = [];

  for (const event of events) {
    if (event.type === "turn.transcribed" && typeof event.payload.transcript === "string") {
      transcript.push({
        id: `${event.sessionId}:${event.sequence}:caller`,
        speaker: "caller",
        text: event.payload.transcript,
        at: event.at,
      });
      continue;
    }

    if (event.type === "turn.completed" && typeof event.payload.responseText === "string") {
      transcript.push({
        id: `${event.sessionId}:${event.sequence}:agent`,
        speaker: "agent",
        text: event.payload.responseText,
        at: event.at,
      });
      continue;
    }

    if (event.type === "agent.handoff.completed") {
      const summary = summarizeLiveSandboxEvent(event);
      transcript.push({
        id: `${event.sessionId}:${event.sequence}:system`,
        speaker: "system",
        text: summary.title,
        at: event.at,
      });
    }
  }

  return transcript;
}

export function getLastRoutingDecisionFromLiveSandboxEvents(events: LiveSandboxStreamEvent[]) {
  const event = [...events]
    .reverse()
    .find(
      (candidate) =>
        candidate.type === "routing.model_selected"
        && typeof candidate.payload.tier === "string"
        && typeof candidate.payload.source === "string"
        && typeof candidate.payload.reason === "string",
    );

  if (event === undefined) {
    return null;
  }

  return {
    tier: event.payload.tier as string,
    ...(typeof event.payload.provider === "string" ? { provider: event.payload.provider } : {}),
    ...(typeof event.payload.modelId === "string" ? { modelId: event.payload.modelId } : {}),
    source: event.payload.source as string,
    ...(typeof event.payload.matchedRuleId === "string"
      ? { matchedRuleId: event.payload.matchedRuleId }
      : {}),
    reason: event.payload.reason as string,
  } satisfies ReplayedLiveSandboxRoutingDecision;
}

export function getLastFirstByteLatencyFromLiveSandboxEvents(events: LiveSandboxStreamEvent[]) {
  const event = [...events]
    .reverse()
    .find(
      (candidate) =>
        candidate.type === "turn.audio.first_byte" && typeof candidate.payload.latencyMs === "number",
    );

  return typeof event?.payload.latencyMs === "number" ? event.payload.latencyMs : undefined;
}

export function getLastCallLatencyFromLiveSandboxEvents(events: LiveSandboxStreamEvent[]) {
  const event = [...events]
    .reverse()
    .find(
      (candidate) =>
        candidate.type === "turn.latency.measured"
        && typeof candidate.payload.totalLatencyMs === "number",
    );

  return typeof event?.payload.totalLatencyMs === "number" ? event.payload.totalLatencyMs : undefined;
}

export function redactSensitiveMonitorText(text: string) {
  return text
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]")
    .replace(/\+?\d[\d\s().-]{7,}\d/g, "[redacted-phone]")
    .replace(/secret:\/\/[^\s]+/gi, "[redacted-secret]");
}
