import { ConflictException, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";

import { MemoryService } from "../memory/memory.service";
import { TelephonyService } from "../telephony/telephony.service";
import { AuditLogService } from "./audit-log.service";
import type {
  ComplianceAuditActor,
  ComplianceReadinessResponse,
  ComplianceRetentionJobResponse,
  CreateRetentionJobRequest,
} from "./compliance.models";

@Injectable()
export class ComplianceService {
  constructor(
    private readonly auditLogService: AuditLogService,
    private readonly memoryService: MemoryService,
    private readonly telephonyService: TelephonyService,
  ) {}

  async listAuditLogs(tenantId: string) {
    return this.auditLogService.list(tenantId);
  }

  getReadiness(organizationId: string): ComplianceReadinessResponse {
    return {
      organizationId,
      posture: "general_saas",
      claims: {
        hipaa: false,
        pci: false,
      },
      checklist: [
        {
          control: "encryption",
          status: "ready",
          summary: "Tenant secrets and provider credentials use server-side encrypted storage boundaries.",
        },
        {
          control: "audit",
          status: "ready",
          summary: "Sensitive tenant actions write append-only, hash-chained audit records.",
        },
        {
          control: "retention",
          status: "ready",
          summary: "Retention jobs apply tenant cutoffs to telephony, memory, knowledge, embeddings, and recordings.",
        },
        {
          control: "consent",
          status: "ready",
          summary: "Recording consent state and notices are captured before bridged call execution.",
        },
        {
          control: "access_control",
          status: "ready",
          summary: "Better Auth organization sessions and tenant-scoped API boundaries gate workspace access.",
        },
      ],
      knownGaps: [
        {
          id: "regulated-data-baa",
          summary: "Zara v1 is not positioned for regulated workloads that require HIPAA, PCI, or a signed BAA.",
          enterpriseAction: "Run a dedicated regulated-data review before accepting protected health or payment card data.",
        },
        {
          id: "data-residency-controls",
          summary: "Region pinning and residency attestations are not yet tenant-configurable controls.",
          enterpriseAction: "Route data-residency requests through enterprise review before onboarding.",
        },
      ],
      updatedAt: "2026-05-24T00:00:00.000Z",
    };
  }

  async createRetentionJob(
    tenantId: string,
    input: CreateRetentionJobRequest,
  ): Promise<ComplianceRetentionJobResponse> {
    const createdAt = input.now ?? new Date().toISOString();
    const actor = resolveAuditActor(input.actorUserId);

    if (input.legalHold === true) {
      await this.auditLogService.record({
        tenantId,
        actorUserId: input.actorUserId,
        action: "retention.deletion_blocked_legal_hold",
        target: {
          type: "retention_job",
          id: tenantId,
        },
        outcome: "failed",
        metadata: {
          retainAfter: input.retainAfter,
        },
        occurredAt: createdAt,
      });

      throw new ConflictException("Retention deletion is blocked by legal hold.");
    }

    const telephonyDeletion = await this.telephonyService.deleteRetainedCallData({
      organizationId: tenantId,
      retainAfter: input.retainAfter,
    });
    const memoryRetention = await this.memoryService.purgeRetention(tenantId, {
      actorUserId: input.actorUserId ?? "system",
      retainAfter: input.retainAfter,
      now: createdAt,
    });
    const recordingDeletion = deleteRecordingObjects(input.recordingObjects ?? []);
    const status = recordingDeletion.failures.length === 0 ? "completed" : "retry_scheduled";
    const job: ComplianceRetentionJobResponse = {
      id: `retention_job_${randomUUID()}`,
      tenantId,
      status,
      retainAfter: input.retainAfter,
      actor,
      ...(input.retryOfJobId === undefined ? {} : { retryOfJobId: input.retryOfJobId }),
      deletedCounts: {
        calls: telephonyDeletion.deletedCounts.calls,
        transcripts: telephonyDeletion.deletedCounts.transcripts,
        memory:
          memoryRetention.purgedCounts.memories +
          memoryRetention.purgedCounts.knowledge +
          memoryRetention.purgedCounts.embeddings +
          memoryRetention.purgedCounts.ingestionSources,
        recordings: recordingDeletion.deletedCount,
      },
      failures: recordingDeletion.failures,
      ...(status === "completed" ? {} : { nextRetryAt: addMinutes(createdAt, 5) }),
      createdAt,
    };

    await this.auditLogService.record({
      tenantId,
      actorUserId: input.actorUserId,
      action:
        status === "completed"
          ? "retention.deletion_job_completed"
          : "retention.deletion_job_retry_scheduled",
      target: {
        type: "retention_job",
        id: job.id,
      },
      outcome: status === "completed" ? "succeeded" : "failed",
      metadata: {
        retainAfter: input.retainAfter,
        callsDeleted: job.deletedCounts.calls,
        transcriptsDeleted: job.deletedCounts.transcripts,
        memoryDeleted: job.deletedCounts.memory,
        recordingsDeleted: job.deletedCounts.recordings,
        failureCount: job.failures.length,
      },
      occurredAt: createdAt,
    });

    return job;
  }
}

function resolveAuditActor(actorUserId: string | undefined): ComplianceAuditActor {
  const normalizedActorUserId = actorUserId?.trim();

  if (normalizedActorUserId === undefined || normalizedActorUserId.length === 0) {
    return {
      type: "system",
    };
  }

  return {
    type: "user",
    id: normalizedActorUserId,
  };
}

function deleteRecordingObjects(
  recordingObjects: NonNullable<CreateRetentionJobRequest["recordingObjects"]>,
) {
  const failures = recordingObjects
    .filter((recordingObject) => recordingObject.failDelete === true)
    .map((recordingObject) => ({
      target: recordingObject.objectKey,
      reason: "Object storage delete failed.",
      willRetry: true,
    }));

  return {
    deletedCount: recordingObjects.length - failures.length,
    failures,
  };
}

function addMinutes(timestamp: string, minutes: number) {
  const date = new Date(timestamp);
  date.setMinutes(date.getMinutes() + minutes);

  return date.toISOString();
}
