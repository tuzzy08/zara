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
