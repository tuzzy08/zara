import { describe, expect, it } from "vitest";

import { readLoadCommandConfig } from "./load-config";

describe("PSTN load command config", () => {
  it("loads tenant secrets from an external file and keeps release execution approval explicit", () => {
    const config = readLoadCommandConfig({
      NODE_ENV: "staging",
      ZARA_PSTN_LOAD_APPROVED: "true",
      ZARA_PSTN_LOAD_TENANTS_FILE: "C:/secure/pstn-load-tenants.json",
      ZARA_PSTN_LOAD_TELEMETRY_URL: "https://api.example.test/platform-admin/runtime/ai-observability",
      ZARA_PSTN_LOAD_TELEMETRY_BEARER_TOKEN: "service-secret",
      ZARA_PSTN_LOAD_QUALIFIED_TARGET: "20",
      ZARA_PSTN_LOAD_PROVIDER: "openai-realtime",
      ZARA_PSTN_LOAD_REPORT_DIR: "artifacts/custom-load",
    }, "stepped", () => JSON.stringify({ tenants: [{
      accountSid: "AC-one",
      authToken: "twilio-secret",
      from: "+15550001111",
      webhookUrl: "https://api.example.test/telephony/webhooks/twilio",
      destinations: {
        default: "+15550002222",
        "tool-call": "+15550002223",
        "same-provider-handoff": "+15550002224",
        "cross-provider-handoff": "+15550002225",
        "exporter-failure": "+15550002226",
      },
    }] }));

    expect(config).toMatchObject({
      environment: "staging",
      approved: true,
      profile: { name: "stepped" },
      qualifiedTarget: 20,
      provider: "openai-realtime",
      reportDirectory: "artifacts/custom-load",
      telemetry: { bearerToken: "service-secret" },
      tenants: [{ accountSid: "AC-one", authToken: "twilio-secret" }],
    });
  });

  it("rejects production, unapproved release load, inline/malformed secrets, and cross-tenant underconfiguration", () => {
    const validFile = () => JSON.stringify({ tenants: [tenant("AC-one"), tenant("AC-two")] });
    const base = {
      NODE_ENV: "staging",
      ZARA_PSTN_LOAD_TENANTS_FILE: "C:/secure/pstn-load-tenants.json",
      ZARA_PSTN_LOAD_TELEMETRY_URL: "https://api.example.test/platform-admin/runtime/ai-observability",
    };

    expect(() => readLoadCommandConfig({ ...base, NODE_ENV: "production" }, "ci-smoke", validFile))
      .toThrow("test or staging");
    expect(() => readLoadCommandConfig(base, "stepped", validFile)).toThrow("ZARA_PSTN_LOAD_APPROVED=true");
    expect(() => readLoadCommandConfig({ ...base, ZARA_PSTN_LOAD_TENANTS_JSON: "secret" }, "ci-smoke", validFile))
      .toThrow("external tenant config file");
    expect(() => readLoadCommandConfig(
      { ...base, ZARA_PSTN_LOAD_APPROVED: "true" },
      "burst",
      () => JSON.stringify({ tenants: [tenant("AC-one")] }),
    ))
      .toThrow("at least two tenant routes");
  });

  it("rejects unknown scenario destination keys instead of silently using the default route", () => {
    expect(() => readLoadCommandConfig({
      NODE_ENV: "test",
      ZARA_PSTN_LOAD_TENANTS_FILE: "C:/secure/pstn-load-tenants.json",
      ZARA_PSTN_LOAD_TELEMETRY_URL: "https://api.example.test/platform-admin/runtime/ai-observability",
    }, "ci-smoke", () => JSON.stringify({ tenants: [{
      ...tenant("AC-one"),
      destinations: {
        default: "+15550002222",
        "interuption-clear": "+15550003333",
      },
    }] }))).toThrow(/unknown destination 'interuption-clear'/i);
  });

  it("bounds the qualified target and requires specialized routes used by a profile", () => {
    const base = {
      NODE_ENV: "staging",
      ZARA_PSTN_LOAD_APPROVED: "true",
      ZARA_PSTN_LOAD_TENANTS_FILE: "C:/secure/pstn-load-tenants.json",
      ZARA_PSTN_LOAD_TELEMETRY_URL: "https://api.example.test/platform-admin/runtime/ai-observability",
    };
    expect(() => readLoadCommandConfig({
      ...base,
      ZARA_PSTN_LOAD_QUALIFIED_TARGET: "10000",
    }, "failure", () => JSON.stringify({ tenants: [tenant("AC-one")] })))
      .toThrow(/at most 100/i);
    expect(() => readLoadCommandConfig(base, "failure", () => JSON.stringify({
      tenants: [tenant("AC-one")],
    }))).toThrow(/requires.*tool-call.*destination/i);
    expect(() => readLoadCommandConfig({
      ...base,
      ZARA_PSTN_LOAD_PROVIDER: "Bearer secret",
    }, "ci-smoke", () => JSON.stringify({ tenants: [{
      ...tenant("AC-one"),
      destinations: { default: "+15550002222", "tool-call": "+15550002223" },
    }] })))
      .toThrow(/provider.*bounded identifier/i);
  });
});

function tenant(accountSid: string) {
  return {
    accountSid,
    authToken: `${accountSid}-secret`,
    from: "+15550001111",
    webhookUrl: "https://api.example.test/telephony/webhooks/twilio",
    destinations: { default: "+15550002222" },
  };
}
