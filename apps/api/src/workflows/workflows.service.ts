import { BadRequestException, ConflictException, Inject, Injectable } from "@nestjs/common";
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
import { MemoryService } from "../memory/memory.service";
import {
  PUBLISHED_WORKFLOW_MANIFEST_REPOSITORY,
  WorkflowPublicationConflictError,
  type PublishedWorkflowManifestRepository,
} from "./published-workflow-manifest.repository";

export interface PublishWorkflowRequest {
  actorUserId?: string | undefined;
  workspaceId?: string | undefined;
  environment?: TenantEnvironment | undefined;
  graph?: WorkflowGraph | undefined;
  existingVersions?: PublishedWorkflowVersion[] | undefined;
  expectedVersion?: number | undefined;
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
    private readonly memoryService: MemoryService,
    @Inject(PUBLISHED_WORKFLOW_MANIFEST_REPOSITORY)
    private readonly publishedWorkflowManifestRepository: PublishedWorkflowManifestRepository,
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
    const expectedVersion = readExpectedVersion(input.request);
    const createPublication = (versionNumber: number) => {
      const publishedVersion = publishWorkflowVersion({
        tenantId: input.organizationId,
        workspaceId,
        environment: input.request.environment ?? "production",
        workflowId: input.workflowId,
        graph,
        existingVersions: [],
        versionNumber,
        runtime: input.request.runtime ?? "sandwich-pipeline",
        runtimeProfile: input.request.runtimeProfile,
        telephonyProvider: input.request.telephonyProvider ?? "browser-webrtc",
        memory,
        budget,
        createdBy: actorUserId,
        createdAt: input.request.now,
      });
      return {
        publishedVersion,
        manifest: compileRuntimeManifest({
          publishedVersion,
          modelRouting: input.request.modelRouting ?? defaultModelRouting,
          telemetry: input.request.telemetry ?? defaultTelemetry,
        }),
      };
    };
    const knowledgeConflictValidation = await this.memoryService.validateKnowledgeConflictsForPublish({
      organizationId: input.organizationId,
      workspaceId,
      workflowId: input.workflowId,
      now: input.request.now,
    });

    if (!knowledgeConflictValidation.canPublish) {
      throw new BadRequestException({
        message: "Workflow publish blocked by unresolved high-risk knowledge conflicts.",
        code: "workflow_publish_knowledge_conflicts_unresolved",
        warnings: knowledgeConflictValidation.warnings,
        publishBlockers: knowledgeConflictValidation.publishBlockers,
      });
    }

    try {
      const publication = await this.publishedWorkflowManifestRepository.publish({
        organizationId: input.organizationId,
        workspaceId,
        workflowId: input.workflowId,
        expectedVersion,
        createPublication: async (versionNumber) => {
          const candidate = createPublication(versionNumber);
          await this.toolPermissionGrantsService.ensureToolGrantsForPublish({
            organizationId: input.organizationId,
            workspaceId,
            actorUserId,
            now: input.request.now,
            manifest: candidate.manifest,
          });
          const grantValidation = await this.toolPermissionGrantsService.validateToolGrantsForPublish({
            organizationId: input.organizationId,
            workspaceId,
            manifest: candidate.manifest,
          });
          if (!grantValidation.ok) {
            throw new BadRequestException({
              message: "Workflow publish blocked by invalid integration tool grants.",
              code: "workflow_publish_tool_grants_invalid",
              errors: grantValidation.errors,
            });
          }
          return { ...candidate, grantValidation };
        },
      });
      return { ...publication, knowledgeConflictValidation };
    } catch (error) {
      if (error instanceof WorkflowPublicationConflictError) {
        throw new ConflictException({
          message: error.message,
          code: "workflow_publish_conflict",
          expectedVersion,
          ...(error.currentVersion === undefined ? {} : { currentVersion: error.currentVersion }),
        });
      }
      throw error;
    }
  }

  getPublishedManifest(input: {
    organizationId: string;
    publishedVersionId: string;
  }) {
    return this.publishedWorkflowManifestRepository.load(input);
  }
}

function readExpectedVersion(request: PublishWorkflowRequest) {
  let expectedVersion = request.expectedVersion;
  if (expectedVersion === undefined) {
    if (request.existingVersions !== undefined && !Array.isArray(request.existingVersions)) {
      throw new BadRequestException("Workflow publish requires a valid version history.");
    }
    expectedVersion = 0;
    for (const version of request.existingVersions ?? []) {
      if (version === null || !Number.isSafeInteger(version.version) || version.version < 1) {
        throw new BadRequestException("Workflow publish requires a valid version history.");
      }
      expectedVersion = Math.max(expectedVersion, version.version);
    }
  }
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0 || expectedVersion >= Number.MAX_SAFE_INTEGER) {
    throw new BadRequestException("Workflow publish expectedVersion must be a non-negative safe integer below the version limit.");
  }
  return expectedVersion;
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
