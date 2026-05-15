import { describe, expect, it } from "vitest";

import { resolveTelephonySecretVaultConfig } from "./telephony-env";

describe("resolveTelephonySecretVaultConfig", () => {
  it("parses the active key version and legacy telephony credential keys from env", () => {
    const config = resolveTelephonySecretVaultConfig({
      TELEPHONY_CREDENTIAL_MASTER_KEY: "current-master-secret-123456789012",
      TELEPHONY_CREDENTIAL_KEY_VERSION: "8",
      TELEPHONY_CREDENTIAL_LEGACY_KEYS:
        "{\"7\":\"legacy-master-secret-123456789012\"}",
    });

    expect(config).toEqual({
      masterSecret: "current-master-secret-123456789012",
      keyVersion: 8,
      legacyMasterSecretsByVersion: {
        7: "legacy-master-secret-123456789012",
      },
    });
  });

  it("falls back safely when the legacy-key env payload is missing or invalid", () => {
    expect(
      resolveTelephonySecretVaultConfig({
        TELEPHONY_CREDENTIAL_MASTER_KEY: "current-master-secret-123456789012",
        TELEPHONY_CREDENTIAL_KEY_VERSION: "8",
      }).legacyMasterSecretsByVersion,
    ).toEqual({});

    expect(
      resolveTelephonySecretVaultConfig({
        TELEPHONY_CREDENTIAL_MASTER_KEY: "current-master-secret-123456789012",
        TELEPHONY_CREDENTIAL_KEY_VERSION: "8",
        TELEPHONY_CREDENTIAL_LEGACY_KEYS: "not-json",
      }).legacyMasterSecretsByVersion,
    ).toEqual({});
  });
});
