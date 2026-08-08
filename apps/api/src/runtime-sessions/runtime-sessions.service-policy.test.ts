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

describe("RuntimeSessionsService policy", () => {
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

  it("creates handoff-capable premium sessions with normal tools plus an internal handoff tool", async () => {
      const service = new RuntimeSessionsService(createLoop());
      const manifest = buildRoutePolicyManifestWithFrontDeskTool();

      const session = await service.createRealtimeSession({
        manifest,
        activeAgentId: "agent-front",
        budgetAllowed: true,
        organizationId: "tenant-1",
        workspaceId: "workspace-customer-success",
        actorUserId: "user-1",
        now: "2099-06-14T09:30:00.000Z",
      });

      expect(session.toolDeclarations).toEqual(expect.arrayContaining([
        expect.objectContaining({
          toolAssignmentId: "assignment-front-search-invoices",
          toolId: "stripe.invoices.search",
          label: "Search invoices",
        }),
        expect.objectContaining({
          kind: "internal_handoff",
          name: "zara_handoff_to_agent",
          toolId: "zara.internal.handoff_to_agent",
          label: "Handoff caller",
          inputSchema: expect.objectContaining({
            properties: expect.objectContaining({
              targetAgentId: expect.objectContaining({
                enum: ["agent-billing"],
              }),
            }),
            required: ["targetAgentId", "reason", "callerNeedSummary"],
          }),
        }),
      ]));
      expect(session.toolDeclarations.find((tool) => tool.name === "zara_handoff_to_agent")?.description)
        .toContain("agent-billing: Billing specialist (billing).");
      expect(service.getRegisteredSession(session.sessionId)?.packet.availableActions).toEqual([
        expect.objectContaining({
          actionType: "call_tool",
          toolAssignmentId: "assignment-front-search-invoices",
        }),
        expect.objectContaining({
          kind: "internal_handoff",
          actionType: "handoff_to_agent",
          name: "zara_handoff_to_agent",
        }),
      ]);
    });

  it("uses platform prompt-policy realtime defaults when a premium agent has no provider fields", async () => {
      const billingTemplate = getDefaultBillingTemplate();
      const service = new RuntimeSessionsService(createLoop(), {
        getPromptPolicy: async () => ({
          schemaVersion: 1,
          version: 1,
          guardrails: ["Keep callers inside platform policy."],
          updatedBy: "system",
          updatedAt: "2026-06-14T09:00:00.000Z",
          agentClassTemplates: {
            ...defaultRuntimePromptPolicy.agentClassTemplates,
            billing: {
              ...billingTemplate,
              modelDefaults: {
                text: {
                  provider: "google-gemini",
                  modelTier: "standard",
                  modelId: "gemini-billing-default",
                },
                realtime: {
                  provider: "gemini-live",
                  modelId: "gemini-live-billing-default",
                },
              },
            },
          },
        }),
      });
      const manifest = buildRoutePolicyManifest();
      const session = await service.createRealtimeSession({
        manifest: {
          ...manifest,
          entryAgentId: "agent-billing",
          graph: {
            ...manifest.graph,
            nodes: manifest.graph.nodes.map((graphNode) => {
              if (graphNode.id !== "agent-billing") {
                return graphNode;
              }

              const config = graphNode.config as Record<string, unknown>;
              const role = config["role"] as Record<string, unknown>;
              const roleWithoutProvider = { ...role };
              delete roleWithoutProvider["realtimeProvider"];
              delete roleWithoutProvider["realtimeModelId"];
              delete roleWithoutProvider["modelProvider"];
              delete roleWithoutProvider["modelId"];

              return {
                ...graphNode,
                config: {
                  ...config,
                  role: roleWithoutProvider,
                },
              };
            }),
          },
        },
        activeAgentId: "agent-billing",
        budgetAllowed: true,
        organizationId: "tenant-1",
        workspaceId: "workspace-customer-success",
        actorUserId: "user-1",
        now: "2099-06-14T09:30:00.000Z",
      });

      expect(session.runtime).toBe("gemini-live");
      expect(session.model).toBe("gemini-live-billing-default");
      expect(service.getRegisteredSession(session.sessionId)?.manifest.graph.nodes
        .find((graphNode) => graphNode.id === "agent-billing")?.config["role"]).toMatchObject({
          realtimeProvider: "gemini-live",
          realtimeModelId: "gemini-live-billing-default",
          modelProvider: "google-gemini",
          modelId: "gemini-billing-default",
          defaultModelTier: "standard",
        });
    });

  it("snapshots the resolved PSTN conversation policy on the registered session", async () => {
      const policy = {
        ...defaultPremiumRealtimeConversationPolicy,
        version: 12,
        providers: {
          ...defaultPremiumRealtimeConversationPolicy.providers,
          openaiRealtime: {
            ...defaultPremiumRealtimeConversationPolicy.providers.openaiRealtime,
            defaultModel: "gpt-realtime-2.1-policy",
          },
        },
      };
      const service = new RuntimeSessionsService(
        createLoop(),
        undefined,
        { getPolicy: async () => structuredClone(policy) },
      );
      const manifest = buildRoutePolicyManifest();
      const session = await service.createRealtimeSession({
        manifest: removeRealtimeProviderFields(manifest),
        activeAgentId: "agent-front",
        budgetAllowed: true,
        mediaProfile: "pstn",
        organizationId: "tenant-1",
        workspaceId: "workspace-customer-success",
        actorUserId: "user-1",
        now: "2099-06-14T09:30:00.000Z",
      });

      expect(session.providerConfig).toMatchObject({
        provider: "openai-realtime",
        model: "gpt-realtime-2.1-policy",
        mediaProfile: "pstn",
        conversationPolicyVersion: 12,
        turnDetection: {
          type: "semantic_vad",
          eagerness: "low",
        },
      });
      expect(service.getRegisteredSession(session.sessionId)?.conversationPolicy.version).toBe(12);
    });

  it("starts a worker session from immutable resolved policy without reading mutable policy stores", async () => {
      const policy = structuredClone(defaultPremiumRealtimeConversationPolicy);
      policy.version = 27;
      policy.providers.openaiRealtime.defaultModel =
        "gpt-realtime-worker-snapshot";
      const service = new RuntimeSessionsService(
        createLoop(),
        {
          getPromptPolicy: async () => {
            throw new Error("mutable prompt policy must not be read");
          },
        },
        {
          getPolicy: async () => {
            throw new Error("mutable conversation policy must not be read");
          },
        },
      );
      const manifest = removeRealtimeProviderFields(buildRoutePolicyManifest());

      const session = await service.createRealtimeSessionFromSnapshot({
        manifest,
        conversationPolicy: policy,
        activeAgentId: "agent-front",
        budgetAllowed: true,
        mediaProfile: "pstn",
        organizationId: "tenant-1",
        workspaceId: "workspace-customer-success",
        actorUserId: "pstn:call-1",
        now: "2099-06-14T09:30:00.000Z",
      });

      expect(session.providerConfig).toMatchObject({
        model: "gpt-realtime-worker-snapshot",
        conversationPolicyVersion: 27,
      });
      expect(
        service.getRegisteredSession(session.sessionId)?.conversationPolicy.version,
      ).toBe(27);
    });

  it("keeps the call-start conversation policy snapshot across a cross-provider handoff", async () => {
      const policy = structuredClone(defaultPremiumRealtimeConversationPolicy);
      policy.version = 12;
      policy.providers.geminiLive.defaultModel = "gemini-live-call-start";
      const service = new RuntimeSessionsService(
        createLoop(),
        undefined,
        { getPolicy: async () => structuredClone(policy) },
      );
      const manifest = withTargetRealtimeConfig(buildRoutePolicyManifest(), {
        realtimeProvider: "gemini-live",
      });
      const session = await service.createRealtimeSession({
        manifest,
        activeAgentId: "agent-front",
        budgetAllowed: true,
        mediaProfile: "pstn",
        organizationId: "tenant-1",
        workspaceId: "workspace-customer-success",
        actorUserId: "user-1",
        now: "2099-06-14T09:30:00.000Z",
      });

      policy.version = 13;
      policy.providers.geminiLive.defaultModel = "gemini-live-updated-later";
      const handoffInput = {
        ...baseProviderMessageInput(),
        sessionId: session.sessionId,
        session,
        manifest,
        activeAgentId: "agent-front",
        transcript: "Francis needs invoice status help.",
        packet: basePacket(),
        rawProviderMessage: openAiHandoffMessage({
          providerCallId: "provider-handoff-policy-snapshot",
          announcementAlreadySpoken: true,
        }),
      };

      const result = await service.processProviderMessage({
        ...handoffInput,
        sessionId: "mismatched-session-id",
      });

      expect(result.session?.providerConfig).toMatchObject({
        provider: "gemini-live",
        model: "gemini-live-call-start",
        mediaProfile: "pstn",
        conversationPolicyVersion: 12,
        activityHandling: { type: "provider_native" },
      });
      expect(result.providerSessionTransition?.target.model).toBe("gemini-live-call-start");
    });

  it("ignores route policies attached to stale role snapshots", async () => {
      const loop = createLoop();
      const service = new RuntimeSessionsService(loop);
      const manifest = buildStaleRoleSnapshotRoutePolicyManifest();
      const session = await service.createRealtimeSession({
        manifest,
        activeAgentId: "agent-front",
        budgetAllowed: true,
        organizationId: "tenant-1",
        workspaceId: "workspace-customer-success",
        actorUserId: "user-1",
        now: "2026-06-14T09:30:00.000Z",
      });

      expect(session.toolDeclarations.map((tool) => tool.name)).not.toContain("zara_handoff_to_agent");

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
                call_id: "provider-handoff-stale-role-policy",
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

      expect(result.activeAgentId).toBe("agent-front");
      expect(result.session).toMatchObject({
        activeAgentId: "agent-front",
      });
      expect(result.routeEvents).toEqual([]);
      const handoffToolOutputMessage = result.providerMessages[0] as {
        item?: {
          output?: string;
        };
      };
      expect(JSON.parse(handoffToolOutputMessage.item?.output ?? "{}")).toMatchObject({
        status: "failed",
        activeAgentId: "agent-front",
        error: {
          code: "handoff_tool.policy_missing",
        },
      });
    });

  it("handles OpenAI internal handoff tool calls without executing connector grants", async () => {
      const loop = createLoop();
      const service = new RuntimeSessionsService(loop);

      const result = await service.processProviderMessage({
        ...baseProviderMessageInput(),
        session: createSession({
          runtime: "openai-realtime",
          toolDeclarations: [declaration],
        }),
        rawProviderMessage: JSON.stringify({
          type: "response.done",
          response: {
            id: "response-1",
            status: "completed",
            output: [
              {
                type: "function_call",
                call_id: "provider-call-1",
                name: declaration.name,
                arguments: "{\"query\":\"account activation\"}",
              },
            ],
          },
        }),
      });

      expect(loop.processOpenAiProviderMessage).toHaveBeenCalledWith(expect.objectContaining({
        declarations: [declaration],
        rawProviderMessage: expect.stringContaining("response.done"),
      }));
      expect(result.providerMessages).toEqual([
        {
          type: "response.create",
        },
      ]);
    });
});
