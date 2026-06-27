/** @vitest-environment jsdom */

import { afterEach, describe, expect, it } from "vitest";

import {
  publishedWorkflowVersionSchemaVersion,
  type PublishedWorkflowVersion,
} from "@zara/core";

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
      schemaVersion: publishedWorkflowVersionSchemaVersion,
      tenantId: "tenant-west-africa",
      version: 1,
      workspaceId: userCreatedLegacyLookingWorkspaceId,
      graph: {
        id: "workflow-support-triage",
        name: "Support triage",
        nodes: [],
        edges: [],
      },
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
      schemaVersion: publishedWorkflowVersionSchemaVersion,
      tenantId: "tenant-west-africa",
      version: 1,
      workspaceId: userCreatedWorkspaceId,
      graph: {
        id: "workflow-sales-qualification-lane",
        name: "Sales qualification lane",
        nodes: [],
        edges: [],
      },
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

  it("drops legacy published snapshots without the current schema version", () => {
    const legacyVersion = {
      id: "workflow-old-v1",
      tenantId: "tenant-west-africa",
      version: 1,
      workspaceId: "workspace-default",
      graph: {
        id: "workflow-old",
        name: "Old workflow",
        nodes: [
          {
            id: "agent-old",
            kind: "agent",
            label: "New Agent",
            roleId: "role-old",
            position: { x: 0, y: 0 },
            config: {
              role: {
                specialistTemplateId: "specialist-template-agent-front-desk",
              },
            },
          },
        ],
        edges: [],
      },
      tools: [],
      createdAt: "2026-05-20T09:00:00.000Z",
      createdBy: "user-ops-lead",
      serializedGraph: "{}",
      manifestPreview: {
        manifestId: "manifest-workflow-old-v1",
        workflowId: "workflow-old",
        workspaceId: "workspace-default",
        runtime: "sandwich-pipeline",
      },
    };

    window.localStorage.setItem("zara.web.published-workflows.v1", JSON.stringify([legacyVersion]));

    expect(loadPublishedWorkflowVersions()).toEqual([]);
    expect(JSON.parse(window.localStorage.getItem("zara.web.published-workflows.v1") ?? "null")).toEqual([]);
  });

  it("drops published snapshots with stale specialist metadata even when a schema is present", () => {
    const legacyVersion = {
      id: "workflow-old-metadata-v1",
      schemaVersion: publishedWorkflowVersionSchemaVersion,
      tenantId: "tenant-west-africa",
      version: 1,
      workspaceId: "workspace-default",
      graph: {
        id: "workflow-old-metadata",
        name: "Old metadata workflow",
        nodes: [],
        edges: [],
      },
      roles: [
        {
          id: "role-old",
          kind: "support",
          name: "Support",
          reusableSpecialist: true,
          specialistTemplateId: "specialist-template-agent-front-desk",
        },
      ],
      tools: [],
      createdAt: "2026-05-20T09:00:00.000Z",
      createdBy: "user-ops-lead",
      serializedGraph: "{}",
      manifestPreview: {
        manifestId: "manifest-workflow-old-metadata-v1",
        workflowId: "workflow-old-metadata",
        workspaceId: "workspace-default",
        runtime: "sandwich-pipeline",
      },
    };

    window.localStorage.setItem("zara.web.published-workflows.v1", JSON.stringify([legacyVersion]));

    expect(loadPublishedWorkflowVersions()).toEqual([]);
    expect(JSON.parse(window.localStorage.getItem("zara.web.published-workflows.v1") ?? "null")).toEqual([]);
  });

  it("drops published snapshots with retired internal routing action metadata", () => {
    const retiredMenuKey = ["route", "menu"].join("-");
    const retiredActionType = ["zara", "route", "to", "agent"].join("-");
    const legacyVersion = {
      id: "workflow-old-action-v1",
      schemaVersion: publishedWorkflowVersionSchemaVersion,
      tenantId: "tenant-west-africa",
      version: 1,
      workspaceId: "workspace-default",
      graph: {
        id: "workflow-old-action",
        name: "Old action workflow",
        nodes: [],
        edges: [],
      },
      tools: [],
      createdAt: "2026-05-20T09:00:00.000Z",
      createdBy: "user-ops-lead",
      serializedGraph: "{}",
      manifestPreview: {
        manifestId: "manifest-workflow-old-action-v1",
        workflowId: "workflow-old-action",
        workspaceId: "workspace-default",
        runtime: "sandwich-pipeline",
        [retiredMenuKey]: [
          {
            type: retiredActionType,
          },
        ],
      },
    };

    window.localStorage.setItem("zara.web.published-workflows.v1", JSON.stringify([legacyVersion]));

    expect(loadPublishedWorkflowVersions()).toEqual([]);
    expect(JSON.parse(window.localStorage.getItem("zara.web.published-workflows.v1") ?? "null")).toEqual([]);
  });

  it("keeps published snapshots that only mention router-agent class metadata", () => {
    const publishedVersion = {
      id: "workflow-router-agent-v1",
      schemaVersion: publishedWorkflowVersionSchemaVersion,
      tenantId: "tenant-west-africa",
      version: 1,
      workspaceId: "workspace-default",
      graph: {
        id: "workflow-router-agent",
        name: "Router workflow",
        nodes: [],
        edges: [],
      },
      tools: [],
      createdAt: "2026-05-20T09:00:00.000Z",
      createdBy: "user-ops-lead",
      serializedGraph: "{}",
      manifestPreview: {
        manifestId: "manifest-workflow-router-agent-v1",
        workflowId: "workflow-router-agent",
        workspaceId: "workspace-default",
        runtime: "sandwich-pipeline",
        agentClass: "router-agent",
      },
    } as unknown as PublishedWorkflowVersion;

    window.localStorage.setItem("zara.web.published-workflows.v1", JSON.stringify([publishedVersion]));

    expect(loadPublishedWorkflowVersions().map((workflow) => workflow.id)).toEqual(["workflow-router-agent-v1"]);
  });
});
