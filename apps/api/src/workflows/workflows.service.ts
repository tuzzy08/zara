import { BadRequestException, Injectable } from "@nestjs/common";
import {
  compileRuntimeManifest,
  createWorkflowGraph,
  publishWorkflowVersion,
  type BuildRuntimeManifestPreviewInput,
  type ModelRoutingRule,
  type PublishedWorkflowVersion,
  type RuntimeManifestPreviewBudgetConfig,
  type RuntimeManifestPreviewMemoryConfig,
  type RuntimeProfileId,
  type TelemetryPolicy,
  type TenantEnvironment,
  type TelephonyProvider,
  type VoiceRuntimeKind,
  type WorkflowGraph,
} from "@zara/core";

import { ToolPermissionGrantsService } from "../integrations/tool-permission-grants.service";

export interface PublishWorkflowRequest {
  actorUserId?: string | undefined;
  workspaceId?: string | undefined;
  environment?: TenantEnvironment | undefined;
  graph?: WorkflowGraph | undefined;
  existingVersions?: PublishedWorkflowVersion[] | undefined;
  runtime?: VoiceRuntimeKind | undefined;
  runtimeProfile?: RuntimeProfileId | undefined;
  telephonyProvider?: TelephonyProvider | undefined;
  memory?: RuntimeManifestPreviewMemoryConfig | undefined;
  budget?: RuntimeManifestPreviewBudgetConfig | undefined;
  modelRouting?: ModelRoutingRule[] | undefined;
  telemetry?: TelemetryPolicy | undefined;
  now?: string | undefined;
}

@Injectable()
export class WorkflowsService {
  constructor(
    private readonly toolPermissionGrantsService: ToolPermissionGrantsService,
  ) {}

  async publishWorkflow(input: {
    organizationId: string;
    workflowId: string;
    request: PublishWorkflowRequest;
  }) {
    const workspaceId = readRequiredString(input.request.workspaceId, "workspaceId");
    const actorUserId = readRequiredString(input.request.actorUserId, "actorUserId");
    const graph = readWorkflowGraph(input.request.graph);
    const memory = readRequiredObject(input.request.memory, "memory");
    const budget = readRequiredObject(input.request.budget, "budget");
    const candidatePublishedVersion = publishWorkflowVersion({
      tenantId: input.organizationId,
      workspaceId,
      environment: input.request.environment ?? "production",
      workflowId: input.workflowId,
      graph,
      existingVersions: input.request.existingVersions ?? [],
      runtime: input.request.runtime ?? "sandwich-pipeline",
      runtimeProfile: input.request.runtimeProfile,
      telephonyProvider: input.request.telephonyProvider ?? "browser-webrtc",
      memory,
      budget,
      createdBy: actorUserId,
      createdAt: input.request.now,
    });
    const manifest = compileRuntimeManifest({
      publishedVersion: candidatePublishedVersion,
      modelRouting: input.request.modelRouting ?? defaultModelRouting,
      telemetry: input.request.telemetry ?? defaultTelemetry,
    });
    const grantValidation = await this.toolPermissionGrantsService.validateToolGrantsForPublish({
      organizationId: input.organizationId,
      workspaceId,
      manifest,
    });

    if (!grantValidation.ok) {
      throw new BadRequestException({
        message: "Workflow publish blocked by invalid integration tool grants.",
        code: "workflow_publish_tool_grants_invalid",
        errors: grantValidation.errors,
      });
    }

    return {
      publishedVersion: candidatePublishedVersion,
      manifest,
      grantValidation,
    };
  }
}

function readRequiredString(value: string | undefined, fieldName: string) {
  if (value === undefined || value.trim().length === 0) {
    throw new BadRequestException(`Workflow publish requires ${fieldName}.`);
  }

  return value.trim();
}

function readWorkflowGraph(value: WorkflowGraph | undefined) {
  if (value === undefined) {
    throw new BadRequestException("Workflow publish requires graph.");
  }

  try {
    return createWorkflowGraph(value);
  } catch {
    throw new BadRequestException("Workflow publish requires a valid workflow graph.");
  }
}

function readRequiredObject<TValue extends object>(
  value: TValue | undefined,
  fieldName: keyof BuildRuntimeManifestPreviewInput,
) {
  if (value === undefined || value === null) {
    throw new BadRequestException(`Workflow publish requires ${String(fieldName)}.`);
  }

  return value;
}

const defaultModelRouting: ModelRoutingRule[] = [
  {
    id: "default-workflow-publish-route",
    priority: 1,
    when: {
      callPhase: "greeting",
    },
    useTier: "standard",
    reason: "Default publish-time manifest compilation route.",
  },
];

const defaultTelemetry: TelemetryPolicy = {
  captureAudio: false,
  captureTranscript: true,
  redactSensitiveData: true,
  sinks: ["live-monitor"],
};
