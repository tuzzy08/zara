export function resolveTelephonySecretVaultConfig(
  env: Record<string, string | undefined>,
) {
  return {
    masterSecret:
      env.TELEPHONY_CREDENTIAL_MASTER_KEY
      ?? env.BETTER_AUTH_SECRET
      ?? "dev-telephony-secret-12345678901234567890",
    keyVersion: Number.parseInt(env.TELEPHONY_CREDENTIAL_KEY_VERSION ?? "1", 10) || 1,
    legacyMasterSecretsByVersion: parseLegacyTelephonySecrets(
      env.TELEPHONY_CREDENTIAL_LEGACY_KEYS,
    ),
  };
}

function parseLegacyTelephonySecrets(value: string | undefined) {
  if (value === undefined || value.trim().length === 0) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;

    return Object.fromEntries(
      Object.entries(parsed)
        .map(([key, secret]) => [Number.parseInt(key, 10), secret] as const)
        .filter(
          ([version, secret]) =>
            Number.isFinite(version) &&
            typeof secret === "string" &&
            secret.trim().length > 0,
        ),
    ) as Record<number, string>;
  } catch {
    return {};
  }
}
