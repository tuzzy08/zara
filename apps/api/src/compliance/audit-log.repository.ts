import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import type { ComplianceAuditLogEntry } from "./compliance.models";

export const AUDIT_LOG_REPOSITORY = Symbol("AUDIT_LOG_REPOSITORY");

export interface AuditLogRepository {
  list(tenantId: string): ComplianceAuditLogEntry[] | Promise<ComplianceAuditLogEntry[]>;
  append(tenantId: string, entry: ComplianceAuditLogEntry): void | Promise<void>;
}

export class FileAuditLogRepository implements AuditLogRepository {
  constructor(private readonly directoryPath: string) {}

  list(tenantId: string): ComplianceAuditLogEntry[] {
    const filePath = resolveAuditFilePath(this.directoryPath, tenantId);

    if (!existsSync(filePath)) {
      return [];
    }

    const parsed = JSON.parse(readFileSync(filePath, "utf8"));

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(isAuditLogEntry);
  }

  append(tenantId: string, entry: ComplianceAuditLogEntry) {
    mkdirSync(this.directoryPath, { recursive: true });

    const filePath = resolveAuditFilePath(this.directoryPath, tenantId);
    const temporaryFilePath = `${filePath}.tmp`;
    const entries = [...this.list(tenantId), entry];

    writeFileSync(temporaryFilePath, JSON.stringify(entries, null, 2), "utf8");
    rmSync(filePath, { force: true });
    renameSync(temporaryFilePath, filePath);
  }
}

function resolveAuditFilePath(directoryPath: string, tenantId: string) {
  return join(directoryPath, `${tenantId}.json`);
}

function isAuditLogEntry(value: unknown): value is ComplianceAuditLogEntry {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<ComplianceAuditLogEntry>;

  return (
    typeof candidate.id === "string" &&
    typeof candidate.tenantId === "string" &&
    typeof candidate.action === "string" &&
    typeof candidate.occurredAt === "string" &&
    typeof candidate.hash === "string" &&
    (candidate.previousHash === null || typeof candidate.previousHash === "string")
  );
}
