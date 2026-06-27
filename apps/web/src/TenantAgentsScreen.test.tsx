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

      if (url.endsWith("/organizations/tenant-west-africa/agents") && init?.method === "POST") {
        return new Response(JSON.stringify({
          agent: createAgentFixture({
            name: "Support concierge",
            agentClass: "support-specialist",
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
        activeWorkspaceId="workspace-default"
        showToast={showToast}
      />,
    );

    fireEvent.change(screen.getByLabelText("Agent name"), {
      target: { value: "Support concierge" },
    });
    fireEvent.change(screen.getByLabelText("Agent class"), {
      target: { value: "support-specialist" },
    });
    fireEvent.change(screen.getByLabelText("Instructions"), {
      target: { value: "Answer support calls and escalate billing risks." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create reusable agent" }));

    const agentCard = await screen.findByRole("article", { name: "Support concierge reusable agent" });

    expect(within(agentCard).getByText("Support concierge")).toBeTruthy();
    expect(within(agentCard).getByText("support-specialist")).toBeTruthy();
    expect(within(agentCard).getByText("Toolbelt ready: 0 tools")).toBeTruthy();
    expect(showToast).toHaveBeenCalledWith("Support concierge saved to reusable agents.");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:4010/organizations/tenant-west-africa/agents",
      expect.objectContaining({ method: "POST" }),
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
            agentClass: "sales-specialist",
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
});

function createAgentFixture(input: {
  workspaceId?: string;
  name: string;
  agentClass?: string;
  instructions?: string;
  runtimeProfile?: "cost-optimized" | "premium-realtime";
}) {
  return {
    id: `agent-${input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`,
    organizationId: "tenant-west-africa",
    workspaceId: input.workspaceId ?? "workspace-default",
    name: input.name,
    agentClass: input.agentClass ?? "support-specialist",
    instructions: input.instructions ?? "Handle workspace callers.",
    defaultLanguage: "en",
    runtimeProfile: input.runtimeProfile ?? "cost-optimized",
    toolbeltAssignments: [],
    createdAt: "2026-06-27T12:00:00.000Z",
    updatedAt: "2026-06-27T12:00:00.000Z",
    createdBy: "user-ops-lead",
    updatedBy: "user-ops-lead",
  };
}
