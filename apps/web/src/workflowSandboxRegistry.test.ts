/** @vitest-environment jsdom */

import { afterEach, describe, expect, it } from "vitest";

import type { PublishedWorkflowVersion } from "@zara/core";

import { loadPublishedWorkflowVersions, loadPublishedWorkflowVersionsForWorkspace } from "./workflowSandboxRegistry";

describe("workflow sandbox registry", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("preserves published workflow workspace ids because legacy ids may be user-created", () => {
    // These ids look like retired seed fixtures, but in current Zara they can only exist when a user creates them.
    const userCreatedLegacyLookingWorkspaceId = "workspace-customer-success";
    const publishedVersion = {
      id: "workflow-support-triage-v1",
      tenantId: "tenant-west-africa",
      version: 1,
      workspaceId: userCreatedLegacyLookingWorkspaceId,
      graph: {
        id: "workflow-support-triage",
        name: "Support triage",
        nodes: [],
        edges: [],
      },
      roles: [],
      tools: [],
      createdAt: "2026-05-20T09:00:00.000Z",
      createdBy: "user-ops-lead",
      serializedGraph: "{}",
      manifestPreview: {
        manifestId: "manifest-workflow-support-triage-v1",
        workflowId: "workflow-support-triage",
        workspaceId: userCreatedLegacyLookingWorkspaceId,
        runtime: "sandwich-pipeline",
      },
    } as unknown as PublishedWorkflowVersion;

    window.localStorage.setItem("zara.web.published-workflows.v1", JSON.stringify([publishedVersion]));

    const [loadedVersion] = loadPublishedWorkflowVersions();

    expect(loadedVersion?.workspaceId).toBe(userCreatedLegacyLookingWorkspaceId);
    expect(loadedVersion?.manifestPreview.workspaceId).toBe(userCreatedLegacyLookingWorkspaceId);
  });

  it("loads published workflows for user-created workspaces", () => {
    const userCreatedWorkspaceId = "workspace-growth";
    const publishedVersion = {
      id: "workflow-sales-qualification-lane-v1",
      tenantId: "tenant-west-africa",
      version: 1,
      workspaceId: userCreatedWorkspaceId,
      graph: {
        id: "workflow-sales-qualification-lane",
        name: "Sales qualification lane",
        nodes: [],
        edges: [],
      },
      roles: [],
      tools: [],
      createdAt: "2026-05-25T12:05:00.000Z",
      createdBy: "user-ops-lead",
      serializedGraph: "{}",
      manifestPreview: {
        manifestId: "manifest-workflow-sales-qualification-lane-v1",
        workflowId: "workflow-sales-qualification-lane",
        workspaceId: userCreatedWorkspaceId,
        runtime: "sandwich-pipeline",
      },
    } as unknown as PublishedWorkflowVersion;

    window.localStorage.setItem("zara.web.published-workflows.v1", JSON.stringify([publishedVersion]));

    expect(
      loadPublishedWorkflowVersionsForWorkspace({
        tenantId: "tenant-west-africa",
        workspaceId: userCreatedWorkspaceId,
      }).map((workflow) => workflow.graph.name),
    ).toEqual(["Sales qualification lane"]);
  });
});
