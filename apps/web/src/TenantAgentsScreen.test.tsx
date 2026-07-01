/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TenantAgentsScreen } from "./TenantAgentsScreen";

describe("TenantAgentsScreen", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("lets operators create a reusable concrete agent for the active workspace", async () => {
    const showToast = vi.fn();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith("/organizations/tenant-west-africa/agents?workspaceId=workspace-default")) {
        return new Response(JSON.stringify({ agents: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (url.endsWith("/organizations/tenant-west-africa/agents/classes")) {
        return jsonResponse({
          agentClasses: [
            { agentClass: "support", label: "Support" },
            { agentClass: "retention", label: "Retention" },
          ],
        });
      }

      if (url.endsWith("/organizations/tenant-west-africa/agents") && init?.method === "POST") {
        return new Response(JSON.stringify({
          agent: createAgentFixture({
            name: "Support concierge",
            agentClass: "retention",
            instructions: "Answer support calls and escalate billing risks.",
          }),
        }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      }

      return new Response("Not found", { status: 404 });
    }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    render(
      <TenantAgentsScreen
        organizationId="tenant-west-africa"
        organizationName="Eastern Bypass Con"
        activeWorkspaceId="workspace-default"
        showToast={showToast}
      />,
    );

    expect(screen.getByLabelText<HTMLInputElement>("Business name").value).toBe("Eastern Bypass Con");
    await waitFor(() => expect(screen.getByRole("option", { name: "Retention" })).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Agent name"), {
      target: { value: "Support concierge" },
    });
    fireEvent.change(screen.getByLabelText("Agent class"), {
      target: { value: "retention" },
    });
    fireEvent.change(screen.getByLabelText("Instructions"), {
      target: { value: "Answer support calls and escalate billing risks." },
    });
    const createButton = screen.getByRole("button", { name: "Create reusable agent" }) as HTMLButtonElement;
    await waitFor(() => expect(createButton.disabled).toBe(false));
    fireEvent.click(createButton);

    const agentCard = await screen.findByRole("article", { name: "Support concierge reusable agent" });

    expect(within(agentCard).getByText("Support concierge")).toBeTruthy();
    expect(within(agentCard).getByText("retention")).toBeTruthy();
    expect(within(agentCard).getByText("Toolbelt ready: 0 tools")).toBeTruthy();
    expect(showToast).toHaveBeenCalledWith("Support concierge saved to reusable agents.");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:4010/organizations/tenant-west-africa/agents",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("\"businessName\":\"Eastern Bypass Con\""),
      }),
    );
  });

  it("reloads the reusable-agent list when the active workspace changes", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const agents = url.endsWith("workspaceId=workspace-default")
        ? [createAgentFixture({ name: "Default workspace agent" })]
        : [createAgentFixture({
            workspaceId: "workspace-enterprise",
            name: "Enterprise workspace agent",
            agentClass: "sales",
            runtimeProfile: "premium-realtime",
          })];

      return new Response(JSON.stringify({ agents }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch);

    const { rerender } = render(
      <TenantAgentsScreen
        organizationId="tenant-west-africa"
        activeWorkspaceId="workspace-default"
        showToast={vi.fn()}
      />,
    );

    expect(await screen.findByText("Default workspace agent")).toBeTruthy();

    rerender(
      <TenantAgentsScreen
        organizationId="tenant-west-africa"
        activeWorkspaceId="workspace-enterprise"
        showToast={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.queryByText("Default workspace agent")).toBeNull());
    expect(await screen.findByText("Enterprise workspace agent")).toBeTruthy();
  });

  it("lets builders assign a connected catalog tool to a reusable agent toolbelt", async () => {
    const showToast = vi.fn();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const requestUrl = new URL(String(input));
      const method = init?.method ?? "GET";

      if (
        requestUrl.pathname === "/organizations/tenant-west-africa/agents"
        && requestUrl.searchParams.get("workspaceId") === "workspace-default"
        && method === "GET"
      ) {
        return jsonResponse({
          agents: [createAgentFixture({ name: "Support concierge" })],
        });
      }

      if (
        requestUrl.pathname === "/organizations/tenant-west-africa/integrations/connections"
        && requestUrl.searchParams.get("workspaceId") === "workspace-default"
      ) {
        return jsonResponse({
          connections: [
            {
              id: "connection-zendesk-support",
              provider: "zendesk",
              status: "connected",
              scopes: ["tickets:read"],
              availability: { scope: "workspace", workspaceId: "workspace-default" },
              credentialReference: { kind: "api-token", preview: "...1234" },
              accountLabel: "Zendesk support",
              connectedAt: "2026-06-05T09:00:00.000Z",
              health: { status: "healthy" },
            },
          ],
        });
      }

      if (requestUrl.pathname === "/organizations/tenant-west-africa/integrations/catalog") {
        return jsonResponse({
          catalog: {
            providers: [
              {
                id: "zendesk",
                label: "Zendesk",
                capabilities: ["agent-tool"],
                tools: [
                  {
                    id: "zendesk.tickets.search",
                    name: "Search tickets",
                    riskPosture: "low",
                  },
                ],
              },
            ],
          },
        });
      }

      if (
        requestUrl.pathname === "/organizations/tenant-west-africa/agents/agent-support-concierge/toolbelt"
        && method === "PUT"
      ) {
        return jsonResponse({
          agent: createAgentFixture({
            name: "Support concierge",
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
                description: "Search tickets.",
                whenToUse: "Use when the caller asks about Search tickets.",
                risk: "low",
                requiresAuthorization: true,
                requiresHumanApproval: false,
              },
            ],
          }),
        });
      }

      return new Response("Not found", { status: 404 });
    }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    render(
      <TenantAgentsScreen
        organizationId="tenant-west-africa"
        activeWorkspaceId="workspace-default"
        showToast={showToast}
      />,
    );

    const agentCard = await screen.findByRole("article", { name: "Support concierge reusable agent" });
    fireEvent.click(within(agentCard).getByRole("button", { name: "Configure tools" }));
    fireEvent.change(await screen.findByLabelText("Tool for Support concierge"), {
      target: { value: "zendesk.tickets.search" },
    });
    fireEvent.change(screen.getByLabelText("Connection for Support concierge"), {
      target: { value: "connection-zendesk-support" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save toolbelt for Support concierge" }));

    await waitFor(() => expect(within(agentCard).getByText("Toolbelt ready: 1 tool")).toBeTruthy());
    expect(within(agentCard).getAllByText("Search tickets").length).toBeGreaterThan(0);
    expect(showToast).toHaveBeenCalledWith("Support concierge toolbelt saved.");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:4010/organizations/tenant-west-africa/agents/agent-support-concierge/toolbelt",
      expect.objectContaining({
        method: "PUT",
        body: expect.stringContaining("\"integrationConnectionId\":\"connection-zendesk-support\""),
      }),
    );
    expect(screen.queryByText("Tool catalog is still loading.")).toBeNull();
  });
});

function createAgentFixture(input: {
  workspaceId?: string;
  name: string;
  businessName?: string;
  agentClass?: string;
  instructions?: string;
  runtimeProfile?: "cost-optimized" | "premium-realtime";
  toolbeltAssignments?: unknown[];
}) {
  return {
    id: `agent-${input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`,
    organizationId: "tenant-west-africa",
    workspaceId: input.workspaceId ?? "workspace-default",
    name: input.name,
    businessName: input.businessName ?? "Eastern Bypass Con",
    agentClass: input.agentClass ?? "support",
    instructions: input.instructions ?? "Handle workspace callers.",
    defaultLanguage: "en",
    runtimeProfile: input.runtimeProfile ?? "cost-optimized",
    toolbeltAssignments: input.toolbeltAssignments ?? [],
    createdAt: "2026-06-27T12:00:00.000Z",
    updatedAt: "2026-06-27T12:00:00.000Z",
    createdBy: "user-ops-lead",
    updatedBy: "user-ops-lead",
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
