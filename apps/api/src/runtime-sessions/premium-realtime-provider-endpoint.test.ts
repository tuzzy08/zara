import { describe, expect, it } from "vitest";

import { resolvePremiumRealtimeProviderEndpoint } from "./premium-realtime-provider-transport";

describe("resolvePremiumRealtimeProviderEndpoint", () => {
  it("rejects simulator transport in production", () => {
    expect(() => resolvePremiumRealtimeProviderEndpoint({
      NODE_ENV: "production",
      ZARA_PREMIUM_REALTIME_TRANSPORT: "simulator",
      ZARA_PREMIUM_REALTIME_SIMULATOR_URL: "ws://127.0.0.1:4319/realtime",
    })).toThrow("Premium realtime protocol simulator cannot run in production.");
  });

  it("selects the external simulator only in test or staging", () => {
    expect(resolvePremiumRealtimeProviderEndpoint({
      NODE_ENV: "test",
      ZARA_PREMIUM_REALTIME_TRANSPORT: "simulator",
      ZARA_PREMIUM_REALTIME_SIMULATOR_URL: "ws://127.0.0.1:4319/realtime",
    })).toEqual({
      mode: "simulator",
      url: "ws://127.0.0.1:4319/realtime",
    });
  });

  it("requires wss for non-loopback staging simulators", () => {
    expect(() => resolvePremiumRealtimeProviderEndpoint({
      NODE_ENV: "staging",
      ZARA_PREMIUM_REALTIME_TRANSPORT: "simulator",
      ZARA_PREMIUM_REALTIME_SIMULATOR_URL: "ws://simulator.internal.example/realtime",
    })).toThrow("must use wss outside loopback");

    expect(resolvePremiumRealtimeProviderEndpoint({
      NODE_ENV: "staging",
      ZARA_PREMIUM_REALTIME_TRANSPORT: "simulator",
      ZARA_PREMIUM_REALTIME_SIMULATOR_URL: "wss://simulator.internal.example/realtime",
      ZARA_PREMIUM_REALTIME_SIMULATOR_TOKEN: "staging-simulator-token-at-least-32-characters",
    })).toEqual({
      mode: "simulator",
      token: "staging-simulator-token-at-least-32-characters",
      url: "wss://simulator.internal.example/realtime",
    });
  });
});
