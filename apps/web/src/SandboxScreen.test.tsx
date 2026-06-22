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
import { getSandboxWorkflowVersionOptionId, savePublishedWorkflowVersion } from "./workflowSandboxRegistry";

describe("SandboxScreen", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it("lists published workflows from the active organization", () => {
    const organizationId = "tenant-acme";
    const workspaceId = "workspace-acme-support";
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

    render(
      <MemoryRouter initialEntries={["/sandbox"]}>
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

    const options = Array.from(screen.getByLabelText<HTMLSelectElement>("Published workflow").options).map(
      (option) => option.textContent,
    );

    expect(options).toContain("Acme support line");
  });

  it("renders the published browser sandbox as voice only", () => {
    render(
      <MemoryRouter initialEntries={["/sandbox"]}>
        <SandboxScreen
          organizationId="tenant-west-africa"
          activeWorkspaceId="workspace-default"
          workspaces={[
            createWorkspace({
              id: "workspace-default",
              tenantId: "tenant-west-africa",
              name: "Default workspace",
              createdBy: "user-ops-lead",
              createdAt: "2026-06-22T12:55:00.000Z",
            }),
          ]}
          showToast={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole("button", { name: "Start sandbox call" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Use typed sandbox" })).toBeNull();
    expect(screen.queryByLabelText("Caller turn")).toBeNull();
    expect(screen.queryByRole("button", { name: "Send caller turn" })).toBeNull();
    expect(screen.queryByText("Typed mode")).toBeNull();
  });

  it("selects published workflow deep links by published version id", () => {
    const organizationId = "tenant-acme";
    const workspaceId = "workspace-acme-support";
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

    render(
      <MemoryRouter initialEntries={[`/sandbox?workflow=${publishedWorkflow.id}`]}>
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

    expect(screen.getByLabelText<HTMLSelectElement>("Published workflow").value).toBe(
      getSandboxWorkflowVersionOptionId(publishedWorkflow),
    );
  });
});
