import { describe, expect, it, vi } from "vitest";

import {
  PstnAdmissionBackendUnavailableError,
  PstnAdmissionIndeterminateError,
  PstnAdmissionRedisClient,
  type NodeRedisAdmissionClient,
} from "./pstn-admission-redis-client";

function createClient(
  overrides: Partial<NodeRedisAdmissionClient> = {},
): NodeRedisAdmissionClient {
  return {
    isOpen: true,
    isReady: true,
    connect: vi.fn(async () => undefined),
    destroy: vi.fn(),
    eval: vi.fn(async () => ["ok"]),
    on: vi.fn(() => undefined),
    ...overrides,
  };
}

describe("PstnAdmissionRedisClient", () => {
  it("registers an error listener and delegates one atomic evaluation", async () => {
    const client = createClient();
    const redis = new PstnAdmissionRedisClient(client, 100);

    await expect(
      redis.eval("return 1", ["{slot}:one"], ["value"]),
    ).resolves.toEqual(["ok"]);

    expect(client.on).toHaveBeenCalledWith("error", expect.any(Function));
    expect(client.eval).toHaveBeenCalledWith("return 1", {
      keys: ["{slot}:one"],
      arguments: ["value"],
    });
  });

  it("fails before dispatch while the client is not ready", async () => {
    const client = createClient({ isReady: false });
    const redis = new PstnAdmissionRedisClient(client, 100);

    await expect(redis.eval("return 1", [], [])).rejects.toBeInstanceOf(
      PstnAdmissionBackendUnavailableError,
    );
    expect(client.eval).not.toHaveBeenCalled();
  });

  it("classifies a command timeout as indeterminate", async () => {
    vi.useFakeTimers();
    const client = createClient({
      eval: vi.fn(() => new Promise(() => undefined)),
    });
    const redis = new PstnAdmissionRedisClient(client, 50);
    const pending = redis.eval("return 1", [], []);
    const assertion = expect(pending).rejects.toBeInstanceOf(
      PstnAdmissionIndeterminateError,
    );

    await vi.advanceTimersByTimeAsync(51);

    await assertion;
    vi.useRealTimers();
  });

  it("connects once and destroys the client during shutdown", async () => {
    const client = createClient({ isOpen: false, isReady: false });
    const redis = new PstnAdmissionRedisClient(client, 100);

    await redis.connect();
    await redis.connect();
    redis.destroy();

    expect(client.connect).toHaveBeenCalledTimes(1);
    expect(client.destroy).toHaveBeenCalledTimes(1);
  });
});
