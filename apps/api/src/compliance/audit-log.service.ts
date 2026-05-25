import { Inject, Injectable } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";

import {
  AUDIT_LOG_REPOSITORY,
  type AuditLogRepository,
} from "./audit-log.repository";
import type {
  ComplianceAuditActor,
  ComplianceAuditLogEntry,
  ComplianceAuditTarget,
} from "./compliance.models";

@Injectable()
export class AuditLogService {
  constructor(
    @Inject(AUDIT_LOG_REPOSITORY)
    private readonly auditLogRepository: AuditLogRepository,
  ) {}

  async list(tenantId: string): Promise<ComplianceAuditLogEntry[]> {
    const entries = await this.auditLogRepository.list(tenantId);

    return entries.map(cloneAuditLogEntry);
  }

  async record(input: {
    tenantId: string;
    actorUserId?: string | undefined;
    action: string;
    target: ComplianceAuditTarget;
    outcome: "succeeded" | "failed";
    metadata?: Record<string, string | number | boolean> | undefined;
    occurredAt?: string | undefined;
  }): Promise<ComplianceAuditLogEntry> {
    const existingEntries = await this.auditLogRepository.list(input.tenantId);
    const previousHash = existingEntries.at(-1)?.hash ?? null;
    const entryWithoutHash = {
      id: `audit_${randomUUID()}`,
      tenantId: input.tenantId,
      actor: resolveAuditActor(input.actorUserId),
      action: input.action,
      target: { ...input.target },
      outcome: input.outcome,
      occurredAt: input.occurredAt ?? new Date().toISOString(),
      metadata: { ...(input.metadata ?? {}) },
      previousHash,
    };
    const entry: ComplianceAuditLogEntry = {
      ...entryWithoutHash,
      hash: hashAuditEntry(entryWithoutHash),
    };

    await this.auditLogRepository.append(input.tenantId, entry);

    return cloneAuditLogEntry(entry);
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

function hashAuditEntry(entry: Omit<ComplianceAuditLogEntry, "hash">) {
  return createHash("sha256")
    .update(JSON.stringify(entry))
    .digest("hex");
}

function cloneAuditLogEntry(entry: ComplianceAuditLogEntry): ComplianceAuditLogEntry {
  return {
    ...entry,
    actor: { ...entry.actor },
    target: { ...entry.target },
    metadata: { ...entry.metadata },
  };
}
