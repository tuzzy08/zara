import { MODULE_METADATA } from "@nestjs/common/constants";
import { describe, expect, it } from "vitest";

import { premiumRealtimeProviderTransportToken } from "./premium-realtime-provider-transport";
import { RuntimeSessionsModule } from "./runtime-sessions.module";

describe("RuntimeSessionsModule", () => {
  it("runs the premium simulator production guard during provider startup", () => {
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, RuntimeSessionsModule) as Array<unknown>;
    const provider = providers.find((candidate) =>
      typeof candidate === "object"
      && candidate !== null
      && "provide" in candidate
      && candidate.provide === premiumRealtimeProviderTransportToken) as { useFactory: () => unknown } | undefined;
    const previous = {
      NODE_ENV: process.env.NODE_ENV,
      transport: process.env.ZARA_PREMIUM_REALTIME_TRANSPORT,
      url: process.env.ZARA_PREMIUM_REALTIME_SIMULATOR_URL,
    };
    process.env.NODE_ENV = "production";
    process.env.ZARA_PREMIUM_REALTIME_TRANSPORT = "simulator";
    process.env.ZARA_PREMIUM_REALTIME_SIMULATOR_URL = "ws://127.0.0.1:4319/realtime";

    try {
      expect(provider).toBeDefined();
      expect(() => provider?.useFactory()).toThrow("cannot run in production");
    } finally {
      restoreEnv("NODE_ENV", previous.NODE_ENV);
      restoreEnv("ZARA_PREMIUM_REALTIME_TRANSPORT", previous.transport);
      restoreEnv("ZARA_PREMIUM_REALTIME_SIMULATOR_URL", previous.url);
    }
  });
});

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
