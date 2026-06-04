import { describe, expect, it } from "vitest";

import { resolveWorkflowPublishTarget } from "./workflowBuilderPublish";

describe("workflow builder publish target", () => {
  it("overwrites the chosen existing workflow even when the release name changes", () => {
    const target = resolveWorkflowPublishTarget({
      currentWorkflowId: "workflow-inbound-support-triage",
      publishedVersions: [
        {
          graph: { name: "Claims intake" },
          manifestPreview: { workflowId: "workflow-claims-intake" },
          workspaceId: "workspace-operations",
        },
        {
          graph: { name: "Billing lane" },
          manifestPreview: { workflowId: "workflow-billing-lane" },
          workspaceId: "workspace-operations",
        },
      ],
      publishMode: "overwrite",
      selectedOverwriteWorkflowId: "workflow-claims-intake",
      selectedWorkspaceId: "workspace-operations",
      workflowTitle: "Claims intake escalation",
    });

    expect(target.workflowId).toBe("workflow-claims-intake");
    expect(target.replaceWorkflowIds).toEqual(["workflow-claims-intake"]);
    expect(target.existingVersions.map((version) => version.manifestPreview.workflowId)).toEqual([
      "workflow-claims-intake",
    ]);
  });

  it("creates a new workflow id from the release name when create-new is selected", () => {
    const target = resolveWorkflowPublishTarget({
      currentWorkflowId: "workflow-inbound-support-triage",
      publishedVersions: [
        {
          graph: { name: "Claims intake" },
          manifestPreview: { workflowId: "workflow-claims-intake" },
          workspaceId: "workspace-operations",
        },
      ],
      publishMode: "create",
      selectedOverwriteWorkflowId: "workflow-claims-intake",
      selectedWorkspaceId: "workspace-operations",
      workflowTitle: "Claims intake",
    });

    expect(target.workflowId).toBe("workflow-claims-intake-2");
    expect(target.replaceWorkflowIds).toEqual([]);
    expect(target.existingVersions).toEqual([]);
  });
});
