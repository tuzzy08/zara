import { MODULE_METADATA } from "@nestjs/common/constants";
import { describe, expect, it } from "vitest";

import { premiumRealtimeProviderTransportToken } from "./premium-realtime-provider-transport";
import { PremiumRealtimeRuntimeModule } from "./premium-realtime-runtime.module";
import { RuntimeSessionsService } from "./runtime-sessions.service";
import { DatabaseModule } from "../database/database.module";
import { PostgresPoolService } from "../database/postgres-pool.service";

describe("PremiumRealtimeRuntimeModule", () => {
  it("provides the database dependency for live transport usage recording", () => {
    expect(Reflect.getMetadata(MODULE_METADATA.IMPORTS, PremiumRealtimeRuntimeModule)).toContain(DatabaseModule);
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, PremiumRealtimeRuntimeModule) as
      Array<{ provide?: unknown; inject?: unknown[] }>;
    expect(providers.find(provider => provider.provide === premiumRealtimeProviderTransportToken)?.inject)
      .toContain(PostgresPoolService);
  });
  it("exports premium runtime providers without HTTP or WebSocket controllers", () => {
    expect(
      Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, PremiumRealtimeRuntimeModule),
    ).toBeUndefined();
    const exports = Reflect.getMetadata(
      MODULE_METADATA.EXPORTS,
      PremiumRealtimeRuntimeModule,
    ) as unknown[];
    expect(exports).toContain(RuntimeSessionsService);
    expect(exports).toContain(premiumRealtimeProviderTransportToken);
  });
});
