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

describe("Sandbox live session websocket tool-policy", () => {
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

  it("returns a structured skipped result when an agent-requested tool is missing required input", async () => {
      const modelInputs: Array<Parameters<SandwichTextModelProvider["streamText"]>[0]> = [];
      let registryCalled = false;
      const moduleRef = await Test.createTestingModule({
        imports: [IntegrationsModule, SandboxLiveSessionsModule],
      })
        .overrideProvider("LIVE_SANDBOX_STT_PROVIDER")
        .useValue(createStreamingFakeSttProvider())
        .overrideProvider("LIVE_SANDBOX_TEXT_MODEL_PROVIDER")
        .useValue({
          async *streamText(input: Parameters<SandwichTextModelProvider["streamText"]>[0]) {
            modelInputs.push(input);

            if ((input.agentContext?.toolResults.length ?? 0) === 0) {
              yield JSON.stringify({
                type: "call_tool",
                toolCallId: "tool-call-missing-input",
                toolAssignmentId: "agent-front-desk:customer-profile-lookup",
                arguments: {},
                reason: "Caller asked for account context.",
              });
              return;
            }

            yield JSON.stringify({
              type: "respond",
              responseText: "Which customer ID should I use for the lookup?",
            });
          },
        } satisfies SandwichTextModelProvider)
        .overrideProvider("LIVE_SANDBOX_TTS_PROVIDER")
        .useValue(createFakeTtsProvider())
        .overrideProvider("LIVE_SANDBOX_TOOL_REGISTRY")
        .useValue({
          async execute() {
            registryCalled = true;
            return {
              summary: "Should not execute.",
              output: {},
            };
          },
        })
        .compile();

      const app: INestApplication = createTestingApplication(moduleRef);
      await app.listen(0);

      const service = moduleRef.get(SandboxLiveSessionsService);
      const manifest = createToolExecutionManifest("workspace-default");
      manifest.agentToolAssignments = manifest.agentToolAssignments.map((assignment) => ({
        ...assignment,
        inputSchema: {
          type: "object",
          required: ["customerId", "email"],
        },
        requiredInputs: ["customerId", "email"],
      }));
      const createResponse = await request(app.getHttpServer())
        .post("/organizations/tenant-west-africa/sandbox/live-sessions")
        .send({
          actorUserId: "user-ops-lead",
          workspaceId: "workspace-default",
          source: "draft",
          inputMode: "voice",
          entryAgentId: "agent-front-desk",
          manifest,
        });

      const sessionId = String(createResponse.body.session.sessionId);
      const token = String(createResponse.body.session.transportToken);
      const port = getListeningPort(app);
      const events: Array<Record<string, unknown>> = [];
      const unsubscribe = service.subscribeToSession(
        {
          organizationId: "tenant-west-africa",
          sessionId,
        },
        (event) => {
          events.push(event as unknown as Record<string, unknown>);
        },
      );
      const socket = new WebSocket(
        `ws://127.0.0.1:${port}/organizations/tenant-west-africa/sandbox/live-sessions/${sessionId}/stream?token=${encodeURIComponent(token)}&workspaceId=workspace-default&source=draft`,
      );
      sockets.push(socket);

      await withTimeout(nextOpen(socket), "websocket open");
      await settle();
      const completedEventPromise = nextMatchingMessage(
        socket,
        (event) => event.type === "turn.completed",
      );

      sendVoiceTurn(socket, "Can you check my customer profile?", { callPhase: "tool-use" });

      const completedEvent = await withTimeout(completedEventPromise, "missing-input tool turn completed");
      await settle();
      unsubscribe();

      expect(registryCalled).toBe(false);
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "tool.failed",
          payload: expect.objectContaining({
            nodeId: "agent-front-desk",
            status: "skipped",
            summary: "Missing required tool input: customerId, email.",
            error: expect.objectContaining({
              code: "tool_input.missing_required",
              recoverable: true,
            }),
          }),
        }),
      );
      expect(modelInputs[1]?.agentContext?.toolResults).toEqual([
        expect.objectContaining({
          status: "skipped",
          summary: "Missing required tool input: customerId, email.",
        }),
      ]);
      expect(completedEvent).toMatchObject({
        type: "turn.completed",
        payload: {
          responseText: "Which customer ID should I use for the lookup?",
        },
      });

      socket.close();
      await nextClose(socket);
      await app.close();
    }, 20_000);

  it("returns approval-required results without executing agent-requested tools", async () => {
      const modelInputs: Array<Parameters<SandwichTextModelProvider["streamText"]>[0]> = [];
      let registryCalled = false;
      const moduleRef = await Test.createTestingModule({
        imports: [IntegrationsModule, SandboxLiveSessionsModule],
      })
        .overrideProvider("LIVE_SANDBOX_STT_PROVIDER")
        .useValue(createStreamingFakeSttProvider())
        .overrideProvider("LIVE_SANDBOX_TEXT_MODEL_PROVIDER")
        .useValue({
          async *streamText(input: Parameters<SandwichTextModelProvider["streamText"]>[0]) {
            modelInputs.push(input);

            if ((input.agentContext?.toolResults.length ?? 0) === 0) {
              yield JSON.stringify({
                type: "call_tool",
                toolCallId: "tool-call-approval",
                toolAssignmentId: "agent-front-desk:customer-profile-lookup",
                arguments: {
                  customerId: "customer-123",
                  email: "francis@example.com",
                },
                reason: "Caller asked for account context.",
              });
              return;
            }

            yield JSON.stringify({
              type: "respond",
              responseText: "I need approval before I can run that lookup.",
            });
          },
        } satisfies SandwichTextModelProvider)
        .overrideProvider("LIVE_SANDBOX_TTS_PROVIDER")
        .useValue(createFakeTtsProvider())
        .overrideProvider("LIVE_SANDBOX_TOOL_REGISTRY")
        .useValue({
          async execute() {
            registryCalled = true;
            return {
              summary: "Should not execute.",
              output: {},
            };
          },
        })
        .compile();

      const app: INestApplication = createTestingApplication(moduleRef);
      await app.listen(0);

      const service = moduleRef.get(SandboxLiveSessionsService);
      const manifest = createToolExecutionManifest("workspace-default");
      const grantResponse = await request(app.getHttpServer())
        .post("/organizations/tenant-west-africa/integrations/tool-grants")
        .send({
          actorUserId: "user-ops-lead",
          actorRole: "admin",
          workspaceId: "workspace-default",
          agentId: "agent-front-desk",
          toolId: "hubspot.profile.lookup",
          integrationConnectionId: "hubspot-prod",
          risk: "high",
          approvalRequired: true,
        });

      expect(grantResponse.status).toBe(201);

      const createResponse = await request(app.getHttpServer())
        .post("/organizations/tenant-west-africa/sandbox/live-sessions")
        .send({
          actorUserId: "user-ops-lead",
          workspaceId: "workspace-default",
          source: "draft",
          inputMode: "voice",
          entryAgentId: "agent-front-desk",
          manifest,
        });

      const sessionId = String(createResponse.body.session.sessionId);
      const token = String(createResponse.body.session.transportToken);
      const port = getListeningPort(app);
      const events: Array<Record<string, unknown>> = [];
      const unsubscribe = service.subscribeToSession(
        {
          organizationId: "tenant-west-africa",
          sessionId,
        },
        (event) => {
          events.push(event as unknown as Record<string, unknown>);
        },
      );
      const socket = new WebSocket(
        `ws://127.0.0.1:${port}/organizations/tenant-west-africa/sandbox/live-sessions/${sessionId}/stream?token=${encodeURIComponent(token)}&workspaceId=workspace-default&source=draft`,
      );
      sockets.push(socket);

      await withTimeout(nextOpen(socket), "websocket open");
      await settle();
      const completedEventPromise = nextMatchingMessage(
        socket,
        (event) => event.type === "turn.completed",
      );

      sendVoiceTurn(socket, "Can you check my customer profile?", { callPhase: "tool-use" });

      const completedEvent = await withTimeout(completedEventPromise, "approval tool turn completed");
      await settle();
      unsubscribe();

      expect(registryCalled).toBe(false);
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "tool.approval_required",
          payload: expect.objectContaining({
            nodeId: "agent-front-desk",
            toolId: "hubspot.profile.lookup",
            status: "approval_required",
            summary: "Tool 'Customer profile API' requires human approval before execution.",
            error: expect.objectContaining({
              code: "tool_approval.required",
              recoverable: true,
            }),
          }),
        }),
      );
      expect(modelInputs[1]?.agentContext?.toolResults).toEqual([
        expect.objectContaining({
          status: "approval_required",
          summary: "Tool 'Customer profile API' requires human approval before execution.",
        }),
      ]);
      expect(completedEvent).toMatchObject({
        type: "turn.completed",
        payload: {
          responseText: "I need approval before I can run that lookup.",
        },
      });

      socket.close();
      await nextClose(socket);
      await app.close();
    }, 20_000);

  it("returns a recoverable timeout failure when an agent-requested tool times out", async () => {
      const modelInputs: Array<Parameters<SandwichTextModelProvider["streamText"]>[0]> = [];
      const moduleRef = await Test.createTestingModule({
        imports: [IntegrationsModule, SandboxLiveSessionsModule],
      })
        .overrideProvider("LIVE_SANDBOX_STT_PROVIDER")
        .useValue(createStreamingFakeSttProvider())
        .overrideProvider("LIVE_SANDBOX_TEXT_MODEL_PROVIDER")
        .useValue({
          async *streamText(input: Parameters<SandwichTextModelProvider["streamText"]>[0]) {
            modelInputs.push(input);

            if ((input.agentContext?.toolResults.length ?? 0) === 0) {
              yield JSON.stringify({
                type: "call_tool",
                toolCallId: "tool-call-timeout",
                toolAssignmentId: "agent-front-desk:customer-profile-lookup",
                arguments: {
                  customerId: "customer-123",
                  email: "francis@example.com",
                },
                reason: "Caller asked for account context.",
              });
              return;
            }

            yield JSON.stringify({
              type: "respond",
              responseText: "The lookup timed out, so I can try again later or continue without it.",
            });
          },
        } satisfies SandwichTextModelProvider)
        .overrideProvider("LIVE_SANDBOX_TTS_PROVIDER")
        .useValue(createFakeTtsProvider())
        .overrideProvider("LIVE_SANDBOX_TOOL_REGISTRY")
        .useValue({
          async execute() {
            throw new Error("Live sandbox tool 'hubspot.profile.lookup' timed out after 100ms.");
          },
        })
        .compile();

      const app: INestApplication = createTestingApplication(moduleRef);
      await app.listen(0);

      const service = moduleRef.get(SandboxLiveSessionsService);
      const manifest = createToolExecutionManifest("workspace-default");
      const grantResponse = await request(app.getHttpServer())
        .post("/organizations/tenant-west-africa/integrations/tool-grants")
        .send({
          actorUserId: "user-ops-lead",
          actorRole: "admin",
          workspaceId: "workspace-default",
          agentId: "agent-front-desk",
          toolId: "hubspot.profile.lookup",
          integrationConnectionId: "hubspot-prod",
          risk: "medium",
          approvalRequired: false,
        });

      expect(grantResponse.status).toBe(201);

      const createResponse = await request(app.getHttpServer())
        .post("/organizations/tenant-west-africa/sandbox/live-sessions")
        .send({
          actorUserId: "user-ops-lead",
          workspaceId: "workspace-default",
          source: "draft",
          inputMode: "voice",
          entryAgentId: "agent-front-desk",
          manifest,
        });

      const sessionId = String(createResponse.body.session.sessionId);
      const token = String(createResponse.body.session.transportToken);
      const port = getListeningPort(app);
      const events: Array<Record<string, unknown>> = [];
      const unsubscribe = service.subscribeToSession(
        {
          organizationId: "tenant-west-africa",
          sessionId,
        },
        (event) => {
          events.push(event as unknown as Record<string, unknown>);
        },
      );
      const socket = new WebSocket(
        `ws://127.0.0.1:${port}/organizations/tenant-west-africa/sandbox/live-sessions/${sessionId}/stream?token=${encodeURIComponent(token)}&workspaceId=workspace-default&source=draft`,
      );
      sockets.push(socket);

      await withTimeout(nextOpen(socket), "websocket open");
      await settle();
      const completedEventPromise = nextMatchingMessage(
        socket,
        (event) => event.type === "turn.completed",
      );

      sendVoiceTurn(socket, "Can you check my customer profile?", { callPhase: "tool-use" });

      const completedEvent = await withTimeout(completedEventPromise, "timeout tool turn completed");
      await settle();
      unsubscribe();

      expect(events).toContainEqual(
        expect.objectContaining({
          type: "tool.failed",
          payload: expect.objectContaining({
            nodeId: "agent-front-desk",
            status: "failed",
            summary: "Tool 'Customer profile API' timed out.",
            error: expect.objectContaining({
              code: "tool_execution.timeout",
              recoverable: true,
            }),
          }),
        }),
      );
      expect(modelInputs[1]?.agentContext?.toolResults).toEqual([
        expect.objectContaining({
          status: "failed",
          summary: "Tool 'Customer profile API' timed out.",
        }),
      ]);
      expect(completedEvent).toMatchObject({
        type: "turn.completed",
        payload: {
          responseText: "The lookup timed out, so I can try again later or continue without it.",
        },
      });

      socket.close();
      await nextClose(socket);
      await app.close();
    }, 20_000);

  it("publishes runtime failures after a streaming transcript instead of stalling silently", async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [IntegrationsModule, SandboxLiveSessionsModule],
      })
        .overrideProvider("LIVE_SANDBOX_STT_PROVIDER")
        .useValue(createStreamingFakeSttProvider())
        .overrideProvider("LIVE_SANDBOX_STT_PROVIDER")
        .useValue(createStreamingFakeSttProvider())
        .overrideProvider("LIVE_SANDBOX_TEXT_MODEL_PROVIDER")
        .useValue(createFailingTextModelProvider())
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
      const transcribedEventPromise = nextMatchingMessage(
        socket,
        (event) => event.type === "turn.transcribed",
      );
      const diagnosticEventPromise = nextMatchingMessage(
        socket,
        (event) => event.type === "quality.flagged",
      );
      const completedEventPromise = nextMatchingMessage(
        socket,
        (event) => event.type === "turn.completed",
      );
      const modelTelemetryEventPromise = nextMatchingMessage(
        socket,
        (event) => {
          const payload = event.payload as Record<string, unknown>;
          return event.type === "provider.telemetry" && payload.stage === "model";
        },
      );

      socket.send(
        JSON.stringify({
          type: "input.audio.append",
          audioBase64: Buffer.from("I need help with billing", "utf8").toString("base64"),
          sampleRateHz: 16000,
          callPhase: "discovery",
        }),
      );

      const transcribedEvent = await withTimeout(transcribedEventPromise, "streaming transcribed event");
      const diagnosticEvent = await withTimeout(diagnosticEventPromise, "streaming runtime failure event");
      const completedEvent = await withTimeout(completedEventPromise, "streaming degraded completion event");
      const modelTelemetryEvent = await withTimeout(modelTelemetryEventPromise, "streaming degraded model telemetry event");

      expect(transcribedEvent).toMatchObject({
        type: "turn.transcribed",
        payload: {
          transcript: "I need help with billing",
        },
      });
      expect(diagnosticEvent).toMatchObject({
        type: "quality.flagged",
        payload: {
          stage: "model",
          code: "failed",
          recoverable: true,
          message: "Live sandbox text model failed after transcription.",
        },
      });
      expect(completedEvent).toMatchObject({
        type: "turn.completed",
        payload: expect.objectContaining({
          degraded: true,
          failureStage: "model",
        }),
      });
      expect(modelTelemetryEvent).toMatchObject({
        type: "provider.telemetry",
        payload: expect.objectContaining({
          stage: "model",
          degraded: true,
          failureStage: "model",
        }),
      });

      socket.close();
      await nextClose(socket);
      await app.close();
    }, 20_000);

  it("configures AssemblyAI streaming prompts and carries agent reply context into the next turn", async () => {
      const sttProvider = createStreamingFakeSttProvider();
      const moduleRef = await Test.createTestingModule({
        imports: [IntegrationsModule, SandboxLiveSessionsModule],
      })
        .overrideProvider("LIVE_SANDBOX_STT_PROVIDER")
        .useValue(createStreamingFakeSttProvider())
        .overrideProvider("LIVE_SANDBOX_STT_PROVIDER")
        .useValue(sttProvider)
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
          manifest: createToolExecutionManifestWithStaleEntrySnapshot("workspace-default", {
            toolName: "Zendesk ticket lookup",
            toolLabel: "Zendesk support ticket",
          }),
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
      const completedEventPromise = nextMatchingMessage(
        socket,
        (event) => event.type === "turn.completed",
      );

      socket.send(
        JSON.stringify({
          type: "input.audio.append",
          audioBase64: Buffer.from("live-frame-1", "utf8").toString("base64"),
          sampleRateHz: 16000,
          callPhase: "discovery",
        }),
      );

      await withTimeout(completedEventPromise, "automatic voice completed event");

      expect(sttProvider.sessions[0]?.config).toMatchObject({
        languageCode: "fr",
        minTurnSilenceMs: 700,
        maxTurnSilenceMs: 2600,
        continuousPartials: true,
      });
      expect(sttProvider.sessions[0]?.config.keytermsPrompt).toEqual(
        expect.arrayContaining([
          "Front desk triage",
          "Tuzzy Labs",
          "Zendesk ticket lookup",
          "Zendesk support ticket",
        ]),
      );
      expect(sttProvider.sessions[0]?.config.keytermsPrompt).not.toContain("Stale Entry Snapshot");
      expect(sttProvider.sessions[0]?.updates.at(-1)).toMatchObject({
        agentContext: "Billing support is ready to help with that request.",
      });

      socket.close();
      await nextClose(socket);
      await app.close();
    }, 20_000);

  it("reports Cartesia Ink 2 in provider stack metadata when selected", async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [IntegrationsModule, SandboxLiveSessionsModule],
      })
        .overrideProvider("LIVE_SANDBOX_STT_PROVIDER")
        .useValue(createStreamingFakeSttProvider())
        .overrideProvider("LIVE_SANDBOX_STT_PROVIDER")
        .useValue(createCartesiaInkFakeSttProvider())
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

      expect(createResponse.status).toBe(201);
      expect(createResponse.body.session.providerStack).toMatchObject({
        stt: "cartesia-ink-2",
        tts: "cartesia-sonic-3",
      });

      await app.close();
    }, 20_000);

  it("blocks non-English workflows when Cartesia Ink 2 STT is selected", async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [IntegrationsModule, SandboxLiveSessionsModule],
      })
        .overrideProvider("LIVE_SANDBOX_STT_PROVIDER")
        .useValue(createStreamingFakeSttProvider())
        .overrideProvider("LIVE_SANDBOX_STT_PROVIDER")
        .useValue(createCartesiaInkFakeSttProvider())
        .overrideProvider("LIVE_SANDBOX_TEXT_MODEL_PROVIDER")
        .useValue(createFakeTextModelProvider())
        .overrideProvider("LIVE_SANDBOX_TTS_PROVIDER")
        .useValue(createFakeTtsProvider())
        .compile();

      const app: INestApplication = createTestingApplication(moduleRef);
      await app.listen(0);
      const manifest = withAgentRoleConfig(createCompiledManifest("workspace-default"), "agent-front-desk", {
        languagePolicy: {
          defaultLanguage: "en",
          supportedLanguages: ["en", "es"],
          allowMidCallSwitching: true,
        },
      });

      const createResponse = await request(app.getHttpServer())
        .post("/organizations/tenant-west-africa/sandbox/live-sessions")
        .send({
          actorUserId: "user-ops-lead",
          workspaceId: "workspace-default",
          source: "draft",
          inputMode: "voice",
          entryAgentId: "agent-front-desk",
          manifest,
        });

      expect(createResponse.status).toBe(409);
      expect(JSON.stringify(createResponse.body)).toContain("Cartesia Ink 2 STT is English-only");

      await app.close();
    }, 20_000);

  it("marks post-send side-effect timeouts as unknown and blocks blind retry", async () => {
      const modelInputs: Array<Parameters<SandwichTextModelProvider["streamText"]>[0]> = [];
      const moduleRef = await Test.createTestingModule({
        imports: [IntegrationsModule, SandboxLiveSessionsModule],
      })
        .overrideProvider("LIVE_SANDBOX_STT_PROVIDER")
        .useValue(createStreamingFakeSttProvider())
        .overrideProvider("LIVE_SANDBOX_TEXT_MODEL_PROVIDER")
        .useValue({
          async *streamText(input: Parameters<SandwichTextModelProvider["streamText"]>[0]) {
            modelInputs.push(input);

            if ((input.agentContext?.toolResults.length ?? 0) === 0) {
              yield JSON.stringify({
                type: "call_tool",
                toolCallId: "tool-call-ticket-create",
                toolAssignmentId: "agent-front-desk:customer-profile-lookup",
                arguments: {
                  contactId: "contact-123",
                  body: "Follow up with Francis about the billing request.",
                },
                reason: "Caller needs a follow-up ticket.",
              });
              return;
            }

            yield JSON.stringify({
              type: "respond",
              responseText: "The ticket write may have reached the provider, so I will not retry it automatically.",
            });
          },
        } satisfies SandwichTextModelProvider)
        .overrideProvider("LIVE_SANDBOX_TTS_PROVIDER")
        .useValue(createFakeTtsProvider())
        .overrideProvider("LIVE_SANDBOX_TOOL_REGISTRY")
        .useValue({
          async execute() {
            const error = new Error("Zendesk request timed out after provider accepted the write.");
            (error as Error & { sideEffectRequestSent?: boolean }).sideEffectRequestSent = true;
            throw error;
          },
        })
        .compile();

      const app: INestApplication = createTestingApplication(moduleRef);
      await app.listen(0);

      const service = moduleRef.get(SandboxLiveSessionsService);
      const manifest = createToolExecutionManifest("workspace-default", {
        toolId: "hubspot.notes.create",
        toolLabel: "HubSpot note writer",
        toolName: "HubSpot note writer",
        connector: "hubspot",
      });
      const grantResponse = await request(app.getHttpServer())
        .post("/organizations/tenant-west-africa/integrations/tool-grants")
        .send({
          actorUserId: "user-ops-lead",
          actorRole: "admin",
          workspaceId: "workspace-default",
          agentId: "agent-front-desk",
          toolId: "hubspot.notes.create",
          integrationConnectionId: "hubspot-prod",
          risk: "medium",
          approvalRequired: false,
        });

      expect(grantResponse.status).toBe(201);

      const createResponse = await request(app.getHttpServer())
        .post("/organizations/tenant-west-africa/sandbox/live-sessions")
        .send({
          actorUserId: "user-ops-lead",
          workspaceId: "workspace-default",
          source: "draft",
          inputMode: "voice",
          entryAgentId: "agent-front-desk",
          manifest,
        });

      const sessionId = String(createResponse.body.session.sessionId);
      const token = String(createResponse.body.session.transportToken);
      const port = getListeningPort(app);
      const events: Array<Record<string, unknown>> = [];
      const unsubscribe = service.subscribeToSession(
        {
          organizationId: "tenant-west-africa",
          sessionId,
        },
        (event) => {
          events.push(event as unknown as Record<string, unknown>);
        },
      );
      const socket = new WebSocket(
        `ws://127.0.0.1:${port}/organizations/tenant-west-africa/sandbox/live-sessions/${sessionId}/stream?token=${encodeURIComponent(token)}&workspaceId=workspace-default&source=draft`,
      );
      sockets.push(socket);

      await withTimeout(nextOpen(socket), "websocket open");
      await settle();
      const completedEventPromise = nextMatchingMessage(
        socket,
        (event) => event.type === "turn.completed",
      );

      sendVoiceTurn(socket, "Please create a follow-up ticket.", { callPhase: "tool-use" });

      const completedEvent = await withTimeout(completedEventPromise, "unknown side-effect turn completed");
      await settle();
      unsubscribe();

      const sideEffectEvents = events.filter((event) => event.type === "integration.side_effect.recorded");
      expect(sideEffectEvents).toEqual([
        expect.objectContaining({
          payload: expect.objectContaining({
            status: "pending",
            provider: "hubspot",
            toolCallId: "tool-call-ticket-create",
            toolId: "hubspot.notes.create",
            integrationConnectionId: "hubspot-prod",
            retryPosture: "in_progress",
            idempotencyKey: expect.any(String),
          }),
        }),
        expect.objectContaining({
          payload: expect.objectContaining({
            status: "unknown",
            provider: "hubspot",
            toolCallId: "tool-call-ticket-create",
            toolId: "hubspot.notes.create",
            integrationConnectionId: "hubspot-prod",
            retryPosture: "manual_review_required",
            idempotencyKey: expect.any(String),
          }),
        }),
      ]);
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "tool.failed",
          payload: expect.objectContaining({
            status: "failed",
            summary: "Tool 'HubSpot note writer' has an unknown provider write outcome.",
            error: expect.objectContaining({
              code: "tool_execution.side_effect_unknown",
              recoverable: true,
            }),
          }),
        }),
      );
      expect(modelInputs[1]?.agentContext?.toolResults).toEqual([
        expect.objectContaining({
          status: "failed",
          summary: "Tool 'HubSpot note writer' has an unknown provider write outcome.",
        }),
      ]);
      expect(completedEvent).toMatchObject({
        type: "turn.completed",
        payload: {
          responseText: "The ticket write may have reached the provider, so I will not retry it automatically.",
        },
      });

      socket.close();
      await nextClose(socket);
      await app.close();
    }, 20_000);

  it("returns a recoverable rate-limit failure when an agent-requested tool is rate limited", async () => {
      const modelInputs: Array<Parameters<SandwichTextModelProvider["streamText"]>[0]> = [];
      const moduleRef = await Test.createTestingModule({
        imports: [IntegrationsModule, SandboxLiveSessionsModule],
      })
        .overrideProvider("LIVE_SANDBOX_STT_PROVIDER")
        .useValue(createStreamingFakeSttProvider())
        .overrideProvider("LIVE_SANDBOX_TEXT_MODEL_PROVIDER")
        .useValue({
          async *streamText(input: Parameters<SandwichTextModelProvider["streamText"]>[0]) {
            modelInputs.push(input);

            if ((input.agentContext?.toolResults.length ?? 0) === 0) {
              yield JSON.stringify({
                type: "call_tool",
                toolCallId: "tool-call-rate-limit",
                toolAssignmentId: "agent-front-desk:customer-profile-lookup",
                arguments: {
                  customerId: "customer-123",
                  email: "francis@example.com",
                },
                reason: "Caller asked for account context.",
              });
              return;
            }

            yield JSON.stringify({
              type: "respond",
              responseText: "The lookup is rate limited right now, so I can continue without it or retry later.",
            });
          },
        } satisfies SandwichTextModelProvider)
        .overrideProvider("LIVE_SANDBOX_TTS_PROVIDER")
        .useValue(createFakeTtsProvider())
        .overrideProvider("LIVE_SANDBOX_TOOL_REGISTRY")
        .useValue({
          async execute() {
            throw new Error("Provider returned HTTP 429 rate limit.");
          },
        })
        .compile();

      const app: INestApplication = createTestingApplication(moduleRef);
      await app.listen(0);

      const service = moduleRef.get(SandboxLiveSessionsService);
      const manifest = createToolExecutionManifest("workspace-default");
      const grantResponse = await request(app.getHttpServer())
        .post("/organizations/tenant-west-africa/integrations/tool-grants")
        .send({
          actorUserId: "user-ops-lead",
          actorRole: "admin",
          workspaceId: "workspace-default",
          agentId: "agent-front-desk",
          toolId: "hubspot.profile.lookup",
          integrationConnectionId: "hubspot-prod",
          risk: "medium",
          approvalRequired: false,
        });

      expect(grantResponse.status).toBe(201);

      const createResponse = await request(app.getHttpServer())
        .post("/organizations/tenant-west-africa/sandbox/live-sessions")
        .send({
          actorUserId: "user-ops-lead",
          workspaceId: "workspace-default",
          source: "draft",
          inputMode: "voice",
          entryAgentId: "agent-front-desk",
          manifest,
        });

      const sessionId = String(createResponse.body.session.sessionId);
      const token = String(createResponse.body.session.transportToken);
      const port = getListeningPort(app);
      const events: Array<Record<string, unknown>> = [];
      const unsubscribe = service.subscribeToSession(
        {
          organizationId: "tenant-west-africa",
          sessionId,
        },
        (event) => {
          events.push(event as unknown as Record<string, unknown>);
        },
      );
      const socket = new WebSocket(
        `ws://127.0.0.1:${port}/organizations/tenant-west-africa/sandbox/live-sessions/${sessionId}/stream?token=${encodeURIComponent(token)}&workspaceId=workspace-default&source=draft`,
      );
      sockets.push(socket);

      await withTimeout(nextOpen(socket), "websocket open");
      await settle();
      const completedEventPromise = nextMatchingMessage(
        socket,
        (event) => event.type === "turn.completed",
      );

      sendVoiceTurn(socket, "Can you check my customer profile?", { callPhase: "tool-use" });

      const completedEvent = await withTimeout(completedEventPromise, "rate-limit tool turn completed");
      await settle();
      unsubscribe();

      expect(events).toContainEqual(
        expect.objectContaining({
          type: "tool.failed",
          payload: expect.objectContaining({
            nodeId: "agent-front-desk",
            status: "failed",
            summary: "Tool 'Customer profile API' was rate limited.",
            error: expect.objectContaining({
              code: "tool_execution.rate_limited",
              recoverable: true,
            }),
          }),
        }),
      );
      expect(modelInputs[1]?.agentContext?.toolResults).toEqual([
        expect.objectContaining({
          status: "failed",
          summary: "Tool 'Customer profile API' was rate limited.",
        }),
      ]);
      expect(completedEvent).toMatchObject({
        type: "turn.completed",
        payload: {
          responseText: "The lookup is rate limited right now, so I can continue without it or retry later.",
        },
      });

      socket.close();
      await nextClose(socket);
      await app.close();
    }, 20_000);

  it("returns partial tool results with safe output to the same agent", async () => {
      const modelInputs: Array<Parameters<SandwichTextModelProvider["streamText"]>[0]> = [];
      const moduleRef = await Test.createTestingModule({
        imports: [IntegrationsModule, SandboxLiveSessionsModule],
      })
        .overrideProvider("LIVE_SANDBOX_STT_PROVIDER")
        .useValue(createStreamingFakeSttProvider())
        .overrideProvider("LIVE_SANDBOX_TEXT_MODEL_PROVIDER")
        .useValue({
          async *streamText(input: Parameters<SandwichTextModelProvider["streamText"]>[0]) {
            modelInputs.push(input);

            if ((input.agentContext?.toolResults.length ?? 0) === 0) {
              yield JSON.stringify({
                type: "call_tool",
                toolCallId: "tool-call-partial",
                toolAssignmentId: "agent-front-desk:customer-profile-lookup",
                arguments: {
                  customerId: "customer-123",
                  email: "francis@example.com",
                },
                reason: "Caller asked for account context.",
              });
              return;
            }

            yield JSON.stringify({
              type: "respond",
              responseText: "I found the active profile, but billing history is unavailable right now.",
            });
          },
        } satisfies SandwichTextModelProvider)
        .overrideProvider("LIVE_SANDBOX_TTS_PROVIDER")
        .useValue(createFakeTtsProvider())
        .overrideProvider("LIVE_SANDBOX_TOOL_REGISTRY")
        .useValue({
          async execute() {
            return {
              status: "partial",
              summary: "Customer profile returned, but billing history was unavailable.",
              output: {
                status: "active",
                billingHistory: null,
                internalToken: "do-not-send",
              },
              safeOutput: {
                status: "active",
                warnings: ["billing_history_unavailable"],
              },
              durationMs: 55,
            };
          },
        })
        .compile();

      const app: INestApplication = createTestingApplication(moduleRef);
      await app.listen(0);

      const service = moduleRef.get(SandboxLiveSessionsService);
      const manifest = createToolExecutionManifest("workspace-default");
      const grantResponse = await request(app.getHttpServer())
        .post("/organizations/tenant-west-africa/integrations/tool-grants")
        .send({
          actorUserId: "user-ops-lead",
          actorRole: "admin",
          workspaceId: "workspace-default",
          agentId: "agent-front-desk",
          toolId: "hubspot.profile.lookup",
          integrationConnectionId: "hubspot-prod",
          risk: "medium",
          approvalRequired: false,
        });

      expect(grantResponse.status).toBe(201);

      const createResponse = await request(app.getHttpServer())
        .post("/organizations/tenant-west-africa/sandbox/live-sessions")
        .send({
          actorUserId: "user-ops-lead",
          workspaceId: "workspace-default",
          source: "draft",
          inputMode: "voice",
          entryAgentId: "agent-front-desk",
          manifest,
        });

      const sessionId = String(createResponse.body.session.sessionId);
      const token = String(createResponse.body.session.transportToken);
      const port = getListeningPort(app);
      const events: Array<Record<string, unknown>> = [];
      const unsubscribe = service.subscribeToSession(
        {
          organizationId: "tenant-west-africa",
          sessionId,
        },
        (event) => {
          events.push(event as unknown as Record<string, unknown>);
        },
      );
      const socket = new WebSocket(
        `ws://127.0.0.1:${port}/organizations/tenant-west-africa/sandbox/live-sessions/${sessionId}/stream?token=${encodeURIComponent(token)}&workspaceId=workspace-default&source=draft`,
      );
      sockets.push(socket);

      await withTimeout(nextOpen(socket), "websocket open");
      await settle();
      const completedEventPromise = nextMatchingMessage(
        socket,
        (event) => event.type === "turn.completed",
      );

      sendVoiceTurn(socket, "Can you check my customer profile and billing history?", { callPhase: "tool-use" });

      const completedEvent = await withTimeout(completedEventPromise, "partial tool turn completed");
      await settle();
      unsubscribe();

      expect(events).toContainEqual(
        expect.objectContaining({
          type: "tool.completed",
          payload: expect.objectContaining({
            nodeId: "agent-front-desk",
            status: "partial",
            summary: "Customer profile returned, but billing history was unavailable.",
            safeOutput: {
              status: "active",
              warnings: ["billing_history_unavailable"],
            },
            durationMs: 55,
          }),
        }),
      );
      expect(modelInputs[1]?.agentContext?.toolResults).toEqual([
        {
          toolName: "Customer profile lookup",
          status: "partial",
          summary: "Customer profile returned, but billing history was unavailable.",
          safeOutput: {
            status: "active",
            warnings: ["billing_history_unavailable"],
          },
        },
      ]);
      expect(JSON.stringify(modelInputs[1]?.agentContext)).not.toContain("do-not-send");
      expect(completedEvent).toMatchObject({
        type: "turn.completed",
        payload: {
          responseText: "I found the active profile, but billing history is unavailable right now.",
        },
      });

      socket.close();
      await nextClose(socket);
      await app.close();
    }, 20_000);

  it("does not check grants for assigned tools until the agent requests a tool", async () => {
      let registryCalled = false;
      const moduleRef = await Test.createTestingModule({
        imports: [IntegrationsModule, SandboxLiveSessionsModule],
      })
        .overrideProvider("LIVE_SANDBOX_STT_PROVIDER")
        .useValue(createStreamingFakeSttProvider())
        .overrideProvider("LIVE_SANDBOX_TEXT_MODEL_PROVIDER")
        .useValue(createFakeTextModelProvider())
        .overrideProvider("LIVE_SANDBOX_TTS_PROVIDER")
        .useValue(createFakeTtsProvider())
        .overrideProvider("LIVE_SANDBOX_TOOL_REGISTRY")
        .useValue({
          async execute() {
            registryCalled = true;
            return {
              summary: "This tool should not have run.",
              output: {
                ok: true,
              },
              durationMs: 12,
            };
          },
        })
        .compile();

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
          manifest: createToolExecutionManifest("workspace-default"),
        });

      const sessionId = String(createResponse.body.session.sessionId);
      const token = String(createResponse.body.session.transportToken);
      const port = getListeningPort(app);
      const events: Array<Record<string, unknown>> = [];
      const unsubscribe = service.subscribeToSession(
        {
          organizationId: "tenant-west-africa",
          sessionId,
        },
        (event) => {
          events.push(event as unknown as Record<string, unknown>);
        },
      );
      const socket = new WebSocket(
        `ws://127.0.0.1:${port}/organizations/tenant-west-africa/sandbox/live-sessions/${sessionId}/stream?token=${encodeURIComponent(token)}&workspaceId=workspace-default&source=draft`,
      );
      sockets.push(socket);

      await withTimeout(nextOpen(socket), "websocket open");
      await settle();
      const completedEventPromise = nextMatchingMessage(
        socket,
        (event) => event.type === "turn.completed",
      );

      sendVoiceTurn(socket, "Please look up the customer profile before routing this billing call.", { callPhase: "tool-use" });

      await withTimeout(completedEventPromise, "toolbelt turn completed");
      await settle();
      unsubscribe();

      expect(registryCalled).toBe(false);
      expect(events.some((event) => event.type === "tool.failed")).toBe(false);
      expect(events.some((event) => event.type === "tool.approval_required")).toBe(false);
      expect(events).not.toContainEqual(
        expect.objectContaining({
          type: "tool.completed",
        }),
      );

      socket.close();
      await nextClose(socket);
      await app.close();
    }, 20_000);

  it("does not request human approval for high-risk tools until the agent requests a tool", async () => {
      let registryCalled = false;
      const moduleRef = await Test.createTestingModule({
        imports: [IntegrationsModule, SandboxLiveSessionsModule],
      })
        .overrideProvider("LIVE_SANDBOX_STT_PROVIDER")
        .useValue(createStreamingFakeSttProvider())
        .overrideProvider("LIVE_SANDBOX_TEXT_MODEL_PROVIDER")
        .useValue(createFakeTextModelProvider())
        .overrideProvider("LIVE_SANDBOX_TTS_PROVIDER")
        .useValue(createFakeTtsProvider())
        .overrideProvider("LIVE_SANDBOX_TOOL_REGISTRY")
        .useValue({
          async execute() {
            registryCalled = true;
            return {
              summary: "This high-risk tool should wait for approval.",
              output: {
                ok: true,
              },
              durationMs: 15,
            };
          },
        })
        .compile();

      const app: INestApplication = createTestingApplication(moduleRef);
      await app.listen(0);

      const service = moduleRef.get(SandboxLiveSessionsService);
      const manifest = createToolExecutionManifest("workspace-default");
      const grantResponse = await request(app.getHttpServer())
        .post("/organizations/tenant-west-africa/integrations/tool-grants")
        .send({
          actorUserId: "user-ops-lead",
          actorRole: "admin",
          workspaceId: "workspace-default",
          agentId: "agent-front-desk",
          toolId: "hubspot.profile.lookup",
          integrationConnectionId: "hubspot-prod",
          risk: "high",
          approvalRequired: true,
        });

      expect(grantResponse.status).toBe(201);

      const createResponse = await request(app.getHttpServer())
        .post("/organizations/tenant-west-africa/sandbox/live-sessions")
        .send({
          actorUserId: "user-ops-lead",
          workspaceId: "workspace-default",
          source: "draft",
          inputMode: "voice",
          entryAgentId: "agent-front-desk",
          manifest,
        });

      const sessionId = String(createResponse.body.session.sessionId);
      const token = String(createResponse.body.session.transportToken);
      const port = getListeningPort(app);
      const events: Array<Record<string, unknown>> = [];
      const unsubscribe = service.subscribeToSession(
        {
          organizationId: "tenant-west-africa",
          sessionId,
        },
        (event) => {
          events.push(event as unknown as Record<string, unknown>);
        },
      );
      const socket = new WebSocket(
        `ws://127.0.0.1:${port}/organizations/tenant-west-africa/sandbox/live-sessions/${sessionId}/stream?token=${encodeURIComponent(token)}&workspaceId=workspace-default&source=draft`,
      );
      sockets.push(socket);

      await withTimeout(nextOpen(socket), "websocket open");
      await settle();
      const completedEventPromise = nextMatchingMessage(
        socket,
        (event) => event.type === "turn.completed",
      );

      sendVoiceTurn(socket, "Please look up the customer profile before routing this billing call.", { callPhase: "tool-use" });

      await withTimeout(completedEventPromise, "high-risk toolbelt turn completed");
      await settle();
      unsubscribe();

      expect(registryCalled).toBe(false);
      expect(events.some((event) => event.type === "tool.approval_required")).toBe(false);
      expect(events.some((event) => event.type === "tool.started")).toBe(false);
      expect(events).not.toContainEqual(
        expect.objectContaining({
          type: "tool.completed",
        }),
      );

      socket.close();
      await nextClose(socket);
      await app.close();
    }, 20_000);
});
