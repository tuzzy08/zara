import { describe, expect, it, vi } from "vitest";
import type {
  CompiledRuntimeManifest,
  PremiumRealtimeSession,
  RealtimeToolDeclaration,
  TurnRuntimePacket,
} from "@zara/core";
import type { PremiumRealtimeToolLoopService } from "./premium-realtime-tool-loop.service";
import { RuntimeSessionsService } from "./runtime-sessions.service";
import { defaultRuntimePromptPolicy } from "../runtime-prompt-policy/runtime-prompt-policy.models";
import { defaultPremiumRealtimeConversationPolicy } from "../premium-realtime-policy/premium-realtime-conversation-policy.models";
import { baseProviderMessageInput, createSession, testProviderConfig, basePacket, buildRoutePolicyManifest, removeRealtimeProviderFields, buildRoutePolicyManifestWithCatalogZendeskSchema, buildStaleRoutePolicyManifest, buildStaleRoleSnapshotRoutePolicyManifest, buildConcreteAgentConfigRoutePolicyManifest, buildGeminiRoutePolicyManifest, withTargetRealtimeConfig, withAgentRealtimeConfig, openAiHandoffMessage, openAiResponseDone, openAiResponseCreated, handoffResponseMetadata, buildRoutePolicyManifestWithFrontDeskTool, node, getDefaultBillingTemplate, createLoop } from "./runtime-sessions.service.test-support";

describe("RuntimeSessionsService handoff", () => {
  const declaration: RealtimeToolDeclaration = {
      name: "zara_zendesk_search_tickets_1234abcd",
      toolAssignmentId: "tool-ticket-search",
      toolId: "zendesk.search_tickets",
      label: "Search tickets",
      description: "Search tickets\nRisk: low.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
        },
        required: ["query"],
      },
    };

  it("handles OpenAI internal handoff tool calls without executing connector grants", async () => {
      const loop = createLoop();
      const service = new RuntimeSessionsService(loop);
      const manifest = buildRoutePolicyManifest();
      const session = await service.createRealtimeSession({
        manifest,
        activeAgentId: "agent-front",
        budgetAllowed: true,
        organizationId: "tenant-1",
        workspaceId: "workspace-customer-success",
        actorUserId: "user-1",
        now: "2026-06-14T09:30:00.000Z",
      });

      const result = await service.processProviderMessage({
        ...baseProviderMessageInput(),
        session,
        manifest,
        activeAgentId: "agent-front",
        transcript: "Francis needs invoice status help.",
        packet: basePacket(),
        rawProviderMessage: JSON.stringify({
          type: "response.done",
          response: {
            id: "response-1",
            status: "completed",
            output: [
              {
                type: "function_call",
                call_id: "provider-handoff-1",
                name: "zara_handoff_to_agent",
                arguments: JSON.stringify({
                  targetAgentId: "agent-billing",
                  reason: "Caller needs invoice status support.",
                  callerNeedSummary: "Francis wants the status of a pending invoice.",
                }),
              },
            ],
          },
        }),
      });

      expect(loop.processOpenAiProviderMessage).not.toHaveBeenCalled();
      expect(result.activeAgentId).toBeUndefined();
      expect(result.session).toBeUndefined();
      expect(result.routeEvents).toEqual([]);
      expect(result.packet).toBeDefined();
      expect(result.packet.intent).toBeUndefined();
      expect(result.packet.transfer).toBeUndefined();
      expect(result.providerMessages).toEqual([
        expect.objectContaining({
          type: "conversation.item.create",
          item: expect.objectContaining({
            type: "function_call_output",
            call_id: "provider-handoff-1",
          }),
        }),
        expect.objectContaining({
          type: "response.create",
          response: {
            instructions: "Say exactly this handoff message to the caller, then stop: \"I'll connect you with Billing specialist.\"",
            metadata: handoffResponseMetadata(),
          },
        }),
      ]);
      const handoffToolOutputMessage = result.providerMessages[0] as {
        item?: {
          output?: string;
        };
      };
      expect(JSON.parse(handoffToolOutputMessage.item?.output ?? "{}")).toMatchObject({
        status: "completed",
        targetAgentId: "agent-billing",
        activeAgentId: "agent-billing",
        callerNeedSummary: "Francis wants the status of a pending invoice.",
      });

      await service.processProviderMessage({
        ...baseProviderMessageInput(),
        session,
        manifest,
        activeAgentId: "agent-front",
        transcript: "Francis needs invoice status help.",
        packet: basePacket(),
        rawProviderMessage: openAiResponseCreated("response-announcement"),
      });

      const handoffResult = await service.processProviderMessage({
        ...baseProviderMessageInput(),
        session,
        manifest,
        activeAgentId: "agent-front",
        transcript: "Francis needs invoice status help.",
        packet: basePacket(),
        rawProviderMessage: JSON.stringify({
          type: "response.done",
          response: {
            id: "response-announcement",
            status: "completed",
            output: [
              {
                type: "message",
                content: [
                  {
                    type: "output_text",
                    text: "I'll connect you with Billing specialist.",
                  },
                ],
              },
            ],
          },
        }),
      });

      expect(handoffResult.activeAgentId).toBe("agent-billing");
      expect(handoffResult.session).toMatchObject({
        activeAgentId: "agent-billing",
        toolDeclarations: [
          expect.objectContaining({
            label: "Search invoices",
            toolId: "stripe.invoices.search",
          }),
        ],
      });
      expect(handoffResult.routeEvents).toEqual(expect.arrayContaining([
        {
          type: "agent.route.announcement",
          payload: {
            nodeId: "agent-front",
            targetAgentId: "agent-billing",
            text: "I'll connect you with Billing specialist.",
          },
        },
        {
          type: "agent.handoff.requested",
          payload: expect.objectContaining({
            sourceAgentId: "agent-front",
            targetAgentId: "agent-billing",
          }),
        },
      ]));
      expect(handoffResult.routeEvents?.some((event) => "targetRoleId" in event.payload)).toBe(false);
      expect(handoffResult.packet.intent).toMatchObject({
        matchedBranchId: "branch-billing",
        intentKey: "billing",
        targetNodeId: "agent-billing",
      });
      expect(handoffResult.packet.transfer).toMatchObject({
        sourceAgent: expect.objectContaining({
          id: "agent-front",
        }),
        targetAgent: expect.objectContaining({
          id: "agent-billing",
        }),
        callerNeedSummary: "Francis wants the status of a pending invoice.",
      });
      expect(handoffResult.providerMessages).toEqual([
        expect.objectContaining({
          type: "session.update",
          session: expect.objectContaining({
            instructions: expect.stringContaining("You are Billing specialist"),
            tools: [
              expect.objectContaining({
                description: expect.stringContaining("Search invoices"),
              }),
            ],
          }),
        }),
        expect.objectContaining({
          type: "response.create",
          response: {
            instructions: expect.stringContaining("The handoff acknowledgement was already spoken by the source agent. Do not repeat it."),
          },
        }),
      ]);
    });

  it("does not repeat the handoff announcement when the OpenAI handoff response already spoke one", async () => {
      const loop = createLoop();
      const service = new RuntimeSessionsService(loop);
      const manifest = buildRoutePolicyManifest();
      const session = await service.createRealtimeSession({
        manifest,
        activeAgentId: "agent-front",
        budgetAllowed: true,
        organizationId: "tenant-1",
        workspaceId: "workspace-customer-success",
        actorUserId: "user-1",
        now: "2026-06-14T09:30:00.000Z",
      });

      const result = await service.processProviderMessage({
        ...baseProviderMessageInput(),
        session,
        manifest,
        activeAgentId: "agent-front",
        transcript: "Francis needs invoice status help.",
        packet: basePacket(),
        rawProviderMessage: JSON.stringify({
          type: "response.done",
          response: {
            id: "response-1",
            status: "completed",
            output: [
              {
                type: "message",
                content: [
                  {
                    type: "output_text",
                    text: "I'll connect you with Billing specialist.",
                  },
                ],
              },
              {
                type: "function_call",
                call_id: "provider-handoff-1",
                name: "zara_handoff_to_agent",
                arguments: JSON.stringify({
                  targetAgentId: "agent-billing",
                  reason: "Caller confirmed billing support.",
                  callerNeedSummary: "Francis wants the status of a pending invoice.",
                }),
              },
            ],
          },
        }),
      });

      const routeContinuationMessage = result.providerMessages.find(
        (message): message is { type: "response.create"; response: { instructions?: string } } =>
          message.type === "response.create",
      );
      expect(routeContinuationMessage?.response.instructions).toContain(
        "The handoff acknowledgement was already spoken by the source agent. Do not repeat it.",
      );
      expect(routeContinuationMessage?.response.instructions).not.toContain(
        "Begin your response with this exact handoff sentence",
      );
      expect(routeContinuationMessage?.response.instructions).toContain(
        "Continue helping the caller as the active agent in this same response.",
      );
    });

  it("continues OpenAI handoffs with concrete agent config before stale role snapshots", async () => {
      const loop = createLoop();
      const service = new RuntimeSessionsService(loop);
      const manifest = buildConcreteAgentConfigRoutePolicyManifest();
      const session = await service.createRealtimeSession({
        manifest,
        activeAgentId: "agent-front",
        budgetAllowed: true,
        organizationId: "tenant-1",
        workspaceId: "workspace-customer-success",
        actorUserId: "user-1",
        now: "2026-06-14T09:30:00.000Z",
      });

      const result = await service.processProviderMessage({
        ...baseProviderMessageInput(),
        session,
        manifest,
        activeAgentId: "agent-front",
        transcript: "Francis needs invoice status help.",
        packet: basePacket(),
        rawProviderMessage: JSON.stringify({
          type: "response.done",
          response: {
            id: "response-1",
            status: "completed",
            output: [
              {
                type: "message",
                content: [
                  {
                    type: "output_text",
                    text: "I'll connect you with James Billing.",
                  },
                ],
              },
              {
                type: "function_call",
                call_id: "provider-handoff-1",
                name: "zara_handoff_to_agent",
                arguments: JSON.stringify({
                  targetAgentId: "agent-billing",
                  reason: "Caller needs invoice status support.",
                  callerNeedSummary: "Francis wants the status of a pending invoice.",
                }),
              },
            ],
          },
        }),
      });

      const sessionUpdate = result.providerMessages.find(
        (message): message is { type: "session.update"; session: Record<string, unknown> } =>
          message.type === "session.update",
      );
      expect(sessionUpdate?.session).toMatchObject({
        instructions: expect.stringContaining("You are James Billing"),
        audio: {
          output: {
            voice: "verse",
            speed: 1.25,
          },
        },
      });
      expect(JSON.stringify(result.providerMessages)).toContain("Concrete billing prompt.");
      expect(JSON.stringify(result.providerMessages)).toContain("Search invoices");
      expect(JSON.stringify(result.providerMessages)).not.toContain("No tools are assigned");
      expect(JSON.stringify(result.providerMessages)).not.toContain("Stale Billing Snapshot");
      expect(JSON.stringify(result.providerMessages)).not.toContain("Stale billing prompt.");
    });

  it("creates initial premium packets from concrete active agents before stale role snapshots", async () => {
      const service = new RuntimeSessionsService(createLoop());
      const manifest = buildConcreteAgentConfigRoutePolicyManifest();

      const session = await service.createRealtimeSession({
        manifest,
        activeAgentId: "agent-billing",
        budgetAllowed: true,
        organizationId: "tenant-1",
        workspaceId: "workspace-customer-success",
        actorUserId: "user-1",
        now: "2026-06-14T09:30:00.000Z",
      });
      const registered = (service as unknown as {
        sessions: Map<string, { packet: TurnRuntimePacket }>;
      }).sessions.get(session.sessionId);

      expect(registered).toBeDefined();
      expect(registered?.packet.graph).toMatchObject({
        currentNodeId: "agent-billing",
        frontierNodeIds: ["agent-billing"],
        activeAgent: {
          id: "agent-billing",
          name: "James Billing",
          kind: "billing",
        },
      });
      expect(registered?.packet.availableTools).toEqual([
        expect.objectContaining({
          label: "Search invoices",
        }),
      ]);
    });

  it("resolves an OpenAI handoff target model and voice into a replacement transition", async () => {
      const service = new RuntimeSessionsService(createLoop());
      const manifest = withTargetRealtimeConfig(buildRoutePolicyManifest(), {
        realtimeProvider: "openai-realtime",
        realtimeModelId: "gpt-realtime-billing",
        realtimeVoiceConfig: {
          provider: "openai-realtime",
          voice: "cedar",
          speed: 1.2,
        },
      });
      const session = await service.createRealtimeSession({
        manifest,
        activeAgentId: "agent-front",
        budgetAllowed: true,
        organizationId: "tenant-1",
        workspaceId: "workspace-customer-success",
        actorUserId: "user-1",
        now: "2026-06-14T09:30:00.000Z",
      });

      const result = await service.processProviderMessage({
        ...baseProviderMessageInput(),
        session,
        manifest,
        activeAgentId: "agent-front",
        transcript: "Francis needs invoice status help.",
        packet: basePacket(),
        rawProviderMessage: openAiHandoffMessage({
          providerCallId: "provider-handoff-model-voice",
          announcementAlreadySpoken: true,
        }),
      });

      expect(result.session).toMatchObject({
        sessionId: session.sessionId,
        manifestId: session.manifestId,
        publishedVersionId: session.publishedVersionId,
        activeAgentId: "agent-billing",
        runtime: "openai-realtime",
        model: "gpt-realtime-billing",
        transportUrl: session.transportUrl,
        transportToken: session.transportToken,
        expiresAt: session.expiresAt,
      });
      expect(result.providerSessionTransition).toMatchObject({
        requiresReplacement: true,
        source: {
          agentId: "agent-front",
          runtime: "openai-realtime",
          model: "gpt-realtime-2.1",
        },
        target: {
          agentId: "agent-billing",
          runtime: "openai-realtime",
          model: "gpt-realtime-billing",
          realtimeVoiceConfig: {
            provider: "openai-realtime",
            voice: "cedar",
            speed: 1.2,
          },
          toolDeclarations: expect.arrayContaining([
            expect.objectContaining({ toolId: "stripe.invoices.search" }),
          ]),
        },
      });
    });

  it("resolves an OpenAI to Gemini handoff with target-provider-safe continuation context", async () => {
      const service = new RuntimeSessionsService(createLoop());
      const manifest = withTargetRealtimeConfig(buildRoutePolicyManifest(), {
        realtimeProvider: "gemini-live",
        realtimeModelId: "gemini-live-billing",
        realtimeVoiceConfig: {
          provider: "gemini-live",
          voiceName: "Kore",
        },
      });
      const session = await service.createRealtimeSession({
        manifest,
        activeAgentId: "agent-front",
        budgetAllowed: true,
        organizationId: "tenant-1",
        workspaceId: "workspace-customer-success",
        actorUserId: "user-1",
        now: "2026-06-14T09:30:00.000Z",
      });

      const result = await service.processProviderMessage({
        ...baseProviderMessageInput(),
        session,
        manifest,
        activeAgentId: "agent-front",
        transcript: "Francis needs invoice status help.",
        packet: basePacket(),
        rawProviderMessage: openAiHandoffMessage({
          providerCallId: "openai-call-must-not-cross",
          responseId: "source-response-cross-provider",
          announcementAlreadySpoken: true,
        }),
      });

      expect(result.session).toMatchObject({
        sessionId: session.sessionId,
        activeAgentId: "agent-billing",
        runtime: "gemini-live",
        model: "gemini-live-billing",
        transportUrl: session.transportUrl,
        expiresAt: session.expiresAt,
      });
      expect(result.providerSessionTransition).toMatchObject({
        requiresReplacement: true,
        sourceResponseId: "source-response-cross-provider",
        source: {
          agentId: "agent-front",
          runtime: "openai-realtime",
          model: "gpt-realtime-2.1",
        },
        target: {
          agentId: "agent-billing",
          runtime: "gemini-live",
          model: "gemini-live-billing",
          realtimeVoiceConfig: {
            provider: "gemini-live",
            voiceName: "Kore",
          },
          toolDeclarations: expect.arrayContaining([
            expect.objectContaining({ toolId: "stripe.invoices.search" }),
          ]),
        },
        transfer: {
          id: "session-1:turn:1:agent-front:agent-billing",
          reason: "Caller needs invoice status support.",
          callerNeedSummary: "Francis wants the status of a pending invoice.",
        },
        continuation: {
          instruction: expect.stringContaining("You are now Billing specialist."),
        },
      });
      expect(result.providerMessages).toEqual([]);
      const targetContinuationContext = JSON.stringify(result.providerSessionTransition);
      expect(targetContinuationContext).not.toContain("openai-call-must-not-cross");
      expect(targetContinuationContext).not.toContain("workflow-route-policy");
      expect(targetContinuationContext).not.toContain("nodeId");
      expect(targetContinuationContext).not.toContain("transportToken");
      expect(targetContinuationContext).not.toContain("credentials");
    });

  it("keeps an unchanged provider model and realtime voice transition in place", async () => {
      const service = new RuntimeSessionsService(createLoop());
      const unchangedConfig = {
        realtimeProvider: "openai-realtime",
        realtimeModelId: "gpt-realtime-shared",
        realtimeVoiceConfig: {
          provider: "openai-realtime",
          voice: "cedar",
          speed: 1.1,
        },
      };
      const manifest = withAgentRealtimeConfig(
        withTargetRealtimeConfig(buildRoutePolicyManifest(), unchangedConfig),
        "agent-front",
        unchangedConfig,
      );
      const session = await service.createRealtimeSession({
        manifest,
        activeAgentId: "agent-front",
        budgetAllowed: true,
        now: "2026-06-14T09:30:00.000Z",
      });

      const result = await service.processProviderMessage({
        ...baseProviderMessageInput(),
        session,
        manifest,
        activeAgentId: "agent-front",
        packet: basePacket(),
        rawProviderMessage: openAiHandoffMessage({
          providerCallId: "provider-handoff-unchanged",
          responseId: "source-response-unchanged",
          announcementAlreadySpoken: true,
        }),
      });

      expect(result.providerSessionTransition).toMatchObject({
        requiresReplacement: false,
        source: {
          runtime: "openai-realtime",
          model: "gpt-realtime-shared",
          realtimeVoiceConfig: unchangedConfig.realtimeVoiceConfig,
        },
        target: {
          runtime: "openai-realtime",
          model: "gpt-realtime-shared",
          realtimeVoiceConfig: unchangedConfig.realtimeVoiceConfig,
        },
      });
    });

  it("replaces a Gemini provider session when handoff config is unchanged", async () => {
      const service = new RuntimeSessionsService(createLoop());
      const unchangedConfig = {
        realtimeProvider: "gemini-live",
        realtimeModelId: "gemini-live-shared",
        realtimeVoiceConfig: {
          provider: "gemini-live",
          voiceName: "Kore",
        },
      };
      const manifest = withAgentRealtimeConfig(
        withTargetRealtimeConfig(buildRoutePolicyManifest(), unchangedConfig),
        "agent-front",
        unchangedConfig,
      );
      const session = await service.createRealtimeSession({
        manifest,
        activeAgentId: "agent-front",
        budgetAllowed: true,
        now: "2026-06-14T09:30:00.000Z",
      });

      const result = await service.processProviderMessage({
        ...baseProviderMessageInput(),
        session,
        manifest,
        activeAgentId: "agent-front",
        packet: basePacket(),
        rawProviderMessage: JSON.stringify({
          tool_call: {
            function_calls: [{
              id: "gemini-handoff-unchanged",
              name: "zara_handoff_to_agent",
              args: {
                targetAgentId: "agent-billing",
                reason: "Caller needs invoice status support.",
                callerNeedSummary: "Francis wants the status of a pending invoice.",
              },
            }],
          },
        }),
      });

      expect(result.providerSessionTransition).toMatchObject({
        requiresReplacement: true,
        source: {
          runtime: "gemini-live",
          model: "gemini-live-shared",
        },
        target: {
          runtime: "gemini-live",
          model: "gemini-live-shared",
        },
      });
    });

  it("retains a deferred cross-provider transition until its source announcement response completes", async () => {
      const service = new RuntimeSessionsService(createLoop());
      const manifest = withTargetRealtimeConfig(buildRoutePolicyManifest(), {
        realtimeProvider: "gemini-live",
        realtimeModelId: "gemini-live-billing",
        realtimeVoiceConfig: {
          provider: "gemini-live",
          voiceName: "Kore",
        },
      });
      const session = await service.createRealtimeSession({
        manifest,
        activeAgentId: "agent-front",
        budgetAllowed: true,
        now: "2026-06-14T09:30:00.000Z",
      });
      const messageInput = {
        ...baseProviderMessageInput(),
        session,
        manifest,
        activeAgentId: "agent-front",
        transcript: "Francis needs invoice status help.",
        packet: basePacket(),
      };

      const pendingResult = await service.processProviderMessage({
        ...messageInput,
        rawProviderMessage: openAiHandoffMessage({
          providerCallId: "provider-handoff-deferred",
          responseId: "source-tool-response",
          announcementAlreadySpoken: false,
        }),
      });
      expect(pendingResult.providerSessionTransition).toBeUndefined();

      await service.processProviderMessage({
        ...messageInput,
        rawProviderMessage: JSON.stringify({
          type: "response.created",
          response: {
            id: "source-announcement-response",
            status: "in_progress",
            metadata: handoffResponseMetadata(),
          },
        }),
      });
      const unrelatedCompletion = await service.processProviderMessage({
        ...messageInput,
        rawProviderMessage: openAiResponseDone("unrelated-response"),
      });
      expect(unrelatedCompletion.providerSessionTransition).toBeUndefined();
      expect(unrelatedCompletion.activeAgentId).toBeUndefined();

      const completed = await service.processProviderMessage({
        ...messageInput,
        rawProviderMessage: openAiResponseDone("source-announcement-response"),
      });

      expect(completed.providerSessionTransition).toMatchObject({
        sourceResponseId: "source-announcement-response",
        requiresReplacement: true,
        target: {
          runtime: "gemini-live",
          model: "gemini-live-billing",
        },
        continuation: {
          instruction: expect.stringContaining("acknowledgement was already spoken"),
        },
      });
      expect(completed.providerMessages).toEqual([]);
      expect(completed.routeEvents).toEqual([
        expect.objectContaining({ type: "agent.route.announcement" }),
        expect.objectContaining({ type: "agent.handoff.requested" }),
        expect.objectContaining({ type: "agent.handoff.completed" }),
      ]);
      expect(completed.routeEvents?.some((event) => event.type === "agent.handoff.completed")).toBe(true);
    });

  it("latches only the OpenAI response created with exact handoff metadata", async () => {
      const service = new RuntimeSessionsService(createLoop());
      const manifest = buildRoutePolicyManifest();
      const session = await service.createRealtimeSession({
        manifest,
        activeAgentId: "agent-front",
        budgetAllowed: true,
        now: "2026-06-14T09:30:00.000Z",
      });
      const messageInput = {
        ...baseProviderMessageInput(),
        session,
        manifest,
        activeAgentId: "agent-front",
        transcript: "Francis needs invoice status help.",
        packet: basePacket(),
      };

      const pendingResult = await service.processProviderMessage({
        ...messageInput,
        rawProviderMessage: openAiHandoffMessage({
          providerCallId: "provider-handoff-first-response",
          responseId: "source-tool-response",
          announcementAlreadySpoken: false,
        }),
      });
      expect(pendingResult.providerMessages[1]).toMatchObject({
        type: "response.create",
        response: {
          metadata: handoffResponseMetadata(),
        },
      });
      await service.processProviderMessage({
        ...messageInput,
        rawProviderMessage: openAiResponseCreated("source-announcement-unrelated-before", {
          zara_handoff_transfer_id: "unrelated-transfer-before",
        }),
      });
      await service.processProviderMessage({
        ...messageInput,
        rawProviderMessage: openAiResponseCreated("source-announcement-matching"),
      });
      await service.processProviderMessage({
        ...messageInput,
        rawProviderMessage: openAiResponseCreated("source-announcement-unrelated-after", {
          zara_handoff_transfer_id: "unrelated-transfer-after",
        }),
      });

      const completed = await service.processProviderMessage({
        ...messageInput,
        rawProviderMessage: openAiResponseDone("source-announcement-matching"),
      });

      expect(completed.activeAgentId).toBe("agent-billing");
      expect(completed.providerSessionTransition?.sourceResponseId).toBe("source-announcement-matching");
    });

  it("returns the retained transition when the source announcement response does not complete", async () => {
      const service = new RuntimeSessionsService(createLoop());
      const manifest = withTargetRealtimeConfig(buildRoutePolicyManifest(), {
        realtimeProvider: "gemini-live",
        realtimeModelId: "gemini-live-billing",
        realtimeVoiceConfig: {
          provider: "gemini-live",
          voiceName: "Kore",
        },
      });
      const session = await service.createRealtimeSession({
        manifest,
        activeAgentId: "agent-front",
        budgetAllowed: true,
        now: "2026-06-14T09:30:00.000Z",
      });
      const messageInput = {
        ...baseProviderMessageInput(),
        session,
        manifest,
        activeAgentId: "agent-front",
        transcript: "Francis needs invoice status help.",
        packet: basePacket(),
      };

      await service.processProviderMessage({
        ...messageInput,
        rawProviderMessage: openAiHandoffMessage({
          providerCallId: "provider-handoff-failed-announcement",
          responseId: "source-tool-response",
          announcementAlreadySpoken: false,
        }),
      });
      await service.processProviderMessage({
        ...messageInput,
        rawProviderMessage: openAiResponseCreated("source-announcement-failed"),
      });

      const result = await service.processProviderMessage({
        ...messageInput,
        rawProviderMessage: openAiResponseDone("source-announcement-failed", "failed"),
      });

      expect(result.activeAgentId).toBe("agent-billing");
      expect(result.session).toMatchObject({
        runtime: "gemini-live",
        model: "gemini-live-billing",
        activeAgentId: "agent-billing",
      });
      expect(result.providerSessionTransition).toMatchObject({
        requiresReplacement: true,
        target: {
          runtime: "gemini-live",
        },
        continuation: {
          instruction: expect.stringContaining("Begin your response with this exact handoff sentence"),
        },
      });
      expect(result.providerSessionTransition).not.toHaveProperty("sourceResponseId");
      expect(result.providerSessionTransition?.continuation.instruction).not.toContain(
        "acknowledgement was already spoken",
      );
      expect(result.providerMessages).toEqual([]);
    });

  it("refreshes packet tool capabilities after an OpenAI handoff", async () => {
      const service = new RuntimeSessionsService(createLoop());
      const manifest = buildRoutePolicyManifest();
      const session = await service.createRealtimeSession({
        manifest,
        activeAgentId: "agent-front",
        budgetAllowed: true,
        organizationId: "tenant-1",
        workspaceId: "workspace-customer-success",
        actorUserId: "user-1",
        now: "2026-06-14T09:30:00.000Z",
      });

      await service.processProviderMessage({
        ...baseProviderMessageInput(),
        session,
        manifest,
        activeAgentId: "agent-front",
        transcript: "Francis needs invoice status help.",
        packet: basePacket(),
        rawProviderMessage: JSON.stringify({
          type: "response.done",
          response: {
            id: "response-1",
            status: "completed",
            output: [
              {
                type: "function_call",
                call_id: "provider-handoff-1",
                name: "zara_handoff_to_agent",
                arguments: JSON.stringify({
                  targetAgentId: "agent-billing",
                  reason: "Caller needs invoice status support.",
                  callerNeedSummary: "Francis wants the status of a pending invoice.",
                }),
              },
            ],
          },
        }),
      });

      await service.processProviderMessage({
        ...baseProviderMessageInput(),
        session,
        manifest,
        activeAgentId: "agent-front",
        transcript: "Francis needs invoice status help.",
        packet: basePacket(),
        rawProviderMessage: openAiResponseCreated("response-announcement"),
      });

      const handoffResult = await service.processProviderMessage({
        ...baseProviderMessageInput(),
        session,
        manifest,
        activeAgentId: "agent-front",
        transcript: "Francis needs invoice status help.",
        packet: basePacket(),
        rawProviderMessage: JSON.stringify({
          type: "response.done",
          response: {
            id: "response-announcement",
            status: "completed",
            output: [
              {
                type: "message",
                content: [
                  {
                    type: "output_text",
                    text: "I'll connect you with Billing specialist.",
                  },
                ],
              },
            ],
          },
        }),
      });

      expect(handoffResult.activeAgentId).toBe("agent-billing");
      expect(handoffResult.packet.availableTools).toEqual([
        expect.objectContaining({
          id: "assignment-search-invoices",
          toolId: "stripe.invoices.search",
          label: "Search invoices",
        }),
      ]);
      expect(handoffResult.packet.availableActions).toEqual([
        expect.objectContaining({
          kind: "agent_tool",
          actionType: "call_tool",
          toolAssignmentId: "assignment-search-invoices",
        }),
      ]);
    });
});
