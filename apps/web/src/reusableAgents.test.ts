/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createReusableAgent,
  fetchReusableAgents,
  updateReusableAgentToolbelt,
} from "./reusableAgents";

describe("reusable tenant agents", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads reusable concrete agents from the tenant API", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        agents: [
          {
            id: "agent-support-concierge",
            organizationId: "tenant-west-africa",
            workspaceId: "workspace-default",
            name: "Support concierge",
            businessName: "Eastern Bypass Con",
            agentClass: "support-specialist",
            instructions: "Answer support calls and escalate billing risks.",
            defaultLanguage: "en",
            runtimeProfile: "cost-optimized",
            toolbeltAssignments: [],
            createdAt: "2026-06-27T12:00:00.000Z",
            updatedAt: "2026-06-27T12:00:00.000Z",
            createdBy: "user-ops-lead",
            updatedBy: "user-ops-lead",
          },
        ],
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchReusableAgents({
      organizationId: "tenant-west-africa",
      workspaceId: "workspace-default",
    })).resolves.toEqual([
      expect.objectContaining({
        id: "agent-support-concierge",
        name: "Support concierge",
      }),
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:4010/organizations/tenant-west-africa/agents?workspaceId=workspace-default",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("creates reusable concrete agents through the tenant API", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        agent: {
          id: "agent-support-concierge",
          organizationId: "tenant-west-africa",
          workspaceId: "workspace-default",
          name: "Support concierge",
          businessName: "Eastern Bypass Con",
          agentClass: "support-specialist",
          instructions: "Answer support calls and escalate billing risks.",
          defaultLanguage: "en",
          runtimeProfile: "cost-optimized",
          toolbeltAssignments: [],
          createdAt: "2026-06-27T12:00:00.000Z",
          updatedAt: "2026-06-27T12:00:00.000Z",
          createdBy: "user-ops-lead",
          updatedBy: "user-ops-lead",
        },
      }), {
        status: 201,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    const agent = await createReusableAgent({
      organizationId: "tenant-west-africa",
      workspaceId: "workspace-default",
      name: "Support concierge",
      businessName: "Eastern Bypass Con",
      agentClass: "support-specialist",
      instructions: "Answer support calls and escalate billing risks.",
      defaultLanguage: "en",
      runtimeProfile: "cost-optimized",
    });

    expect(agent).toEqual(expect.objectContaining({
      id: "agent-support-concierge",
      toolbeltAssignments: [],
      businessName: "Eastern Bypass Con",
    }));
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:4010/organizations/tenant-west-africa/agents",
      expect.objectContaining({
        body: expect.stringContaining("\"businessName\":\"Eastern Bypass Con\""),
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:4010/organizations/tenant-west-africa/agents",
      expect.objectContaining({
        credentials: "include",
        method: "POST",
      }),
    );
  });

  it("replaces reusable agent toolbelts through the tenant API without secret material", async () => {
    let requestBody: BodyInit | null | undefined;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = init?.body;

      return new Response(JSON.stringify({
          agent: {
            id: "agent-support-concierge",
            organizationId: "tenant-west-africa",
            workspaceId: "workspace-default",
            name: "Support concierge",
            agentClass: "support-specialist",
            instructions: "Answer support calls and escalate billing risks.",
            defaultLanguage: "en",
            runtimeProfile: "cost-optimized",
            toolbeltAssignments: [
              {
                id: "assignment-zendesk-tickets-search",
                toolId: "zendesk.tickets.search",
                connector: "zendesk",
                toolName: "Search tickets",
                integrationConnectionId: "connection-zendesk-support",
                integrationLabel: "Zendesk support",
                connectionStatus: "connected",
                label: "Search tickets",
                description: "Search recent Zendesk tickets.",
                whenToUse: "Use when the caller asks about existing tickets.",
                risk: "low",
                requiresAuthorization: true,
                requiresHumanApproval: false,
              },
            ],
            createdAt: "2026-06-27T12:00:00.000Z",
            updatedAt: "2026-06-27T12:00:00.000Z",
            createdBy: "user-ops-lead",
            updatedBy: "user-ops-lead",
          },
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
    });
    vi.stubGlobal("fetch", fetchMock);

    await updateReusableAgentToolbelt({
      organizationId: "tenant-west-africa",
      workspaceId: "workspace-default",
      agentId: "agent-support-concierge",
      assignments: [
        {
          id: "assignment-zendesk-tickets-search",
          toolId: "zendesk.tickets.search",
          connector: "zendesk",
          toolName: "Search tickets",
          integrationConnectionId: "connection-zendesk-support",
          label: "Search tickets",
          description: "Search recent Zendesk tickets.",
          whenToUse: "Use when the caller asks about existing tickets.",
          risk: "low",
          requiresAuthorization: true,
          requiresHumanApproval: false,
          connectionStatus: "missing",
        },
      ],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:4010/organizations/tenant-west-africa/agents/agent-support-concierge/toolbelt",
      expect.objectContaining({
        credentials: "include",
        method: "PUT",
      }),
    );
    expect(String(requestBody)).toContain("\"workspaceId\":\"workspace-default\"");
    expect(String(requestBody)).not.toMatch(/secret|token|credentialReference/i);
  });
});
