import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

import {
  createOneTimeStreamToken,
  hashOneTimeStreamToken,
  resolveOneTimeStreamTokenSecret,
  verifyOneTimeStreamToken,
} from "./one-time-stream-token";

describe("one-time stream tokens", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("verifies scoped signed tokens and rejects expired or mismatched tokens", () => {
    const secret = createHash("sha256").update("test-stream-secret").digest();
    const minted = createOneTimeStreamToken({
      secret,
      subject: "session-1",
      scope: {
        organizationId: "tenant-1",
        workspaceId: "workspace-1",
      },
      expiresAt: "2099-01-01T00:00:00.000Z",
    });

    expect(hashOneTimeStreamToken(minted.token)).toBe(minted.tokenHash);
    expect(verifyOneTimeStreamToken({
      secret,
      token: minted.token,
      expectedSubject: "session-1",
      expectedScope: {
        organizationId: "tenant-1",
        workspaceId: "workspace-1",
      },
      now: "2098-12-31T23:59:59.000Z",
    })).toBe(true);

    expect(verifyOneTimeStreamToken({
      secret,
      token: minted.token,
      expectedSubject: "session-1",
      expectedScope: {
        organizationId: "tenant-2",
        workspaceId: "workspace-1",
      },
      now: "2098-12-31T23:59:59.000Z",
    })).toBe(false);
    expect(verifyOneTimeStreamToken({
      secret,
      token: minted.token,
      expectedSubject: "session-1",
      expectedScope: {
        organizationId: "tenant-1",
        workspaceId: "workspace-1",
      },
      now: "2099-01-01T00:00:00.000Z",
    })).toBe(false);
  });

  it("requires a shared signing secret in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ZARA_STREAM_TOKEN_SECRET", "");
    vi.stubEnv("BETTER_AUTH_SECRET", "");

    expect(() => resolveOneTimeStreamTokenSecret()).toThrow(
      "ZARA_STREAM_TOKEN_SECRET or BETTER_AUTH_SECRET is required in production.",
    );
  });
});
