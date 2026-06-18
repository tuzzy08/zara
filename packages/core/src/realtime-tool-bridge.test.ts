import { describe, expect, it } from "vitest";

import type { CompiledRuntimeManifest } from "./runtime";
import {
  buildRealtimeProviderToolDeclarations,
  buildRealtimeToolDeclarations,
  resolveRealtimeRouteToolCall,
  resolveRealtimeToolCall,
} from "./realtime-tool-bridge";

describe("realtime tool bridge", () => {
  const manifest = {
    agentToolAssignments: [
      {
        id: "assignment-zendesk-search",
        roleId: "role-support",
        toolId: "zendesk.search_tickets",
        label: "Search tickets",
        description: "Find matching support tickets.",
        whenToUse: "Use when the caller asks about an existing ticket.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string" },
          },
        },
        requiredInputs: ["query"],
        risk: "low",
        requiresHumanApproval: false,
        credentialRef: "secret-connection-ref",
      },
      {
        id: "assignment-hubspot-lookup",
        roleId: "role-sales",
        toolId: "hubspot.lookup_contact",
        label: "Lookup contact",
        description: "Find a CRM contact.",
        whenToUse: "Use when the caller asks about a lead.",
        inputSchema: { type: "object", properties: {} },
        requiredInputs: [],
        risk: "low",
        requiresHumanApproval: false,
        credentialRef: "another-secret-ref",
      },
    ],
  } as unknown as CompiledRuntimeManifest;

  it("declares only active-role agent tools with provider-safe aliases and safe metadata", () => {
    const declarations = buildRealtimeToolDeclarations({
      manifest,
      activeRoleId: "role-support",
    });

    expect(declarations).toHaveLength(1);
    expect(declarations[0]).toMatchObject({
      toolAssignmentId: "assignment-zendesk-search",
      toolId: "zendesk.search_tickets",
      label: "Search tickets",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
        },
        required: ["query"],
      },
    });
    expect(declarations[0]?.name).toMatch(/^zara_[a-z0-9_]+_[a-f0-9]{8}$/);
    expect(declarations[0]?.description).toContain("Use when the caller asks about an existing ticket.");
    expect(declarations[0]?.description).toContain("Risk: low.");
    expect(JSON.stringify(declarations)).not.toContain("secret-connection-ref");
  });

  it("maps provider tool calls back to the Zara assignment and parsed arguments", () => {
    const declarations = buildRealtimeToolDeclarations({
      manifest,
      activeRoleId: "role-support",
    });

    const resolved = resolveRealtimeToolCall({
      declarations,
      providerCallId: "call-provider-1",
      name: declarations[0]?.name ?? "",
      argumentsJson: JSON.stringify({ query: "account activation" }),
    });

    expect(resolved).toEqual({
      providerCallId: "call-provider-1",
      toolAssignmentId: "assignment-zendesk-search",
      toolId: "zendesk.search_tickets",
      arguments: { query: "account activation" },
    });
  });

  it("rejects unknown provider function names before any tool can execute", () => {
    const declarations = buildRealtimeToolDeclarations({
      manifest,
      activeRoleId: "role-support",
    });

    expect(() =>
      resolveRealtimeToolCall({
        declarations,
        providerCallId: "invented-call",
        name: "zara_zendesk_search_tickets_deadbeef",
        argumentsJson: "{}",
      }),
    ).toThrow("Unknown realtime tool function");
  });

  it("declares and resolves an internal route tool for route-capable active roles", () => {
    const routeCapableManifest = {
      ...manifest,
      graph: {
        id: "workflow-1",
        name: "Support workflow",
        nodes: [
          {
            id: "agent-front",
            kind: "agent",
            label: "Front desk",
            roleId: "role-support",
            position: { x: 0, y: 0 },
            config: {},
          },
          {
            id: "agent-billing",
            kind: "agent",
            label: "Bill",
            roleId: "role-billing",
            position: { x: 320, y: 0 },
            config: {},
          },
        ],
        edges: [],
      },
      roles: [
        {
          id: "role-support",
          kind: "support",
          name: "Front desk",
        },
        {
          id: "role-billing",
          kind: "billing",
          name: "Bill",
        },
      ],
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
            includeRecentToolResults: false,
          },
          readiness: {
            mode: "agent_requested",
          },
          announcement: {
            mode: "template",
            text: "I will connect you to {targetAgentName}.",
          },
          branches: [
            {
              id: "billing",
              label: "Bill",
              intentKey: "billing",
              description: "Caller needs help from Bill.",
              examples: ["I need to check an invoice."],
              target: {
                type: "agent",
                agentId: "agent-billing",
              },
              transferInstructions: "Internal billing transfer note.",
            },
          ],
          fallback: {
            label: "Ask a clarifying question",
            target: {
              type: "clarify_source_agent",
            },
          },
        },
      ],
    } as unknown as CompiledRuntimeManifest;

    const declarations = buildRealtimeProviderToolDeclarations({
      manifest: routeCapableManifest,
      activeRoleId: "role-support",
    });
    const routeDeclaration = declarations.find((declaration) => declaration.kind === "internal_route");

    expect(declarations).toHaveLength(2);
    expect(routeDeclaration).toMatchObject({
      kind: "internal_route",
      name: "zara_route_to_agent",
      toolId: "zara.internal.route_to_agent",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["branchId", "reason", "callerNeedSummary"],
        properties: {
          branchId: {
            type: "string",
            enum: ["billing"],
          },
          reason: {
            type: "string",
          },
          callerNeedSummary: {
            type: "string",
          },
        },
      },
    });
    expect(JSON.stringify(declarations)).toContain("assignment-zendesk-search");
    expect(routeDeclaration?.description).toContain("Routing role: Billing.");
    expect(JSON.stringify(routeDeclaration)).not.toContain("agent-billing");
    expect(JSON.stringify(routeDeclaration)).not.toContain("secret-connection-ref");
    expect(JSON.stringify(routeDeclaration)).not.toContain("Internal billing transfer note");

    expect(resolveRealtimeRouteToolCall({
      declarations,
      providerCallId: "route-call-1",
      name: "zara_route_to_agent",
      argumentsJson: JSON.stringify({
        branchId: "billing",
        reason: "Caller needs help with a pending invoice.",
        callerNeedSummary: "Caller wants to check the status of a pending invoice.",
        targetAgentId: "agent-billing",
      }),
    })).toEqual({
      providerCallId: "route-call-1",
      action: {
        type: "route_to_agent",
        branchId: "billing",
        reason: "Caller needs help with a pending invoice.",
        callerNeedSummary: "Caller wants to check the status of a pending invoice.",
      },
    });

    expect(() =>
      resolveRealtimeRouteToolCall({
        declarations,
        providerCallId: "route-call-2",
        name: "zara_route_to_agent",
        argumentsJson: JSON.stringify({
          branchId: "sales",
          reason: "Caller asked about pricing.",
          callerNeedSummary: "Caller wants pricing.",
        }),
      }),
    ).toThrow("Unknown route branch");
  });

  it("declares an internal route tool when the active role id is the agent node id", () => {
    const routeCapableManifest = {
      ...manifest,
      agentToolAssignments: [],
      graph: {
        id: "workflow-node-role-id",
        name: "Node role id workflow",
        nodes: [
          {
            id: "agent-front",
            kind: "agent",
            label: "Front desk",
            position: { x: 0, y: 0 },
            config: {},
          },
          {
            id: "agent-billing",
            kind: "agent",
            label: "Billing",
            position: { x: 320, y: 0 },
            config: {},
          },
        ],
        edges: [],
      },
      roles: [
        {
          id: "agent-front",
          kind: "receptionist",
          name: "Front desk",
        },
        {
          id: "agent-billing",
          kind: "billing",
          name: "Billing",
        },
      ],
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
            includeRecentToolResults: false,
          },
          readiness: {
            mode: "agent_requested",
          },
          announcement: {
            mode: "template",
            text: "I will connect you to {targetAgentName}.",
          },
          branches: [
            {
              id: "billing",
              label: "Billing",
              intentKey: "billing",
              description: "Caller needs billing help.",
              examples: ["I need to check an invoice."],
              target: {
                type: "agent",
                agentId: "agent-billing",
              },
            },
          ],
          fallback: {
            label: "Ask a clarifying question",
            target: {
              type: "clarify_source_agent",
            },
          },
        },
      ],
    } as unknown as CompiledRuntimeManifest;

    const declarations = buildRealtimeProviderToolDeclarations({
      manifest: routeCapableManifest,
      activeRoleId: "agent-front",
    });

    expect(declarations).toHaveLength(1);
    expect(declarations[0]).toMatchObject({
      kind: "internal_route",
      name: "zara_route_to_agent",
    });
  });
});
