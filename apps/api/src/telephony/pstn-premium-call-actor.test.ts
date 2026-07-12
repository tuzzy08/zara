import { afterEach, describe, expect, it, vi } from "vitest";

import { PstnPremiumCallActor } from "./pstn-premium-call-actor";

describe("PstnPremiumCallActor", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns from start before readiness and flushes bounded startup media in order after readiness", async () => {
    const ready = deferred<void>();
    const sent: number[] = [];
    const actor = new PstnPremiumCallActor({
      callSessionId: "call-1",
      provider: {
        waitUntilReady: () => ready.promise,
        getBufferedAmountBytes: () => 0,
        send(message) {
          sent.push(message.sequence as number);
          return 0;
        },
        close() {},
      },
      terminateRuntime() {},
      closeCaller() {},
    });

    await actor.start();
    actor.appendInbound({ message: { sequence: 1 }, durationMs: 20, byteLength: 160 });
    actor.appendInbound({ message: { sequence: 2 }, durationMs: 20, byteLength: 160 });

    expect(actor.getState()).toBe("initializing");
    expect(sent).toEqual([]);

    ready.resolve();
    await waitFor(() => actor.getState() === "active");

    expect(sent).toEqual([1, 2]);
  });

  it("preserves startup order when new media arrives reentrantly during flush", async () => {
    const ready = deferred<void>();
    const sent: number[] = [];
    const sendStates: string[] = [];
    const actor = new PstnPremiumCallActor({
      callSessionId: "call-reentrant-flush",
      provider: {
        waitUntilReady: () => ready.promise,
        getBufferedAmountBytes: () => 0,
        send(message) {
          sendStates.push(actor.getState());
          const sequence = message.sequence as number;
          sent.push(sequence);
          if (sequence === 1) {
            actor.appendInbound({ message: { sequence: 3 }, durationMs: 20, byteLength: 160 });
          }
          return 0;
        },
        close() {},
      },
      terminateRuntime() {},
      closeCaller() {},
    });
    await actor.start();
    actor.appendInbound({ message: { sequence: 1 }, durationMs: 20, byteLength: 160 });
    actor.appendInbound({ message: { sequence: 2 }, durationMs: 20, byteLength: 160 });

    ready.resolve();
    await waitFor(() => actor.getState() === "active");
    await waitFor(() => sent.length === 3);

    expect(sent).toEqual([1, 2, 3]);
    expect(sendStates).toEqual(["ready", "ready", "ready"]);
  });

  it("fails a readiness timeout once and cleans both call legs and runtime", async () => {
    vi.useFakeTimers();
    const runtimeTerminations: string[] = [];
    const callerCloses: Array<{ code: number; reason: string }> = [];
    const providerCloses: Array<{ code?: number; reason?: string }> = [];
    const terminalStates: string[] = [];
    const actor = new PstnPremiumCallActor({
      callSessionId: "call-timeout",
      provider: {
        waitUntilReady: () => new Promise<void>(() => {}),
        getBufferedAmountBytes: () => 0,
        send() { return 0; },
        close(code, reason) {
          providerCloses.push({
            ...(code === undefined ? {} : { code }),
            ...(reason === undefined ? {} : { reason }),
          });
        },
      },
      terminateRuntime() { runtimeTerminations.push("runtime"); },
      closeCaller(code, reason) { callerCloses.push({ code, reason }); },
      onTerminal(state) { terminalStates.push(state); },
      readinessTimeoutMs: 50,
    });

    await actor.start();
    await vi.advanceTimersByTimeAsync(50);

    expect(actor.getState()).toBe("failed");
    actor.fail("premium_provider_readiness_timeout");

    expect(runtimeTerminations).toEqual(["runtime"]);
    expect(callerCloses).toEqual([{ code: 1011, reason: "premium_provider_readiness_timeout" }]);
    expect(providerCloses).toEqual([{ code: 1011, reason: "premium_provider_readiness_timeout" }]);
    expect(terminalStates).toEqual(["failed"]);
  });

  it("fails instead of dropping media when the startup duration or byte bound overflows", async () => {
    const createActor = (callSessionId: string) => {
      const callerCloses: string[] = [];
      const actor = new PstnPremiumCallActor({
        callSessionId,
        provider: {
          waitUntilReady: () => new Promise<void>(() => {}),
          getBufferedAmountBytes: () => 0,
          send() { return 0; },
          close() {},
        },
        terminateRuntime() {},
        closeCaller(_code, reason) { callerCloses.push(reason); },
      });
      return { actor, callerCloses };
    };
    const duration = createActor("call-duration-overflow");
    await duration.actor.start();
    for (let sequence = 1; sequence <= 50; sequence += 1) {
      duration.actor.appendInbound({ message: { sequence }, durationMs: 20, byteLength: 160 });
    }

    expect(() => duration.actor.appendInbound({
      message: { sequence: 51 },
      durationMs: 20,
      byteLength: 160,
    })).toThrow("premium_startup_overflow");
    expect(duration.callerCloses).toEqual(["premium_startup_overflow"]);

    const bytes = createActor("call-byte-overflow");
    await bytes.actor.start();
    expect(() => bytes.actor.appendInbound({
      message: { sequence: 1 },
      durationMs: 20,
      byteLength: 16_385,
    })).toThrow("premium_startup_overflow");
    expect(bytes.actor.getState()).toBe("failed");
  });

  it("fails explicitly when provider pressure is above the limit before or after an active send", async () => {
    const createActor = (postSendBufferedAmount?: number) => {
      let bufferedAmount = 0;
      let sends = 0;
      const callerCloses: string[] = [];
      const actor = new PstnPremiumCallActor({
        callSessionId: "call-congested",
        provider: {
          waitUntilReady: () => Promise.resolve(),
          getBufferedAmountBytes: () => bufferedAmount,
          send() {
            sends += 1;
            return postSendBufferedAmount ?? bufferedAmount;
          },
          close() {},
        },
        terminateRuntime() {},
        closeCaller(_code, reason) { callerCloses.push(reason); },
        providerBufferedByteLimit: 100,
      });
      return {
        actor,
        callerCloses,
        getSends: () => sends,
        setBufferedAmount: (value: number) => { bufferedAmount = value; },
      };
    };
    const preSend = createActor();
    await preSend.actor.start();
    await waitFor(() => preSend.actor.getState() === "active");
    preSend.setBufferedAmount(101);
    expect(() => preSend.actor.appendInbound({
      message: { sequence: 1 }, durationMs: 20, byteLength: 160,
    })).toThrow("premium_provider_congested");
    expect(preSend.getSends()).toBe(0);

    const postSend = createActor(101);
    await postSend.actor.start();
    await waitFor(() => postSend.actor.getState() === "active");
    expect(() => postSend.actor.appendInbound({
      message: { sequence: 1 }, durationMs: 20, byteLength: 160,
    })).toThrow("premium_provider_congested");
    expect(postSend.getSends()).toBe(1);
    expect(postSend.callerCloses).toEqual(["premium_provider_congested"]);
  });

  it("drains and stops both legs once across repeated termination signals", async () => {
    const runtimeTermination = deferred<void>();
    let runtimeTerminations = 0;
    const callerCloses: string[] = [];
    const providerCloses: string[] = [];
    const actor = new PstnPremiumCallActor({
      callSessionId: "call-stop",
      provider: {
        waitUntilReady: () => Promise.resolve(),
        getBufferedAmountBytes: () => 0,
        send() { return 0; },
        close(_code, reason) { providerCloses.push(reason ?? ""); },
      },
      terminateRuntime() {
        runtimeTerminations += 1;
        return runtimeTermination.promise;
      },
      closeCaller(_code, reason) { callerCloses.push(reason); },
    });
    await actor.start();
    await waitFor(() => actor.getState() === "active");

    const firstStop = actor.stop("twilio_stop");
    const repeatedStop = actor.stop("twilio_stop");
    actor.fail("premium_provider_closed");
    expect(actor.getState()).toBe("draining");

    runtimeTermination.resolve();
    await Promise.all([firstStop, repeatedStop]);

    expect(actor.getState()).toBe("stopped");
    expect(runtimeTerminations).toBe(1);
    expect(callerCloses).toEqual(["twilio_stop"]);
    expect(providerCloses).toEqual(["twilio_stop"]);
  });

  it("bounds draining when in-flight provider work never settles", async () => {
    vi.useFakeTimers();
    const closes: string[] = [];
    const actor = new PstnPremiumCallActor({
      callSessionId: "call-drain-timeout",
      provider: {
        waitUntilReady: () => Promise.resolve(),
        getBufferedAmountBytes: () => 0,
        send() { return 0; },
        close(_code, reason) { closes.push(`provider:${reason}`); },
      },
      drain: () => new Promise<void>(() => {}),
      terminateRuntime() { closes.push("runtime"); },
      closeCaller(_code, reason) { closes.push(`caller:${reason}`); },
      drainTimeoutMs: 50,
    });
    await actor.start();
    await vi.advanceTimersByTimeAsync(0);

    const stopping = actor.stop("app_shutdown");
    await vi.advanceTimersByTimeAsync(49);
    expect(actor.getState()).toBe("draining");
    await vi.advanceTimersByTimeAsync(1);
    await stopping;

    expect(actor.getState()).toBe("stopped");
    expect(closes).toEqual(["runtime", "caller:app_shutdown", "provider:app_shutdown"]);
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function waitFor(predicate: () => boolean) {
  return new Promise<void>((resolve, reject) => {
    const startedAt = Date.now();
    const poll = () => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() - startedAt > 2_000) {
        reject(new Error("Condition was not met before timeout."));
        return;
      }
      setTimeout(poll, 5);
    };
    poll();
  });
}
