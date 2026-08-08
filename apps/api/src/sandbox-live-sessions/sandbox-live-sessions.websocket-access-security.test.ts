import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import {
  compileRuntimeManifest,
  createAgentRoleNode,
  createConditionNode,
  createEndNode,
  createWorkflowGraph,
  publishWorkflowVersion,
  type CompiledRuntimeManifest,
  type ModelRoutingContext,
  type ModelRoutingRule,
  type RuntimeAgentDefinition,
  type SandwichTextModelProvider,
  type SandwichTtsProvider,
} from "@zara/core";
import WebSocket, { type RawData } from "ws";
import { IntegrationsModule } from "../integrations/integrations.module";
import { SandboxLiveSessionsModule } from "./sandbox-live-sessions.module";
import { SandboxLiveSessionsService } from "./sandbox-live-sessions.service";
import { runtimeObservabilityRecorderToken } from "../runtime-observability/runtime-observability";
import { installTestTenantAuth } from "../testing/tenant-auth-request";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { routingRules, createTestingApplication, seedSandboxIntegrationState, getListeningPort, readPayloadString, nextMatchingMessage, nextOpen, settle, withTimeout, nextClose, sendVoiceTurn, createCompiledManifest, createAgentRoutePolicyManifest, ensureWorkspaceAccess, createConditionAgentRouteManifest, createConditionAgentRouteManifestWithStaleBillingSnapshot, withAgentRoleConfig, createToolExecutionManifest, createToolExecutionManifestWithStaleEntrySnapshot, createFakeTextModelProvider, createFailingTextModelProvider, createTextModelProviderWithAvailability, createFakeTtsProvider, createDelayedAudioTtsProvider, createFakeSttProvider, createStreamingFakeSttProvider, createDuplicateFinalStreamingSttProvider, createScriptedStreamingSttProvider, createFailingStreamingSttProvider, createCartesiaLifecycleStreamingSttProvider, createCartesiaInkFakeSttProvider } from "./sandbox-live-sessions.websocket.test-support";

describe("Sandbox live session websocket access-security", () => {
  const sockets: WebSocket[] = [];

  const originalIntegrationStateDir = process.env.ZARA_INTEGRATION_STATE_DIR;

  const originalOpenAiApiKey = process.env.OPENAI_API_KEY;

  const originalAssemblyAiApiKey = process.env.ASSEMBLYAI_API_KEY;

  const originalCartesiaApiKey = process.env.CARTESIA_API_KEY;

  beforeEach(() => {
      const integrationStateDir = join(
        tmpdir(),
        "zara-sandbox-tool-grants",
        randomUUID(),
      );
      process.env.ZARA_INTEGRATION_STATE_DIR = integrationStateDir;
      process.env.OPENAI_API_KEY = "test-openai-key";
      process.env.ASSEMBLYAI_API_KEY = "test-assemblyai-key";
      process.env.CARTESIA_API_KEY = "test-cartesia-key";
      seedSandboxIntegrationState(integrationStateDir);
    });

  afterEach(() => {
      while (sockets.length > 0) {
        const socket = sockets.pop();
        socket?.close();
      }

      if (originalIntegrationStateDir === undefined) {
        delete process.env.ZARA_INTEGRATION_STATE_DIR;
      } else {
        process.env.ZARA_INTEGRATION_STATE_DIR = originalIntegrationStateDir;
      }

      if (originalOpenAiApiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = originalOpenAiApiKey;
      }

      if (originalAssemblyAiApiKey === undefined) {
        delete process.env.ASSEMBLYAI_API_KEY;
      } else {
        process.env.ASSEMBLYAI_API_KEY = originalAssemblyAiApiKey;
      }

      if (originalCartesiaApiKey === undefined) {
        delete process.env.CARTESIA_API_KEY;
      } else {
        process.env.CARTESIA_API_KEY = originalCartesiaApiKey;
      }
    });

  it("streams session events to a valid transport token", async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [IntegrationsModule, SandboxLiveSessionsModule],
      })
        .overrideProvider("LIVE_SANDBOX_STT_PROVIDER")
        .useValue(createStreamingFakeSttProvider()).compile();

      const app: INestApplication = createTestingApplication(moduleRef);
      await app.listen(0);

      const service = moduleRef.get(SandboxLiveSessionsService);
      const createResponse = await request(app.getHttpServer())
        .post("/organizations/tenant-west-africa/sandbox/live-sessions")
        .send({
          actorUserId: "user-ops-lead",
          workspaceId: "workspace-default",
          source: "draft",
          inputMode: "voice",
          entryAgentId: "agent-front-desk",
          manifest: createCompiledManifest("workspace-default"),
        });

      const sessionId = String(createResponse.body.session.sessionId);
      const token = String(createResponse.body.session.transportToken);
      const port = getListeningPort(app);
      const socket = new WebSocket(
        `ws://127.0.0.1:${port}/organizations/tenant-west-africa/sandbox/live-sessions/${sessionId}/stream?token=${encodeURIComponent(token)}`,
      );
      sockets.push(socket);

      await withTimeout(nextOpen(socket), "websocket open");
      await settle();
      const transcriptEventPromise = nextMatchingMessage(
        socket,
        (event) => event.type === "turn.transcribed",
      );

      service.publishSessionEvent({
        organizationId: "tenant-west-africa",
        sessionId,
        type: "turn.transcribed",
        payload: {
          transcript: "hello from the caller",
        },
      });

      const transcriptEvent = await withTimeout(transcriptEventPromise, "turn.transcribed event");

      expect(transcriptEvent).toMatchObject({
        type: "turn.transcribed",
        sessionId,
        payload: {
          transcript: "hello from the caller",
        },
      });

      socket.close();
      await nextClose(socket);
      await app.close();
    }, 20_000);

  it("rejects websocket connections with an invalid transport token", async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [IntegrationsModule, SandboxLiveSessionsModule],
      })
        .overrideProvider("LIVE_SANDBOX_STT_PROVIDER")
        .useValue(createStreamingFakeSttProvider()).compile();

      const app: INestApplication = createTestingApplication(moduleRef);
      await app.listen(0);

      const createResponse = await request(app.getHttpServer())
        .post("/organizations/tenant-west-africa/sandbox/live-sessions")
        .send({
          actorUserId: "user-ops-lead",
          workspaceId: "workspace-default",
          source: "draft",
          inputMode: "voice",
          entryAgentId: "agent-front-desk",
          manifest: createCompiledManifest("workspace-default"),
        });

      const sessionId = String(createResponse.body.session.sessionId);
      const port = getListeningPort(app);
      const socket = new WebSocket(
        `ws://127.0.0.1:${port}/organizations/tenant-west-africa/sandbox/live-sessions/${sessionId}/stream?token=bad-token`,
      );
      sockets.push(socket);

      const closeEvent = await nextClose(socket);

      expect(closeEvent.code).toBe(4403);

      await app.close();
    }, 20_000);

  it("rejects retired typed websocket input", async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [IntegrationsModule, SandboxLiveSessionsModule],
      })
        .overrideProvider("LIVE_SANDBOX_STT_PROVIDER")
        .useValue(createStreamingFakeSttProvider("fr"))
        .overrideProvider("LIVE_SANDBOX_STT_PROVIDER")
        .useValue(createStreamingFakeSttProvider())
        .overrideProvider("LIVE_SANDBOX_TEXT_MODEL_PROVIDER")
        .useValue(createFakeTextModelProvider())
        .overrideProvider("LIVE_SANDBOX_TTS_PROVIDER")
        .useValue(createFakeTtsProvider())
        .compile();

      const app: INestApplication = createTestingApplication(moduleRef);
      await app.listen(0);

      const createResponse = await request(app.getHttpServer())
        .post("/organizations/tenant-west-africa/sandbox/live-sessions")
        .send({
          actorUserId: "user-ops-lead",
          workspaceId: "workspace-default",
          source: "draft",
          inputMode: "voice",
          entryAgentId: "agent-front-desk",
          manifest: createCompiledManifest("workspace-default"),
        });

      const sessionId = String(createResponse.body.session.sessionId);
      const token = String(createResponse.body.session.transportToken);
      const port = getListeningPort(app);
      const socket = new WebSocket(
        `ws://127.0.0.1:${port}/organizations/tenant-west-africa/sandbox/live-sessions/${sessionId}/stream?token=${encodeURIComponent(token)}`,
      );
      sockets.push(socket);

      await withTimeout(nextOpen(socket), "websocket open");
      await settle();
      socket.send(
        JSON.stringify({
          type: "input.text",
          transcript: "I need help with billing",
          callPhase: "discovery",
        }),
      );

      await expect(withTimeout(nextClose(socket), "typed input rejection")).resolves.toEqual({
        code: 4400,
        reason: "unsupported_message_type",
      });

      await app.close();
    }, 20_000);

  it("rejects replayed websocket transport tokens and audits the attempt", async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [IntegrationsModule, SandboxLiveSessionsModule],
      })
        .overrideProvider("LIVE_SANDBOX_STT_PROVIDER")
        .useValue(createStreamingFakeSttProvider()).compile();

      const app: INestApplication = createTestingApplication(moduleRef);
      await app.listen(0);

      const service = moduleRef.get(SandboxLiveSessionsService);
      const createResponse = await request(app.getHttpServer())
        .post("/organizations/tenant-west-africa/sandbox/live-sessions")
        .send({
          actorUserId: "user-ops-lead",
          workspaceId: "workspace-default",
          source: "draft",
          inputMode: "voice",
          entryAgentId: "agent-front-desk",
          manifest: createCompiledManifest("workspace-default"),
        });

      const sessionId = String(createResponse.body.session.sessionId);
      const token = String(createResponse.body.session.transportToken);
      const port = getListeningPort(app);
      const firstSocket = new WebSocket(
        `ws://127.0.0.1:${port}/organizations/tenant-west-africa/sandbox/live-sessions/${sessionId}/stream?token=${encodeURIComponent(token)}&workspaceId=workspace-default&source=draft`,
      );
      sockets.push(firstSocket);
      await withTimeout(nextOpen(firstSocket), "first websocket open");

      const replaySocket = new WebSocket(
        `ws://127.0.0.1:${port}/organizations/tenant-west-africa/sandbox/live-sessions/${sessionId}/stream?token=${encodeURIComponent(token)}&workspaceId=workspace-default&source=draft`,
      );
      sockets.push(replaySocket);

      const closeEvent = await nextClose(replaySocket);
      const audits = (service as unknown as {
        getTransportSecurityAudits(): Array<{ reason: string; sessionId: string }>;
      }).getTransportSecurityAudits();

      expect(closeEvent.code).toBe(4403);
      expect(audits).toContainEqual(
        expect.objectContaining({
          sessionId,
          reason: "token_replay",
        }),
      );

      firstSocket.close();
      await nextClose(firstSocket);
      await app.close();
    }, 20_000);

  it("rejects expired or cross-workspace websocket tokens and audits both attempts", async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [IntegrationsModule, SandboxLiveSessionsModule],
      })
        .overrideProvider("LIVE_SANDBOX_STT_PROVIDER")
        .useValue(createStreamingFakeSttProvider()).compile();

      const app: INestApplication = createTestingApplication(moduleRef);
      await app.listen(0);

      const service = moduleRef.get(SandboxLiveSessionsService);
      const createResponse = await request(app.getHttpServer())
        .post("/organizations/tenant-west-africa/sandbox/live-sessions")
        .send({
          actorUserId: "user-ops-lead",
          workspaceId: "workspace-default",
          source: "draft",
          inputMode: "voice",
          entryAgentId: "agent-front-desk",
          manifest: createCompiledManifest("workspace-default"),
          now: "2020-05-16T00:00:00.000Z",
          ttlMinutes: 0,
        });

      const sessionId = String(createResponse.body.session.sessionId);
      const token = String(createResponse.body.session.transportToken);
      const port = getListeningPort(app);
      const expiredSocket = new WebSocket(
        `ws://127.0.0.1:${port}/organizations/tenant-west-africa/sandbox/live-sessions/${sessionId}/stream?token=${encodeURIComponent(token)}&workspaceId=workspace-default&source=draft`,
      );
      sockets.push(expiredSocket);

      const expiredCloseEvent = await nextClose(expiredSocket);

      const freshResponse = await request(app.getHttpServer())
        .post("/organizations/tenant-west-africa/sandbox/live-sessions")
        .send({
          actorUserId: "user-ops-lead",
          workspaceId: "workspace-default",
          source: "draft",
          inputMode: "voice",
          entryAgentId: "agent-front-desk",
          manifest: createCompiledManifest("workspace-default"),
        });

      const freshSessionId = String(freshResponse.body.session.sessionId);
      const freshToken = String(freshResponse.body.session.transportToken);
      const workspaceMismatchSocket = new WebSocket(
        `ws://127.0.0.1:${port}/organizations/tenant-west-africa/sandbox/live-sessions/${freshSessionId}/stream?token=${encodeURIComponent(freshToken)}&workspaceId=workspace-other&source=draft`,
      );
      sockets.push(workspaceMismatchSocket);

      const mismatchCloseEvent = await nextClose(workspaceMismatchSocket);
      const audits = (service as unknown as {
        getTransportSecurityAudits(): Array<{ reason: string; sessionId: string }>;
      }).getTransportSecurityAudits();

      expect(expiredCloseEvent.code).toBe(4403);
      expect(mismatchCloseEvent.code).toBe(4403);
      expect(audits).toContainEqual(
        expect.objectContaining({
          sessionId,
          reason: "token_expired",
        }),
      );
      expect(audits).toContainEqual(
        expect.objectContaining({
          sessionId: freshSessionId,
          reason: "workspace_scope_mismatch",
        }),
      );

      await app.close();
    }, 20_000);
});
