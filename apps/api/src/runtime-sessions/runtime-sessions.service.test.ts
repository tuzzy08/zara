import { describe, expect, it, vi } from "vitest";

import type {
  CompiledRuntimeManifest,
  PremiumRealtimeSession,
  RealtimeToolDeclaration,
  TurnRuntimePacket,
} from "@zara/core";

import type { PremiumRealtimeToolLoopService } from "./premium-realtime-tool-loop.service";
import { RuntimeSessionsService } from "./runtime-sessions.service";

describe("RuntimeSessionsService", () => {
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

  it("creates handoff-capable premium sessions with normal tools plus an internal handoff tool", () => {
    const service = new RuntimeSessionsService(createLoop());
    const manifest = buildRoutePolicyManifestWithFrontDeskTool();

    const session = service.createRealtimeSession({
      manifest,
      activeRoleId: "role-front",
      budgetAllowed: true,
      organizationId: "tenant-1",
      workspaceId: "workspace-customer-success",
      actorUserId: "user-1",
      now: "2026-06-14T09:30:00.000Z",
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

  it("handles OpenAI internal handoff tool calls without executing connector grants", async () => {
    const loop = createLoop();
    const service = new RuntimeSessionsService(loop);
    const manifest = buildRoutePolicyManifest();
    const session = service.createRealtimeSession({
      manifest,
      activeRoleId: "role-front",
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
      activeRoleId: "role-front",
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
              call_id: "provider-route-1",
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
    expect(result.activeRoleId).toBeUndefined();
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
          call_id: "provider-route-1",
        }),
      }),
      expect.objectContaining({
        type: "response.create",
        response: {
          instructions: "Say exactly this handoff message to the caller, then stop: \"I'll connect you with Billing specialist.\"",
        },
      }),
    ]);
    const routeToolOutputMessage = result.providerMessages[0] as {
      item?: {
        output?: string;
      };
    };
    expect(JSON.parse(routeToolOutputMessage.item?.output ?? "{}")).toMatchObject({
      status: "completed",
      targetAgentId: "agent-billing",
      activeRoleId: "role-billing",
      callerNeedSummary: "Francis wants the status of a pending invoice.",
    });

    const handoffResult = await service.processProviderMessage({
      ...baseProviderMessageInput(),
      session,
      manifest,
      activeRoleId: "role-front",
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

    expect(handoffResult.activeRoleId).toBe("role-billing");
    expect(handoffResult.session).toMatchObject({
      activeRoleId: "role-billing",
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
          targetRoleId: "role-billing",
          text: "I'll connect you with Billing specialist.",
        },
      },
      {
        type: "agent.handoff.completed",
        payload: expect.objectContaining({
          sourceRoleId: "role-front",
          targetRoleId: "role-billing",
        }),
      },
    ]));
    expect(handoffResult.packet.intent).toMatchObject({
      matchedBranchId: "branch-billing",
      intentKey: "billing",
      targetNodeId: "agent-billing",
    });
    expect(handoffResult.packet.transfer).toMatchObject({
      sourceAgent: expect.objectContaining({
        id: "role-front",
      }),
      targetAgent: expect.objectContaining({
        id: "role-billing",
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
    const session = service.createRealtimeSession({
      manifest,
      activeRoleId: "role-front",
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
      activeRoleId: "role-front",
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
              call_id: "provider-route-1",
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
      "Continue helping the caller as the active specialist in this same response.",
    );
  });

  it("warns and keeps the source role active when an internal handoff target is unknown", async () => {
    const loop = createLoop();
    const service = new RuntimeSessionsService(loop);
    const manifest = buildRoutePolicyManifest();
    const session = service.createRealtimeSession({
      manifest,
      activeRoleId: "role-front",
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
      activeRoleId: "role-front",
      transcript: "Caller has a billing question.",
      packet: basePacket(),
      rawProviderMessage: JSON.stringify({
        type: "response.done",
        response: {
          id: "response-1",
          status: "completed",
          output: [
            {
              type: "function_call",
              call_id: "provider-route-unknown",
              name: "zara_handoff_to_agent",
              arguments: JSON.stringify({
                targetAgentId: "agent-not-configured",
                reason: "The model invented a target.",
                callerNeedSummary: "Caller has a billing question.",
              }),
            },
          ],
        },
      }),
    });

    expect(loop.processOpenAiProviderMessage).not.toHaveBeenCalled();
    expect(result.activeRoleId).toBe("role-front");
    expect(result.session).toMatchObject({
      activeRoleId: "role-front",
    });
    expect(result.routeEvents).toEqual([]);
    expect(result.packet.transfer).toBeUndefined();
    expect(result.packet.intent).toMatchObject({
      matchedBranchId: null,
      usedFallback: true,
    });
    expect(result.packet.diagnostics.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "intent_classifier.unknown_branch",
      }),
    ]));
    expect(result.providerMessages).toEqual([
      expect.objectContaining({
        type: "conversation.item.create",
        item: expect.objectContaining({
          type: "function_call_output",
          call_id: "provider-route-unknown",
        }),
      }),
      {
        type: "response.create",
      },
    ]);
    const routeToolOutputMessage = result.providerMessages[0] as {
      item?: {
        output?: string;
      };
    };
    expect(JSON.parse(routeToolOutputMessage.item?.output ?? "{}")).toMatchObject({
      status: "failed",
      targetAgentId: "agent-not-configured",
      activeRoleId: "role-front",
      error: {
        code: "handoff_tool.invalid_target",
      },
    });
  });

  it("rejects stale graph handoff targets without falling back to node labels", async () => {
    const loop = createLoop();
    const service = new RuntimeSessionsService(loop);
    const manifest = buildStaleRoutePolicyManifest();
    const session = service.createRealtimeSession({
      manifest,
      activeRoleId: "role-front",
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
      activeRoleId: "role-front",
      transcript: "Caller asked for the old specialist.",
      packet: basePacket(),
      rawProviderMessage: JSON.stringify({
        type: "response.done",
        response: {
          id: "response-1",
          status: "completed",
          output: [
            {
              type: "function_call",
              call_id: "provider-route-stale",
              name: "zara_handoff_to_agent",
              arguments: JSON.stringify({
                targetAgentId: "agent-stale",
                reason: "Caller asked for the old specialist.",
                callerNeedSummary: "Caller wants the old specialist.",
              }),
            },
          ],
        },
      }),
    });

    expect(result.activeRoleId).toBe("role-front");
    expect(result.session).toMatchObject({
      activeRoleId: "role-front",
    });
    expect(result.routeEvents).toEqual([]);
    expect(result.packet.transfer).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("New Agent");
    const routeToolOutputMessage = result.providerMessages[0] as {
      item?: {
        output?: string;
      };
    };
    expect(JSON.parse(routeToolOutputMessage.item?.output ?? "{}")).toMatchObject({
      status: "failed",
      targetAgentId: "agent-stale",
      activeRoleId: "role-front",
      error: {
        code: "handoff_tool.invalid_target",
      },
    });
  });

  it("warns when a provider requests handoff from an agent without a handoff policy", async () => {
    const loop = createLoop();
    const service = new RuntimeSessionsService(loop);
    const manifest = {
      ...buildRoutePolicyManifest(),
      routePolicies: [],
    } as CompiledRuntimeManifest;
    const session = service.createRealtimeSession({
      manifest,
      activeRoleId: "role-front",
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
      activeRoleId: "role-front",
      transcript: "Caller has a billing question.",
      packet: basePacket(),
      rawProviderMessage: JSON.stringify({
        type: "response.done",
        response: {
          id: "response-1",
          status: "completed",
          output: [
            {
              type: "function_call",
              call_id: "provider-handoff-no-policy",
              name: "zara_handoff_to_agent",
              arguments: JSON.stringify({
                targetAgentId: "agent-billing",
                reason: "Caller needs billing support.",
                callerNeedSummary: "Caller has a billing question.",
              }),
            },
          ],
        },
      }),
    });

    expect(loop.processOpenAiProviderMessage).not.toHaveBeenCalled();
    expect(result.activeRoleId).toBe("role-front");
    const routeToolOutputMessage = result.providerMessages[0] as {
      item?: {
        output?: string;
      };
    };
    expect(JSON.parse(routeToolOutputMessage.item?.output ?? "{}")).toMatchObject({
      status: "failed",
      activeRoleId: "role-front",
      error: {
        code: "handoff_tool.policy_missing",
      },
    });
    expect(result.packet.diagnostics.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "handoff_tool.policy_missing",
      }),
    ]));
  });

  it("keeps the source role active when OpenAI internal handoff arguments are malformed", async () => {
    const loop = createLoop();
    const service = new RuntimeSessionsService(loop);
    const manifest = buildRoutePolicyManifest();
    const session = service.createRealtimeSession({
      manifest,
      activeRoleId: "role-front",
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
      activeRoleId: "role-front",
      transcript: "Caller has a billing question.",
      packet: basePacket(),
      rawProviderMessage: JSON.stringify({
        type: "response.done",
        response: {
          id: "response-1",
          status: "completed",
          output: [
            {
              type: "function_call",
              call_id: "provider-route-malformed",
              name: "zara_handoff_to_agent",
              arguments: "{not-json",
            },
          ],
        },
      }),
    });

    expect(loop.processOpenAiProviderMessage).not.toHaveBeenCalled();
    expect(result.activeRoleId).toBe("role-front");
    expect(result.routeEvents).toEqual([]);
    expect(result.packet.transfer).toBeUndefined();
    expect(result.providerMessages).toEqual([
      expect.objectContaining({
        type: "conversation.item.create",
        item: expect.objectContaining({
          type: "function_call_output",
          call_id: "provider-route-malformed",
        }),
      }),
      {
        type: "response.create",
      },
    ]);
    const routeToolOutputMessage = result.providerMessages[0] as {
      item?: {
        output?: string;
      };
    };
    expect(JSON.parse(routeToolOutputMessage.item?.output ?? "{}")).toMatchObject({
      status: "failed",
      targetAgentId: null,
      activeRoleId: "role-front",
      error: {
        code: "handoff_tool.invalid_target",
      },
    });
  });

  it("handles Gemini internal handoff tool calls without executing connector grants", async () => {
    const loop = createLoop();
    const service = new RuntimeSessionsService(loop);

    const result = await service.processProviderMessage({
      ...baseProviderMessageInput(),
      session: createSession({
        runtime: "gemini-live",
        model: "gemini-live-low-latency-preview",
        toolDeclarations: [declaration],
      }),
      rawProviderMessage: JSON.stringify({
        tool_call: {
          function_calls: [
            {
              id: "provider-call-1",
              name: declaration.name,
              args: {
                query: "account activation",
              },
            },
          ],
        },
      }),
    });

    expect(loop.processGeminiProviderMessage).toHaveBeenCalledWith(expect.objectContaining({
      declarations: [declaration],
      rawProviderMessage: expect.stringContaining("tool_call"),
    }));
    expect(result.providerMessages).toEqual([
      {
        toolResponse: {
          functionResponses: [],
        },
      },
    ]);
  });

  it("handles Gemini internal handoff tool calls without executing connector grants", async () => {
    const loop = createLoop();
    const service = new RuntimeSessionsService(loop);
    const manifest = buildGeminiRoutePolicyManifest();
    const session = service.createRealtimeSession({
      manifest,
      activeRoleId: "role-front",
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
      activeRoleId: "role-front",
      transcript: "Francis needs invoice status help.",
      packet: basePacket(),
      rawProviderMessage: JSON.stringify({
        tool_call: {
          function_calls: [
            {
              id: "gemini-route-1",
              name: "zara_handoff_to_agent",
              args: {
                targetAgentId: "agent-billing",
                reason: "Caller needs invoice status support.",
                callerNeedSummary: "Francis wants the status of a pending invoice.",
              },
            },
          ],
        },
      }),
    });

    expect(loop.processGeminiProviderMessage).not.toHaveBeenCalled();
    expect(result.activeRoleId).toBe("role-billing");
    expect(result.session).toMatchObject({
      activeRoleId: "role-billing",
      runtime: "gemini-live",
      toolDeclarations: [
        expect.objectContaining({
          label: "Search invoices",
        }),
      ],
    });
    expect(result.routeEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "agent.route.announcement",
      }),
      expect.objectContaining({
        type: "agent.handoff.completed",
        payload: expect.objectContaining({
          targetRoleId: "role-billing",
        }),
      }),
    ]));
    expect(result.providerMessages).toEqual([
      {
        toolResponse: {
          functionResponses: [
            {
              id: "gemini-route-1",
              name: "zara_handoff_to_agent",
              response: expect.objectContaining({
                status: "completed",
                targetAgentId: "agent-billing",
                activeRoleId: "role-billing",
              }),
            },
          ],
        },
      },
    ]);
  });

});

function baseProviderMessageInput() {
  return {
    organizationId: "tenant-1",
    sessionId: "session-1",
    workspaceId: "workspace-customer-success",
    actorUserId: "user-1",
    manifest: {
      tenantId: "tenant-1",
      toolBindings: [],
    } as unknown as CompiledRuntimeManifest,
    activeRoleId: "agent-support",
    transcript: "Caller needs a ticket update.",
    packet: {
      toolCalls: [],
    } as unknown as TurnRuntimePacket,
    at: "2026-06-14T09:30:00.000Z",
  };
}

function createSession(overrides: Partial<PremiumRealtimeSession> = {}): PremiumRealtimeSession {
  return {
    sessionId: "session-1",
    manifestId: "manifest-1",
    publishedVersionId: "published-1",
    activeRoleId: "agent-support",
    runtime: "openai-realtime",
    policy: "premium-realtime",
    model: "gpt-realtime",
    voice: "expressive",
    transportUrl: "/runtime/realtime/sessions/manifest-1",
    expiresAt: "2026-06-14T10:00:00.000Z",
    toolDeclarations: [],
    observedEventTypes: [],
    ...overrides,
  };
}

function basePacket(): TurnRuntimePacket {
  return {
    schemaVersion: "turn-runtime-packet.v1",
    ids: {
      tenantId: "tenant-1",
      workspaceId: "workspace-customer-success",
      callSessionId: "session-1",
      turnId: "session-1:turn:1",
      manifestId: "manifest-route-policy",
      manifestVersion: 1,
    },
    timing: {
      startedAt: "2026-06-14T09:30:00.000Z",
      sequence: 1,
    },
    callerInput: {
      latestCallerTurn: "",
      source: "voice",
      recentTranscript: [],
    },
    graph: {
      entryNodeId: "entry",
      currentNodeId: "agent-front",
      frontierNodeIds: ["agent-front"],
      visitedNodeIds: [],
    },
    availableTools: [],
    toolCalls: [],
    safety: {
      untrustedSources: ["caller_transcript", "tool_output"],
      redactionApplied: true,
      maxModelContextBytes: 24_000,
    },
    diagnostics: {
      warnings: [],
      events: [],
    },
  };
}

function buildRoutePolicyManifest(): CompiledRuntimeManifest {
  return {
    tenantId: "tenant-1",
    workspaceId: "workspace-customer-success",
    environment: "sandbox",
    manifestId: "manifest-route-policy",
    publishedVersionId: "published-route-policy",
    workflowId: "workflow-route-policy",
    version: 1,
    runtime: "openai-realtime",
    runtimeProfile: "premium-realtime",
    telephonyProvider: "browser-webrtc",
    telephonyOwnership: "platform",
    entryRoleId: "role-front",
    entryNodeId: "entry",
    roles: [
      {
        id: "role-front",
        kind: "receptionist",
        name: "Front desk",
        businessName: "Zara AI",
        instructions: "Route callers to the right specialist.",
        defaultModelTier: "cheap",
        toolIds: [],
        runtimeProfileOverride: "premium-realtime",
        realtimeProvider: "openai-realtime",
        languagePolicy: {
          defaultLanguage: "en",
          supportedLanguages: ["en"],
          allowMidCallSwitching: true,
        },
      },
      {
        id: "role-billing",
        kind: "billing",
        name: "Billing specialist",
        businessName: "Zara AI",
        instructions: "Resolve invoice and payment questions.",
        defaultModelTier: "standard",
        toolIds: ["stripe.invoices.search"],
        runtimeProfileOverride: "premium-realtime",
        realtimeProvider: "openai-realtime",
        realtimeVoiceConfig: {
          provider: "openai-realtime",
          voice: "cedar",
          speed: 1.8,
        },
        languagePolicy: {
          defaultLanguage: "en",
          supportedLanguages: ["en"],
          allowMidCallSwitching: false,
        },
      },
    ],
    tools: [
      {
        id: "stripe.invoices.search",
        name: "Search invoices",
        description: "Find invoices by customer, email, or invoice number.",
        connector: "stripe",
        requiresHumanApproval: false,
        risk: "low",
      },
    ],
    graph: {
      id: "workflow-route-policy",
      name: "Route policy",
      nodes: [
        node("entry", "entry", "Entry"),
        { ...node("agent-front", "agent", "Front desk"), roleId: "role-front" },
        { ...node("agent-billing", "agent", "Billing specialist"), roleId: "role-billing" },
      ],
      edges: [
        {
          id: "edge-entry-front",
          sourceNodeId: "entry",
          targetNodeId: "agent-front",
        },
      ],
    },
    modelRouting: [],
    escalation: {
      enabled: true,
      fallbackMode: "callback",
      triggers: ["user-request"],
      fallbackMessage: "A specialist will call back.",
    },
    telemetry: {
      captureAudio: false,
      captureTranscript: true,
      redactSensitiveData: true,
      sinks: ["live-monitor"],
    },
    toolBindings: [],
    agentToolAssignments: [
      {
        id: "assignment-search-invoices",
        roleId: "role-billing",
        toolId: "stripe.invoices.search",
        label: "Search invoices",
        description: "Find invoices by customer, email, or invoice number.",
        whenToUse: "Use after the caller provides invoice context.",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
            },
          },
          required: ["query"],
        },
        requiredInputs: ["query"],
        risk: "low",
        requiresHumanApproval: false,
      },
    ],
    handoffs: [],
    conditions: [],
    routePolicies: [
      {
        sourceAgentId: "agent-front",
        sourceAgentName: "Front desk",
        type: "route_by_intent",
        trigger: "on_caller_turn_end",
        activation: "until_routed",
        classifier: {
          mode: "standard",
          modelAlias: "intent-classifier-fast",
          confidenceThreshold: 0.65,
        },
        inputWindow: {
          latestCallerTurn: true,
          recentTranscriptTurns: 6,
          includeConversationSummary: true,
          includePreviousAgentContext: true,
          includeRecentToolResults: true,
        },
        readiness: {
          mode: "auto_with_clarification",
          maxClarificationTurns: 2,
        },
        announcement: {
          mode: "template",
          text: "I'll connect you with {targetAgentName}.",
        },
        branches: [
          {
            id: "branch-billing",
            label: "Billing",
            intentKey: "billing",
            target: {
              type: "agent",
              agentId: "agent-billing",
            },
          },
        ],
        fallback: {
          label: "Clarify",
          target: {
            type: "clarify_source_agent",
          },
        },
      },
    ],
    exitNodes: [],
    returnRoutes: [],
    escalationNode: null,
    memory: {
      mode: "scoped",
      retrievalScopes: ["session"],
      approvalRequired: true,
    },
    budget: {
      monthlyCapUsd: 100,
      currentSpendUsd: 0,
      projectedCostPerMinuteUsd: 0.25,
      blockOnLimit: true,
    },
    serializedGraph: "{\"nodes\":[],\"edges\":[]}",
    compiledDefinitionHash: "hash-route-policy",
  };
}

function buildStaleRoutePolicyManifest(): CompiledRuntimeManifest {
  const manifest = buildRoutePolicyManifest();

  return {
    ...manifest,
    manifestId: "manifest-stale-route-policy",
    graph: {
      ...manifest.graph,
      nodes: [
        ...manifest.graph.nodes,
        { ...node("agent-stale", "agent", "New Agent"), roleId: "role-stale" },
      ],
    },
    routePolicies: manifest.routePolicies.map((routePolicy) => ({
      ...routePolicy,
      branches: [
        ...routePolicy.branches,
        {
          id: "branch-stale",
          label: "Stale",
          intentKey: "stale",
          target: {
            type: "agent",
            agentId: "agent-stale",
          },
        },
      ],
    })),
  };
}

function buildGeminiRoutePolicyManifest(): CompiledRuntimeManifest {
  const manifest = buildRoutePolicyManifest();
  return {
    ...manifest,
    runtime: "gemini-live",
    roles: manifest.roles.map((role) => ({
      ...role,
      realtimeProvider: "gemini-live",
    })),
  } as CompiledRuntimeManifest;
}

function buildRoutePolicyManifestWithFrontDeskTool(): CompiledRuntimeManifest {
  const manifest = buildRoutePolicyManifest();
  return {
    ...manifest,
    roles: manifest.roles.map((role) =>
      role.id === "role-front"
        ? {
            ...role,
            toolIds: ["stripe.invoices.search"],
          }
        : role,
    ),
    agentToolAssignments: [
      ...manifest.agentToolAssignments,
      {
        id: "assignment-front-search-invoices",
        roleId: "role-front",
        toolId: "stripe.invoices.search",
        label: "Search invoices",
        description: "Find invoices by customer, email, or invoice number.",
        whenToUse: "Use if the front desk can answer an invoice lookup directly.",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
            },
          },
          required: ["query"],
        },
        requiredInputs: ["query"],
        risk: "low",
        requiresHumanApproval: false,
      },
    ],
  };
}

function node(
  id: string,
  kind: CompiledRuntimeManifest["graph"]["nodes"][number]["kind"],
  label: string,
) {
  return {
    id,
    kind,
    label,
    position: { x: 0, y: 0 },
    config: {},
  };
}

function createLoop(): Pick<
  PremiumRealtimeToolLoopService,
  "processOpenAiProviderMessage" | "processGeminiProviderMessage"
> {
  return {
    processOpenAiProviderMessage: vi.fn(async (input) => ({
      packet: input.packet,
      providerMessages: [
        {
          type: "response.create",
        },
      ],
    })),
    processGeminiProviderMessage: vi.fn(async (input) => ({
      packet: input.packet,
      providerMessages: [
        {
          toolResponse: {
            functionResponses: [],
          },
        },
      ],
    })),
  };
}
