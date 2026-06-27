/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TenantAgentsScreen } from "./TenantAgentsScreen";
import { createReusableAgent, loadReusableAgentsForWorkspace, saveReusableAgent } from "./reusableAgents";

describe("TenantAgentsScreen", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it("lets operators create a reusable concrete agent for the active workspace", () => {
    const showToast = vi.fn();

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

    const agentCard = screen.getByRole("article", { name: "Support concierge reusable agent" });

    expect(within(agentCard).getByText("Support concierge")).toBeTruthy();
    expect(within(agentCard).getByText("support-specialist")).toBeTruthy();
    expect(within(agentCard).getByText("Toolbelt ready: 0 tools")).toBeTruthy();
    expect(showToast).toHaveBeenCalledWith("Support concierge saved to reusable agents.");
    expect(loadReusableAgentsForWorkspace({
      organizationId: "tenant-west-africa",
      workspaceId: "workspace-default",
    })).toEqual([
      expect.objectContaining({
        name: "Support concierge",
        instructions: "Answer support calls and escalate billing risks.",
      }),
    ]);
  });

  it("reloads the reusable-agent list when the active workspace changes", async () => {
    saveReusableAgent(createReusableAgent({
      organizationId: "tenant-west-africa",
      workspaceId: "workspace-default",
      name: "Default workspace agent",
      agentClass: "support-specialist",
      instructions: "Handle default workspace callers.",
      defaultLanguage: "en",
      runtimeProfile: "cost-optimized",
    }));
    saveReusableAgent(createReusableAgent({
      organizationId: "tenant-west-africa",
      workspaceId: "workspace-enterprise",
      name: "Enterprise workspace agent",
      agentClass: "sales-specialist",
      instructions: "Handle enterprise workspace callers.",
      defaultLanguage: "en",
      runtimeProfile: "premium-realtime",
    }));

    const { rerender } = render(
      <TenantAgentsScreen
        organizationId="tenant-west-africa"
        activeWorkspaceId="workspace-default"
        showToast={vi.fn()}
      />,
    );

    expect(screen.getByText("Default workspace agent")).toBeTruthy();

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
