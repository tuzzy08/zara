import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { CompiledRuntimeManifest } from "@zara/core";
import { createHash, randomBytes, randomUUID } from "node:crypto";

import { WorkspacesService } from "../workspaces/workspaces.service";
import type {
  CreateLiveSandboxSessionRequest,
  LiveSandboxProviderStack,
  LiveSandboxSessionRecord,
  LiveSandboxSessionResponse,
} from "./sandbox-live-sessions.models";

const liveSandboxProviderStack: LiveSandboxProviderStack = {
  stt: "assemblyai-streaming",
  tts: "cartesia-sonic-3",
};

const defaultTtlMinutes = 10;

@Injectable()
export class SandboxLiveSessionsService {
  private readonly sessionsByOrganizationId = new Map<string, Map<string, LiveSandboxSessionRecord>>();

  constructor(private readonly workspacesService: WorkspacesService) {}

  createSession(
    organizationId: string,
    input: CreateLiveSandboxSessionRequest,
  ): LiveSandboxSessionResponse {
    this.assertUserCanAccessWorkspace({
      organizationId,
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
    });
    this.assertManifestWorkspace(input.manifest, input.workspaceId);

    const createdAt = input.now ?? new Date().toISOString();
    const expiresAt = addMinutes(createdAt, input.ttlMinutes ?? defaultTtlMinutes);
    const sessionId = `sandbox-live-${randomUUID()}`;
    const transportToken = randomBytes(24).toString("base64url");
    const session: LiveSandboxSessionRecord = {
      sessionId,
      organizationId,
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      source: input.source,
      inputMode: input.inputMode,
      entryRoleId: input.entryRoleId,
      manifestId: input.manifest.manifestId,
      publishedVersionId: input.manifest.publishedVersionId,
      runtimeProfile: input.manifest.runtimeProfile,
      transportUrl: buildTransportUrl(organizationId, sessionId),
      transportTokenHash: hashTransportToken(transportToken),
      providerStack: liveSandboxProviderStack,
      createdAt,
      expiresAt,
      status: "ready",
    };

    const organizationSessions = this.getOrCreateOrganizationSessions(organizationId);
    organizationSessions.set(sessionId, session);

    return toSessionResponse(session, transportToken);
  }

  getSession(organizationId: string, sessionId: string): LiveSandboxSessionResponse {
    const session = this.requireSession(organizationId, sessionId);
    this.expireIfNeeded(session);
    return toSessionResponse(session);
  }

  endSession(input: {
    organizationId: string;
    sessionId: string;
    actorUserId: string;
    now?: string | undefined;
  }): LiveSandboxSessionResponse {
    const session = this.requireSession(input.organizationId, input.sessionId);
    this.assertUserCanAccessWorkspace({
      organizationId: input.organizationId,
      workspaceId: session.workspaceId,
      actorUserId: input.actorUserId,
    });
    this.expireIfNeeded(session);

    session.status = "ended";
    session.endedAt = input.now ?? new Date().toISOString();
    session.transportTokenHash = "";

    return toSessionResponse(session);
  }

  validateTransportToken(input: {
    organizationId: string;
    sessionId: string;
    token: string;
    now?: string | undefined;
  }): boolean {
    const session = this.sessionsByOrganizationId.get(input.organizationId)?.get(input.sessionId);

    if (session === undefined) {
      return false;
    }

    this.expireIfNeeded(session, input.now);

    if (session.status !== "ready" && session.status !== "active") {
      return false;
    }

    return hashTransportToken(input.token) === session.transportTokenHash;
  }

  private requireSession(organizationId: string, sessionId: string): LiveSandboxSessionRecord {
    const session = this.sessionsByOrganizationId.get(organizationId)?.get(sessionId);

    if (session === undefined) {
      throw new NotFoundException(`Live sandbox session '${sessionId}' was not found.`);
    }

    return session;
  }

  private getOrCreateOrganizationSessions(organizationId: string) {
    const existing = this.sessionsByOrganizationId.get(organizationId);

    if (existing !== undefined) {
      return existing;
    }

    const next = new Map<string, LiveSandboxSessionRecord>();
    this.sessionsByOrganizationId.set(organizationId, next);
    return next;
  }

  private assertUserCanAccessWorkspace(input: {
    organizationId: string;
    workspaceId: string;
    actorUserId: string;
  }) {
    const state = this.workspacesService.getWorkspaceState(input.organizationId);
    const workspaceExists = state.workspaces.some((workspace) => workspace.id === input.workspaceId);

    if (!workspaceExists) {
      throw new NotFoundException(`Workspace '${input.workspaceId}' was not found.`);
    }

    const hasMembership = state.memberships.some(
      (membership) =>
        membership.workspaceId === input.workspaceId &&
        membership.tenantId === input.organizationId &&
        membership.userId === input.actorUserId,
    );

    if (!hasMembership) {
      throw new ForbiddenException(
        `User '${input.actorUserId}' does not have access to workspace '${input.workspaceId}'.`,
      );
    }
  }

  private assertManifestWorkspace(manifest: CompiledRuntimeManifest, workspaceId: string) {
    if (manifest.workspaceId !== undefined && manifest.workspaceId !== workspaceId) {
      throw new ConflictException(
        `Sandbox manifest workspace '${manifest.workspaceId}' does not match requested workspace '${workspaceId}'.`,
      );
    }
  }

  private expireIfNeeded(session: LiveSandboxSessionRecord, now = new Date().toISOString()) {
    if (
      session.status !== "ended" &&
      Date.parse(session.expiresAt) <= Date.parse(now)
    ) {
      session.status = "expired";
      session.transportTokenHash = "";
    }
  }
}

function toSessionResponse(
  session: LiveSandboxSessionRecord,
  transportToken?: string,
): LiveSandboxSessionResponse {
  return {
    sessionId: session.sessionId,
    organizationId: session.organizationId,
    workspaceId: session.workspaceId,
    actorUserId: session.actorUserId,
    source: session.source,
    inputMode: session.inputMode,
    entryRoleId: session.entryRoleId,
    manifestId: session.manifestId,
    publishedVersionId: session.publishedVersionId,
    runtimeProfile: session.runtimeProfile,
    transportUrl: session.transportUrl,
    providerStack: {
      ...session.providerStack,
    },
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    status: session.status,
    ...(session.endedAt !== undefined ? { endedAt: session.endedAt } : {}),
    ...(transportToken !== undefined ? { transportToken } : {}),
  };
}

function hashTransportToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function addMinutes(at: string, minutes: number) {
  return new Date(Date.parse(at) + minutes * 60_000).toISOString();
}

function buildTransportUrl(organizationId: string, sessionId: string) {
  const apiUrl = new URL(process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:4010");
  apiUrl.protocol = apiUrl.protocol === "https:" ? "wss:" : "ws:";
  apiUrl.pathname = `/organizations/${organizationId}/sandbox/live-sessions/${sessionId}/stream`;
  apiUrl.search = "";
  apiUrl.hash = "";
  return apiUrl.toString();
}
