import type {
  CompiledRuntimeManifest,
  RuntimeProfileId,
} from "@zara/core";

import { requestJson } from "./apiClient";

export type LiveSandboxManifestSource = "draft" | "published";
export type LiveSandboxInputMode = "voice" | "typed";
export type LiveSandboxSessionStatus = "ready" | "active" | "ended" | "expired";

export interface LiveSandboxProviderStack {
  stt: "assemblyai-streaming";
  tts: "cartesia-sonic-3";
}

export interface LiveSandboxSession {
  sessionId: string;
  organizationId: string;
  workspaceId: string;
  actorUserId: string;
  source: LiveSandboxManifestSource;
  inputMode: LiveSandboxInputMode;
  entryRoleId: string;
  manifestId: string;
  publishedVersionId: string;
  runtimeProfile: RuntimeProfileId;
  transportUrl: string;
  providerStack: LiveSandboxProviderStack;
  createdAt: string;
  expiresAt: string;
  status: LiveSandboxSessionStatus;
  endedAt?: string | undefined;
  transportToken?: string | undefined;
}

export interface LiveSandboxStreamEvent {
  sessionId: string;
  sequence: number;
  type: string;
  at: string;
  payload: Record<string, unknown>;
}

export interface LiveSandboxSessionSummary {
  sessionId: string;
  workspaceId: string;
  source: LiveSandboxManifestSource;
  status: LiveSandboxSessionStatus;
  runtimeProfile: RuntimeProfileId;
  activeRoleName: string;
  runtimeTier: string;
  eventCount: number;
  turnCount: number;
  lastEventAt: string;
  lastEventType?: string | undefined;
  lastTranscriptPreview?: string | undefined;
}

export type LiveSandboxEscalationStatus =
  | "pending"
  | "accepted"
  | "declined"
  | "fallback_triggered";

export interface LiveSandboxEscalation {
  escalationId: string;
  organizationId: string;
  workspaceId: string;
  sessionId: string;
  nodeId: string;
  queueId?: string | undefined;
  queueName?: string | undefined;
  reason: string;
  requestedAt: string;
  slaDeadlineAt: string;
  status: LiveSandboxEscalationStatus;
  fallbackMode?: "callback" | "voicemail" | "ticket" | undefined;
  fallbackMessage?: string | undefined;
  acceptedByUserId?: string | undefined;
  declinedByUserId?: string | undefined;
  declineReason?: string | undefined;
  resolvedAt?: string | undefined;
  fallbackTriggeredAt?: string | undefined;
}

export async function createLiveSandboxSession(input: {
  organizationId: string;
  actorUserId: string;
  workspaceId: string;
  source: LiveSandboxManifestSource;
  inputMode: LiveSandboxInputMode;
  entryRoleId: string;
  manifest: CompiledRuntimeManifest;
}) {
  const response = await requestJson<{ session: LiveSandboxSession }>(
    `/organizations/${input.organizationId}/sandbox/live-sessions`,
    {
      method: "POST",
      body: JSON.stringify({
        actorUserId: input.actorUserId,
        workspaceId: input.workspaceId,
        source: input.source,
        inputMode: input.inputMode,
        entryRoleId: input.entryRoleId,
        manifest: input.manifest,
      }),
    },
  );

  return response.session;
}

export async function endLiveSandboxSession(input: {
  organizationId: string;
  sessionId: string;
  actorUserId: string;
}) {
  const response = await requestJson<{ session: LiveSandboxSession }>(
    `/organizations/${input.organizationId}/sandbox/live-sessions/${input.sessionId}/end`,
    {
      method: "POST",
      body: JSON.stringify({
        actorUserId: input.actorUserId,
      }),
    },
  );

  return response.session;
}

export async function reconnectLiveSandboxSession(input: {
  organizationId: string;
  sessionId: string;
  actorUserId: string;
}) {
  const response = await requestJson<{ session: LiveSandboxSession }>(
    `/organizations/${input.organizationId}/sandbox/live-sessions/${input.sessionId}/reconnect`,
    {
      method: "POST",
      body: JSON.stringify({
        actorUserId: input.actorUserId,
      }),
    },
  );

  return response.session;
}

export async function getLiveSandboxSession(input: {
  organizationId: string;
  sessionId: string;
}) {
  const response = await requestJson<{ session: LiveSandboxSession }>(
    `/organizations/${input.organizationId}/sandbox/live-sessions/${input.sessionId}`,
    {
      method: "GET",
    },
  );

  return response.session;
}

export async function getLiveSandboxSessionEvents(input: {
  organizationId: string;
  sessionId: string;
  afterSequence?: number | undefined;
}) {
  const searchParams = new URLSearchParams();

  if (input.afterSequence !== undefined) {
    searchParams.set("afterSequence", String(input.afterSequence));
  }

  const response = await requestJson<{ sessionId: string; events: LiveSandboxStreamEvent[] }>(
    `/organizations/${input.organizationId}/sandbox/live-sessions/${input.sessionId}/events${searchParams.size > 0 ? `?${searchParams.toString()}` : ""}`,
    {
      method: "GET",
    },
  );

  return response.events;
}

export async function listLiveSandboxEscalations(input: {
  organizationId: string;
  workspaceId?: string | undefined;
  now?: string | undefined;
}) {
  const searchParams = new URLSearchParams();

  if (input.workspaceId !== undefined) {
    searchParams.set("workspaceId", input.workspaceId);
  }

  if (input.now !== undefined) {
    searchParams.set("now", input.now);
  }

  const response = await requestJson<{ escalations: LiveSandboxEscalation[] }>(
    `/organizations/${input.organizationId}/sandbox/live-sessions/escalations${searchParams.size > 0 ? `?${searchParams.toString()}` : ""}`,
    {
      method: "GET",
    },
  );

  return response.escalations;
}

export async function acceptLiveSandboxEscalation(input: {
  organizationId: string;
  escalationId: string;
  actorUserId: string;
}) {
  const response = await requestJson<{ escalation: LiveSandboxEscalation }>(
    `/organizations/${input.organizationId}/sandbox/live-sessions/escalations/${input.escalationId}/accept`,
    {
      method: "POST",
      body: JSON.stringify({
        actorUserId: input.actorUserId,
      }),
    },
  );

  return response.escalation;
}

export async function declineLiveSandboxEscalation(input: {
  organizationId: string;
  escalationId: string;
  actorUserId: string;
  reason?: string | undefined;
}) {
  const response = await requestJson<{ escalation: LiveSandboxEscalation }>(
    `/organizations/${input.organizationId}/sandbox/live-sessions/escalations/${input.escalationId}/decline`,
    {
      method: "POST",
      body: JSON.stringify({
        actorUserId: input.actorUserId,
        ...(input.reason !== undefined ? { reason: input.reason } : {}),
      }),
    },
  );

  return response.escalation;
}

export async function listLiveSandboxSessions(input: {
  organizationId: string;
  workspaceId?: string | undefined;
  includeEnded?: boolean | undefined;
}) {
  const searchParams = new URLSearchParams();

  if (input.workspaceId !== undefined) {
    searchParams.set("workspaceId", input.workspaceId);
  }

  if (input.includeEnded === true) {
    searchParams.set("includeEnded", "true");
  }

  const response = await requestJson<{ sessions: LiveSandboxSessionSummary[] }>(
    `/organizations/${input.organizationId}/sandbox/live-sessions${searchParams.size > 0 ? `?${searchParams.toString()}` : ""}`,
    {
      method: "GET",
    },
  );

  return response.sessions;
}
