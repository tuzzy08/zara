/** @vitest-environment jsdom */

import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_WORKSPACE_ID, type PublishedWorkflowVersion } from "@zara/core";

import { loadPublishedWorkflowVersions } from "./workflowSandboxRegistry";

describe("workflow sandbox registry", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("remaps published workflows from retired seed workspaces to the default workspace", () => {
    const publishedVersion = {
      id: "workflow-support-triage-v1",
      tenantId: "tenant-west-africa",
      version: 1,
      workspaceId: "workspace-support",
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
        workspaceId: "workspace-support",
        runtime: "sandwich-pipeline",
      },
    } as unknown as PublishedWorkflowVersion;

    window.localStorage.setItem("zara.web.published-workflows.v1", JSON.stringify([publishedVersion]));

    const [loadedVersion] = loadPublishedWorkflowVersions();

    expect(loadedVersion?.workspaceId).toBe(DEFAULT_WORKSPACE_ID);
    expect(loadedVersion?.manifestPreview.workspaceId).toBe(DEFAULT_WORKSPACE_ID);
  });
});
