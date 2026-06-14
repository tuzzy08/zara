import { describe, expect, it } from "vitest";

import type { CompiledRuntimeManifest } from "./runtime";
import {
  buildRealtimeToolDeclarations,
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
});
