import { Module } from "@nestjs/common";
import { join } from "node:path";

import {
  AUDIT_LOG_REPOSITORY,
  FileAuditLogRepository,
} from "./audit-log.repository";
import { AuditLogService } from "./audit-log.service";

@Module({
  providers: [
    AuditLogService,
    {
      provide: AUDIT_LOG_REPOSITORY,
      useFactory: () =>
        new FileAuditLogRepository(
          process.env.ZARA_AUDIT_LOG_STATE_DIR ?? join(process.cwd(), ".zara", "audit"),
        ),
    },
  ],
  exports: [AuditLogService],
})
export class AuditLogModule {}
