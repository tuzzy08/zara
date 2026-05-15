import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export interface EncryptedTelephonySecretEnvelope {
  algorithm: "aes-256-gcm";
  keyVersion: number;
  iv: string;
  authTag: string;
  ciphertext: string;
}

export class TelephonySecretVault {
  constructor(
    private readonly input: {
      masterSecret: string;
      keyVersion: number;
    },
  ) {}

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

  open(envelope: EncryptedTelephonySecretEnvelope | undefined) {
    if (envelope === undefined) {
      return {};
    }

    const decipher = createDecipheriv(
      envelope.algorithm,
      deriveKey(this.input.masterSecret),
      Buffer.from(envelope.iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(envelope.authTag, "base64"));

    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");

    const parsed = JSON.parse(decrypted);

    if (parsed === null || typeof parsed !== "object") {
      throw new Error("Telephony secret envelope did not decrypt to an object.");
    }

    return parsed as Record<string, string | undefined>;
  }
}

function deriveKey(masterSecret: string) {
  return createHash("sha256")
    .update(masterSecret)
    .update(":zara:telephony:vault")
    .digest();
}
