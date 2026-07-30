/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAgentRoleNode,
  createWorkflowGraph,
  createWorkspace,
  publishWorkflowVersion,
} from "@zara/core";

import { SandboxScreen } from "./SandboxScreen";
import {
  getSandboxWorkflowVersionOptionId,
  savePublishedWorkflowVersion,
} from "./workflowSandboxRegistry";

describe("SandboxScreen", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it("lists published workflows from the active organization", () => {
    seedPublishedWorkflow();
    renderSandbox("/sandbox");

    const options = Array.from(
      screen.getByLabelText<HTMLSelectElement>("Published workflow").options,
    ).map((option) => option.textContent);

    expect(options).toContain("Acme support line");
  });

  it("selects published workflow deep links by published version id", () => {
    const publishedWorkflow = seedPublishedWorkflow();
    renderSandbox(`/sandbox?workflow=${publishedWorkflow.id}`);

    expect(
      screen.getByLabelText<HTMLSelectElement>("Published workflow").value,
    ).toBe(getSandboxWorkflowVersionOptionId(publishedWorkflow));
  });
});

const organizationId = "tenant-acme";
const workspaceId = "workspace-acme-support";

function seedPublishedWorkflow() {
  const publishedWorkflow = publishWorkflowVersion({
    workflowId: "workflow-acme-support",
    tenantId: organizationId,
    workspaceId,
    environment: "production",
    createdBy: "user-acme-admin",
    createdAt: "2026-06-22T13:00:00.000Z",
    graph: createWorkflowGraph({
      id: "workflow-acme-support",
      name: "Acme support line",
      nodes: [
        {
          id: "entry",
          kind: "entry",
          label: "Inbound call",
          position: { x: 0, y: 0 },
          config: {},
        },
        createAgentRoleNode({
          id: "agent-front-desk",
          label: "Front desk",
          position: { x: 240, y: 0 },
          role: {
            kind: "receptionist",
            name: "Front desk",
            businessName: "Acme",
            instructions: "Help callers reach the right team.",
            defaultModelTier: "cheap",
            languagePolicy: {
              defaultLanguage: "en",
              supportedLanguages: ["en"],
              allowMidCallSwitching: true,
            },
          },
        }),
      ],
      edges: [
        {
          id: "edge-entry-agent",
          sourceNodeId: "entry",
          targetNodeId: "agent-front-desk",
        },
      ],
    }),
    existingVersions: [],
    runtime: "sandwich-pipeline",
    runtimeProfile: "cost-optimized",
    telephonyProvider: "browser-webrtc",
    memory: {
      mode: "scoped",
      retrievalScopes: ["session"],
      approvalRequired: true,
    },
    budget: {
      monthlyCapUsd: 100,
      currentSpendUsd: 0,
      projectedCostPerMinuteUsd: 0.2,
      blockOnLimit: true,
    },
  });
  savePublishedWorkflowVersion(publishedWorkflow);
  return publishedWorkflow;
}

function renderSandbox(initialEntry: string) {
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <SandboxScreen
        organizationId={organizationId}
        activeWorkspaceId={workspaceId}
        workspaces={[
          createWorkspace({
            id: workspaceId,
            tenantId: organizationId,
            name: "Acme support",
            createdBy: "user-acme-admin",
            createdAt: "2026-06-22T12:55:00.000Z",
          }),
        ]}
        showToast={vi.fn()}
      />
    </MemoryRouter>,
  );
}
