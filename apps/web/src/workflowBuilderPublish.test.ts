import { describe, expect, it } from "vitest";

import { resolveWorkflowPublishTarget } from "./workflowBuilderPublish";

describe("workflow builder publish target", () => {
  it("overwrites an existing workflow only when the release name matches in the selected workspace", () => {
    const target = resolveWorkflowPublishTarget({
      currentWorkflowId: "workflow-inbound-support-triage",
      publishedVersions: [
        {
          graph: { name: "Claims intake" },
          manifestPreview: { workflowId: "workflow-claims-intake" },
          workspaceId: "workspace-default",
        },
        {
          graph: { name: "Billing lane" },
          manifestPreview: { workflowId: "workflow-billing-lane" },
          workspaceId: "workspace-default",
        },
      ],
      selectedWorkspaceId: "workspace-default",
      workflowTitle: "Claims intake",
    });

    expect(target.workflowId).toBe("workflow-claims-intake");
    expect(target.mode).toBe("overwrite");
    expect(target.replaceWorkflowIds).toEqual(["workflow-claims-intake"]);
    expect(target.existingVersions.map((version) => version.manifestPreview.workflowId)).toEqual([
      "workflow-claims-intake",
    ]);
  });

  it("creates a new workflow id from the release name when no selected-workspace name match exists", () => {
    const target = resolveWorkflowPublishTarget({
      currentWorkflowId: "workflow-inbound-support-triage",
      publishedVersions: [
        {
          graph: { name: "Claims intake" },
          manifestPreview: { workflowId: "workflow-claims-intake" },
          workspaceId: "workspace-default",
        },
      ],
      selectedWorkspaceId: "workspace-default",
      workflowTitle: "Claims intake escalation",
    });

    expect(target.workflowId).toBe("workflow-claims-intake-escalation");
    expect(target.mode).toBe("create");
    expect(target.replaceWorkflowIds).toEqual([]);
    expect(target.existingVersions).toEqual([]);
  });
});
