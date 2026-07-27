import { Test } from "@nestjs/testing";
import { describe, expect, it } from "vitest";

import { pstnCallObservabilityRecorderToken } from "../runtime-observability/runtime-observability";
import { premiumRealtimeProviderTransportToken } from "../runtime-sessions/premium-realtime-provider-transport";
import { RuntimeSessionsService } from "../runtime-sessions/runtime-sessions.service";
import { PstnPremiumCallExecution } from "./pstn-premium-call-execution";
import { TelephonyService } from "./telephony.service";
import { TELEPHONY_INCREMENTAL_REPOSITORY } from "./telephony-incremental.repository";

describe("PstnPremiumCallExecution Nest wiring", () => {
  it("resolves service dependencies through their module provider tokens", async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        PstnPremiumCallExecution,
        { provide: TelephonyService, useValue: {} },
        { provide: TELEPHONY_INCREMENTAL_REPOSITORY, useValue: {} },
        { provide: RuntimeSessionsService, useValue: {} },
        { provide: premiumRealtimeProviderTransportToken, useValue: {} },
        { provide: pstnCallObservabilityRecorderToken, useValue: {} },
      ],
    }).compile();

    expect(moduleRef.get(PstnPremiumCallExecution)).toBeInstanceOf(PstnPremiumCallExecution);
  });
});
