import { Module } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { TelephonyController } from "./telephony.controller";
import { FileTelephonyStateRepository } from "./telephony-state.repository";
import { TelephonySecretVault } from "./telephony-secret-vault";
import { TelephonyService } from "./telephony.service";

@Module({
  controllers: [TelephonyController],
  providers: [
    TelephonyService,
    {
      provide: FileTelephonyStateRepository,
      useFactory: () =>
        new FileTelephonyStateRepository(
          process.env.NODE_ENV === "test"
            ? join(tmpdir(), "zara-telephony-tests", randomUUID())
            : (process.env.ZARA_TELEPHONY_DATA_DIR ?? join(process.cwd(), ".zara-data", "telephony")),
        ),
    },
    {
      provide: TelephonySecretVault,
      useFactory: () =>
        new TelephonySecretVault({
          masterSecret:
            process.env.TELEPHONY_CREDENTIAL_MASTER_KEY
            ?? process.env.BETTER_AUTH_SECRET
            ?? "dev-telephony-secret-12345678901234567890",
          keyVersion: Number.parseInt(process.env.TELEPHONY_CREDENTIAL_KEY_VERSION ?? "1", 10) || 1,
        }),
    },
  ],
  exports: [TelephonyService],
})
export class TelephonyModule {}
