/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createReusableAgent,
  fetchReusableAgents,
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
      })) as unknown as typeof fetch;
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
      agentClass: "support-specialist",
      instructions: "Answer support calls and escalate billing risks.",
      defaultLanguage: "en",
      runtimeProfile: "cost-optimized",
    });

    expect(agent).toEqual(expect.objectContaining({
      id: "agent-support-concierge",
      toolbeltAssignments: [],
    }));
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:4010/organizations/tenant-west-africa/agents",
      expect.objectContaining({
        credentials: "include",
        method: "POST",
      }),
    );
  });
});
