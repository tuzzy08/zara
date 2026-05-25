import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export interface EncryptedIntegrationSecretEnvelope {
  algorithm: "aes-256-gcm";
  keyVersion: number;
  iv: string;
  authTag: string;
  ciphertext: string;
}

export class IntegrationSecretVault {
  constructor(
    private readonly input: {
      masterSecret: string;
      keyVersion: number;
      legacyMasterSecretsByVersion?: Record<number, string> | undefined;
    },
  ) {}

  get currentKeyVersion() {
    return this.input.keyVersion;
  }

  seal(payload: object) {
    const normalizedPayload = Object.fromEntries(
      Object.entries(payload).filter(([, value]) => typeof value === "string" && value.length > 0),
    );

    if (Object.keys(normalizedPayload).length === 0) {
      return undefined;
    }

    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", deriveKey(this.input.masterSecret), iv);
    const encrypted = Buffer.concat([
      cipher.update(JSON.stringify(normalizedPayload), "utf8"),
      cipher.final(),
    ]);

    return {
      algorithm: "aes-256-gcm" as const,
      keyVersion: this.input.keyVersion,
      iv: iv.toString("base64"),
      authTag: cipher.getAuthTag().toString("base64"),
      ciphertext: encrypted.toString("base64"),
    };
  }

  open(envelope: EncryptedIntegrationSecretEnvelope | undefined) {
    if (envelope === undefined) {
      return {};
    }

    const masterSecret = resolveMasterSecretForVersion({
      currentMasterSecret: this.input.masterSecret,
      currentKeyVersion: this.input.keyVersion,
      legacyMasterSecretsByVersion: this.input.legacyMasterSecretsByVersion,
      requestedKeyVersion: envelope.keyVersion,
    });
    const decipher = createDecipheriv(
      envelope.algorithm,
      deriveKey(masterSecret),
      Buffer.from(envelope.iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(envelope.authTag, "base64"));

    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
    const parsed = JSON.parse(decrypted);

    if (parsed === null || typeof parsed !== "object") {
      throw new Error("Integration secret envelope did not decrypt to an object.");
    }

    return parsed as Record<string, string | undefined>;
  }
}

export function resolveIntegrationSecretVaultConfig(
  env: Record<string, string | undefined>,
) {
  return {
    masterSecret:
      env.INTEGRATION_CREDENTIAL_MASTER_KEY
      ?? env.BETTER_AUTH_SECRET
      ?? "dev-integration-secret-123456789012345678",
    keyVersion: Number.parseInt(env.INTEGRATION_CREDENTIAL_KEY_VERSION ?? "1", 10) || 1,
    legacyMasterSecretsByVersion: parseLegacyIntegrationSecrets(
      env.INTEGRATION_CREDENTIAL_LEGACY_KEYS,
    ),
  };
}

function resolveMasterSecretForVersion(input: {
  currentMasterSecret: string;
  currentKeyVersion: number;
  legacyMasterSecretsByVersion?: Record<number, string> | undefined;
  requestedKeyVersion: number;
}) {
  if (input.requestedKeyVersion === input.currentKeyVersion) {
    return input.currentMasterSecret;
  }

  const legacySecret = input.legacyMasterSecretsByVersion?.[input.requestedKeyVersion];
  if (legacySecret === undefined || legacySecret.length === 0) {
    throw new Error(`Integration secret key version ${input.requestedKeyVersion} is unavailable.`);
  }

  return legacySecret;
}

function parseLegacyIntegrationSecrets(value: string | undefined) {
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

function deriveKey(masterSecret: string) {
  return createHash("sha256")
    .update(masterSecret)
    .update(":zara:integrations:vault")
    .digest();
}
