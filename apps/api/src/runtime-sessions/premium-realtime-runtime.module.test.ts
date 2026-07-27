import { MODULE_METADATA } from "@nestjs/common/constants";
import { describe, expect, it } from "vitest";

import { premiumRealtimeProviderTransportToken } from "./premium-realtime-provider-transport";
import { PremiumRealtimeRuntimeModule } from "./premium-realtime-runtime.module";
import { RuntimeSessionsService } from "./runtime-sessions.service";

describe("PremiumRealtimeRuntimeModule", () => {
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
