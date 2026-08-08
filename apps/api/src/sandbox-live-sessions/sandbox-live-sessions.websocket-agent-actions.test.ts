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

describe("Sandbox live session websocket agent-actions", () => {
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

  it("does not execute assigned live tools unless the agent requests them", async () => {
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
          async execute(bindingInput: {
            binding: { nodeId: string; toolId: string; toolName: string };
            transcript: string;
          }) {
            registryCalled = true;
            return {
              summary: `Executed ${bindingInput.binding.toolName} for ${bindingInput.transcript}.`,
              output: {
                ok: true,
              },
              durationMs: 42,
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

      sendVoiceTurn(socket, "Please look up the customer profile before routing this billing call.", { callPhase: "tool-use" });

      await withTimeout(completedEventPromise, "tool turn completed");
      await settle();
      unsubscribe();

      expect(registryCalled).toBe(false);
      expect(events.some((event) => event.type === "tool.started")).toBe(false);
      expect(events.some((event) => event.type === "tool.requested")).toBe(false);
      expect(events.some((event) => event.type === "tool.completed")).toBe(false);
      expect(events.some((event) => event.type === "tool.failed")).toBe(false);
      expect(events.some((event) => event.type === "tool.approval_required")).toBe(false);
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "turn.cost.delta",
          payload: expect.objectContaining({
            currency: "USD",
          }),
        }),
      );
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "provider.telemetry",
          payload: expect.objectContaining({
            stage: "tts",
            provider: "cartesia-sonic-3",
          }),
        }),
      );
      const toolTransitionEvent = events.find(
        (event) =>
          event.type === "node.transition"
          && (event.payload as Record<string, unknown>)["nodeId"] === "agent-front-desk:customer-profile-lookup",
      );
      expect(toolTransitionEvent).toBeUndefined();

      expect(events).toContainEqual(
        expect.objectContaining({
          type: "agent.selected",
          payload: expect.objectContaining({
            turnId: expect.any(String),
            activeAgentId: "agent-front-desk",
            packetSequence: expect.any(Number),
          }),
        }),
      );
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "routing.model_selected",
          payload: expect.objectContaining({
            turnId: expect.any(String),
            packetSequence: expect.any(Number),
          }),
        }),
      );

      socket.close();
      await nextClose(socket);
      await app.close();
    }, 20_000);

  it("runs agents with an explicit empty toolbelt as normal response turns", async () => {
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
            yield "I can help with that request.";
          },
        } satisfies SandwichTextModelProvider)
        .overrideProvider("LIVE_SANDBOX_TTS_PROVIDER")
        .useValue(createFakeTtsProvider())
        .overrideProvider("LIVE_SANDBOX_TOOL_REGISTRY")
        .useValue({
          async execute() {
            registryCalled = true;
            return {
              summary: "Unexpected tool execution.",
              output: {
                ok: false,
              },
            };
          },
        })
        .compile();

      const app: INestApplication = createTestingApplication(moduleRef);
      await app.listen(0);

      const service = moduleRef.get(SandboxLiveSessionsService);
      const manifest = createCompiledManifest("workspace-default");
      expect(manifest.agentToolAssignments).toEqual([]);

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

      sendVoiceTurn(socket, "Can you answer this without looking anything up?", { callPhase: "greeting" });

      const completedEvent = await withTimeout(completedEventPromise, "empty toolbelt turn completed");
      await settle();
      unsubscribe();

      expect(registryCalled).toBe(false);
      expect(modelInputs).toHaveLength(1);
      expect(modelInputs[0]?.agentActionMode).toBe(false);
      expect(modelInputs[0]?.agentContext?.availableActions).toEqual([]);
      expect(completedEvent).toMatchObject({
        type: "turn.completed",
        payload: {
          responseText: "I can help with that request.",
        },
      });
      expect(events.some((event) => String(event.type).startsWith("tool."))).toBe(false);

      socket.close();
      await nextClose(socket);
      await app.close();
    }, 20_000);

  it("hands off only when a handoff-capable agent emits a handoff action", async () => {
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

            if (input.activeAgent.agentId === "agent-billing") {
              yield "Billing specialist can help with that invoice now.";
              return;
            }

            expect(input.agentActionMode).toBe(true);
            expect(input.agentContext?.availableActions).toEqual([
              expect.objectContaining({
                kind: "internal_handoff",
                targets: [
                  expect.objectContaining({
                    targetAgentId: "agent-billing",
                    targetAgentName: "Billing specialist",
                  }),
                ],
              }),
            ]);
            yield JSON.stringify({
              type: "handoff_to_agent",
              targetAgentId: "agent-billing",
              reason: "Caller needs invoice status support.",
              callerNeedSummary: "Caller wants the status of a pending invoice.",
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
              summary: "Unexpected connector execution.",
              output: {},
            };
          },
        })
        .compile();

      const app: INestApplication = createTestingApplication(moduleRef);
      await app.listen(0);

      ensureWorkspaceAccess(moduleRef.get(WorkspacesService));
      const service = moduleRef.get(SandboxLiveSessionsService);
      const manifest = createAgentRoutePolicyManifest("workspace-default");
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

      expect(createResponse.status).toBe(201);
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
      const firstCompletedEventPromise = nextMatchingMessage(
        socket,
        (event) => event.type === "turn.completed",
      );
      const handoffEventPromise = nextMatchingMessage(
        socket,
        (event) => event.type === "agent.handoff.completed",
      );

      sendVoiceTurn(socket, "My name is Francis. I need the status of a pending invoice.", { callPhase: "discovery" });

      const handoffEvent = await withTimeout(handoffEventPromise, "handoff action event");
      const firstCompletedEvent = await withTimeout(firstCompletedEventPromise, "handoff action completed");

      expect(firstCompletedEvent).toMatchObject({
        type: "turn.completed",
        payload: {
          responseText: "I'll connect you with Billing specialist.",
        },
      });
      expect(handoffEvent).toMatchObject({
        type: "agent.handoff.completed",
        payload: {
          nodeId: "agent-front-desk",
          sourceAgentId: "agent-front-desk",
          targetAgentId: "agent-billing",
          targetAgentName: "Billing specialist",
        },
      });
      expect(registryCalled).toBe(false);
      expect(events.some((event) => String(event.type).startsWith("tool."))).toBe(false);

      const secondCompletedEventPromise = nextMatchingMessage(
        socket,
        (event) => event.type === "turn.completed"
          && typeof event.payload === "object"
          && event.payload !== null
          && (event.payload as { responseText?: unknown }).responseText
            === "Billing specialist can help with that invoice now.",
      );

      sendVoiceTurn(socket, "The invoice is INV-1042.", { callPhase: "tool-use" });

      const secondCompletedEvent = await withTimeout(secondCompletedEventPromise, "routed target turn completed");
      await settle();
      unsubscribe();

      expect(secondCompletedEvent).toMatchObject({
        type: "turn.completed",
        payload: {
          responseText: "Billing specialist can help with that invoice now.",
        },
      });
      expect(modelInputs[0]?.activeAgent.agentId).toBe("agent-front-desk");
      expect(modelInputs[0]?.agentActionMode).toBe(true);
      expect(modelInputs[1]?.activeAgent.agentId).toBe("agent-billing");
      expect(modelInputs[1]?.agentActionMode).toBe(false);

      socket.close();
      await nextClose(socket);
      await app.close();
    }, 20_000);

  it("executes one agent-requested tool call and returns safe results to the same agent", async () => {
      const modelInputs: Array<Parameters<SandwichTextModelProvider["streamText"]>[0]> = [];
      let registryInput: Record<string, unknown> | undefined;
      const moduleRef = await Test.createTestingModule({
        imports: [IntegrationsModule, SandboxLiveSessionsModule],
      })
        .overrideProvider("LIVE_SANDBOX_STT_PROVIDER")
        .useValue(createStreamingFakeSttProvider())
        .overrideProvider("LIVE_SANDBOX_TEXT_MODEL_PROVIDER")
        .useValue({
          async *streamText(input: Parameters<SandwichTextModelProvider["streamText"]>[0]) {
            modelInputs.push(input);

            if (input.agentActionMode === true && (input.agentContext?.toolResults.length ?? 0) === 0) {
              yield JSON.stringify({
                type: "call_tool",
                toolCallId: "tool-call-customer-profile-1",
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
              responseText: "Customer profile is active and billing support is ready to help.",
            });
          },
        } satisfies SandwichTextModelProvider)
        .overrideProvider("LIVE_SANDBOX_TTS_PROVIDER")
        .useValue(createFakeTtsProvider())
        .overrideProvider("LIVE_SANDBOX_TOOL_REGISTRY")
        .useValue({
          async execute(input: Record<string, unknown>) {
            registryInput = input;
            return {
              summary: "Customer profile is active.",
              output: {
                status: "active",
                internalToken: "do-not-send",
              },
              safeOutput: {
                status: "active",
              },
              durationMs: 42,
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

      sendVoiceTurn(socket, "Can you check my customer profile before billing helps me?", { callPhase: "tool-use" });

      const completedEvent = await withTimeout(completedEventPromise, "agent-requested tool turn completed");
      await settle();
      unsubscribe();

      expect(registryInput).toMatchObject({
        toolCallId: "tool-call-customer-profile-1",
        arguments: {
          customerId: "customer-123",
          email: "francis@example.com",
        },
      });
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "tool.requested",
          payload: expect.objectContaining({
            nodeId: "agent-front-desk",
            toolCallId: "tool-call-customer-profile-1",
            toolAssignmentId: "agent-front-desk:customer-profile-lookup",
          }),
        }),
      );
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "tool.started",
          payload: expect.objectContaining({
            nodeId: "agent-front-desk",
            toolId: "hubspot.profile.lookup",
            toolName: "Customer profile lookup",
          }),
        }),
      );
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "tool.completed",
          payload: expect.objectContaining({
            nodeId: "agent-front-desk",
            toolId: "hubspot.profile.lookup",
            summary: "Customer profile is active.",
            safeOutput: {
              status: "active",
            },
            durationMs: 42,
          }),
        }),
      );
      expect(completedEvent).toMatchObject({
        type: "turn.completed",
        payload: {
          responseText: "Customer profile is active and billing support is ready to help.",
        },
      });
      expect(modelInputs).toHaveLength(2);
      expect(modelInputs[0]?.agentContext?.availableActions).toEqual([
        expect.objectContaining({
          kind: "agent_tool",
          toolAssignmentId: "agent-front-desk:customer-profile-lookup",
          label: "Customer profile API",
        }),
      ]);
      expect(modelInputs[1]?.agentContext?.toolResults).toEqual([
        {
          toolName: "Customer profile lookup",
          status: "completed",
          summary: "Customer profile is active.",
          safeOutput: {
            status: "active",
          },
        },
      ]);
      expect(JSON.stringify(modelInputs[1]?.agentContext)).not.toContain("do-not-send");

      socket.close();
      await nextClose(socket);
      await app.close();
    }, 20_000);

  it("answers closing turns naturally when action-mode output is empty structured JSON", async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [IntegrationsModule, SandboxLiveSessionsModule],
      })
        .overrideProvider("LIVE_SANDBOX_STT_PROVIDER")
        .useValue(createStreamingFakeSttProvider())
        .overrideProvider("LIVE_SANDBOX_TEXT_MODEL_PROVIDER")
        .useValue({
          async *streamText(input: Parameters<SandwichTextModelProvider["streamText"]>[0]) {
            expect(input.agentActionMode).toBe(true);
            yield "{";
          },
        } satisfies SandwichTextModelProvider)
        .overrideProvider("LIVE_SANDBOX_TTS_PROVIDER")
        .useValue(createFakeTtsProvider())
        .overrideProvider("LIVE_SANDBOX_TOOL_REGISTRY")
        .useValue({
          async execute() {
            throw new Error("Closing turn should not execute tools.");
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

      sendVoiceTurn(socket, "Thank you, that will be all.", { callPhase: "closing" });

      const completedEvent = await withTimeout(completedEventPromise, "closing turn completed");
      await settle();
      unsubscribe();

      expect(completedEvent).toMatchObject({
        type: "turn.completed",
        payload: {
          responseText: "You're welcome. Have a great day.",
        },
      });
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "quality.flagged",
          payload: expect.objectContaining({
            stage: "model",
            code: "agent_action.invalid_json",
          }),
        }),
      );
      expect(events.some((event) => String(event.type).startsWith("tool."))).toBe(false);

      socket.close();
      await nextClose(socket);
      await app.close();
    }, 20_000);

  it("rejects unsupported structured agent commands instead of speaking raw JSON", async () => {
      const unsupportedCommand = JSON.stringify({
        type: "handoff",
        target: "agent-billing",
      });
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
            yield unsupportedCommand;
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

      sendVoiceTurn(socket, "Please send me straight to billing.", { callPhase: "tool-use" });

      const completedEvent = await withTimeout(completedEventPromise, "invalid agent command completed");
      await settle();
      unsubscribe();

      const replayResponse = await request(app.getHttpServer()).get(
        `/organizations/tenant-west-africa/sandbox/live-sessions/${sessionId}/events`,
      );

      expect(registryCalled).toBe(false);
      expect(modelInputs).toHaveLength(1);
      expect(modelInputs[0]?.agentActionMode).toBe(true);
      expect(completedEvent).toMatchObject({
        type: "turn.completed",
        payload: {
          responseText: "I'm sorry, I had trouble responding just now. Could you try that again?",
        },
      });
      expect(JSON.stringify(completedEvent)).not.toContain(unsupportedCommand);
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "runtime.warning",
          payload: expect.objectContaining({
            code: "agent_action.invalid",
            recoverable: true,
            nodeId: "agent-front-desk",
            packetSequence: expect.any(Number),
          }),
        }),
      );
      expect(events.some((event) => String(event.type).startsWith("tool."))).toBe(false);
      expect(JSON.stringify(replayResponse.body.events)).not.toContain(unsupportedCommand);

      socket.close();
      await nextClose(socket);
      await app.close();
    }, 20_000);
});
