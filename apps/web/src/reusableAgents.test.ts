/** @vitest-environment jsdom */

import { afterEach, describe, expect, it } from "vitest";

import {
  createReusableAgent,
  loadReusableAgentsForWorkspace,
  saveReusableAgent,
} from "./reusableAgents";

describe("reusable tenant agents", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("loads only valid concrete agents for the active organization and workspace", () => {
    window.localStorage.setItem("zara.web.reusable-agents.v1", JSON.stringify([
      {
        id: "agent-valid",
        organizationId: "tenant-west-africa",
        workspaceId: "workspace-default",
        name: "Support concierge",
        agentClass: "support-specialist",
        instructions: "Answer support calls and escalate billing risks.",
        defaultLanguage: "en",
        runtimeProfile: "cost-optimized",
        toolbeltAssignmentIds: [],
        createdAt: "2026-06-27T12:00:00.000Z",
      },
      {
        id: "agent-stale-runtime",
        organizationId: "tenant-west-africa",
        workspaceId: "workspace-default",
        name: "Stale runtime agent",
        agentClass: "sales-specialist",
        instructions: "Qualify leads.",
        defaultLanguage: "en",
        runtimeProfile: "legacy-balanced",
        toolbeltAssignmentIds: [],
        createdAt: "2026-06-27T12:01:00.000Z",
      },
      {
        id: "agent-invalid",
        organizationId: "tenant-west-africa",
        workspaceId: "workspace-default",
        name: "",
        agentClass: "support-specialist",
        instructions: "Invalid because the name is blank.",
        defaultLanguage: "en",
        runtimeProfile: "cost-optimized",
        toolbeltAssignmentIds: [],
        createdAt: "2026-06-27T12:02:00.000Z",
      },
    ]));

    expect(loadReusableAgentsForWorkspace({
      organizationId: "tenant-west-africa",
      workspaceId: "workspace-default",
    })).toEqual([
      expect.objectContaining({
        id: "agent-valid",
        name: "Support concierge",
      }),
    ]);
  });

  it("creates and persists a reusable concrete agent with an empty toolbelt", () => {
    const agent = createReusableAgent({
      organizationId: "tenant-west-africa",
      workspaceId: "workspace-default",
      name: "Support concierge",
      agentClass: "support-specialist",
      instructions: "Answer support calls and escalate billing risks.",
      defaultLanguage: "en",
      runtimeProfile: "cost-optimized",
      now: "2026-06-27T12:00:00.000Z",
    });

    saveReusableAgent(agent);

    expect(loadReusableAgentsForWorkspace({
      organizationId: "tenant-west-africa",
      workspaceId: "workspace-default",
    })).toEqual([
      expect.objectContaining({
        id: "agent-support-concierge",
        toolbeltAssignmentIds: [],
      }),
    ]);
  });
});
