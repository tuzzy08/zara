import type {
  PublishedWorkflowVersion,
  RuntimeManifestPreview,
  RuntimeProfileId,
  TelephonyProvider,
  TenantEnvironment,
  VoiceRuntimeKind,
  WorkflowGraph,
} from "@zara/core";

import { requestJson } from "./apiClient";

export interface PublishTenantWorkflowInput {
  organizationId: string;
  workflowId: string;
  actorUserId: string;
  workspaceId: string;
  environment: TenantEnvironment;
  graph: WorkflowGraph;
  existingVersions: PublishedWorkflowVersion[];
  runtime: VoiceRuntimeKind;
  runtimeProfile: RuntimeProfileId;
  telephonyProvider: TelephonyProvider;
  memory: RuntimeManifestPreview["memory"];
  budget: RuntimeManifestPreview["budget"];
}

export interface PublishTenantWorkflowResponse {
  publishedVersion: PublishedWorkflowVersion;
  grantValidation: {
    ok: boolean;
    errors: unknown[];
  };
}

export function publishTenantWorkflow(
  input: PublishTenantWorkflowInput,
): Promise<PublishTenantWorkflowResponse> {
  const { organizationId, workflowId, ...body } = input;

  return requestJson<PublishTenantWorkflowResponse>(
    `/organizations/${encodeURIComponent(organizationId)}/workflows/${encodeURIComponent(workflowId)}/publish`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}
