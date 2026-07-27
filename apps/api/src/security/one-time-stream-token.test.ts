import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

import {
  createOneTimeStreamToken,
  hashOneTimeStreamToken,
  readSignedOneTimeStreamToken,
  readVerifiedOneTimeStreamToken,
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

  it("returns scope only after signature, subject, and expiry verification", () => {
    const secret = createHash("sha256").update("test-stream-secret").digest();
    const minted = createOneTimeStreamToken({
      secret,
      subject: "session-claims",
      scope: {
        organizationId: "tenant-claims",
        dispatchId: "dispatch-claims",
        connectionId: "connection-claims",
      },
      expiresAt: "2099-01-01T00:00:00.000Z",
      nonce: "nonce-claims",
    });

    expect(readVerifiedOneTimeStreamToken({
      secret,
      token: minted.token,
      expectedSubject: "session-claims",
      now: "2098-12-31T23:59:59.000Z",
    })).toEqual({
      subject: "session-claims",
      scope: {
        connectionId: "connection-claims",
        dispatchId: "dispatch-claims",
        organizationId: "tenant-claims",
      },
      expiresAt: "2099-01-01T00:00:00.000Z",
      nonce: "nonce-claims",
    });
    expect(readVerifiedOneTimeStreamToken({
      secret,
      token: `${minted.token.slice(0, -1)}x`,
      expectedSubject: "session-claims",
      now: "2098-12-31T23:59:59.000Z",
    })).toBeUndefined();
    expect(readVerifiedOneTimeStreamToken({
      secret,
      token: minted.token,
      expectedSubject: "another-session",
      now: "2098-12-31T23:59:59.000Z",
    })).toBeUndefined();
    expect(readVerifiedOneTimeStreamToken({
      secret,
      token: minted.token,
      expectedSubject: "session-claims",
      now: "2099-01-01T00:00:00.000Z",
    })).toBeUndefined();
    expect(readSignedOneTimeStreamToken({
      secret,
      token: minted.token,
      expectedSubject: "session-claims",
    })).toEqual(expect.objectContaining({
      subject: "session-claims",
      expiresAt: "2099-01-01T00:00:00.000Z",
    }));
  });
});
