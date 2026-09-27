import { describe, expect, it } from "vitest";

import { createTypeSafeClient, readTypeSafeMode, TypeSafeClient } from "./typesafe-client";

describe("TypeSafeClient", () => {
  it("sends bounded questions to TypeSafe and returns typed answers and actual usage", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const client = new TypeSafeClient({
      apiKey: "test-key",
      model: "jev-1.13.0",
      fetch: async (url, init) => {
        requests.push({ url: String(url), init: init ?? {} });
        return Response.json({
          model: "jev-1.13.0",
          answers: { route: { type: "choice", choice: "none", confidence: 0.8, probabilities: { billing: 0.1, none: 0.9 } } },
          usage: { input_tokens: 42, output_tokens: 8 },
        });
      },
    });

    const result = await client.evaluate({
      state: { caller: "Hello" },
      questions: { route: { type: "choice", instructions: "Which route fits?", criteria: { billing: "Billing requests", none: "No match" } } },
    });

    expect(requests[0]?.url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(requests[0]?.init.headers).toEqual({ Authorization: "Bearer test-key", "Content-Type": "application/json" });
    expect(JSON.parse(String(requests[0]?.init.body))).toMatchObject({ model: "jev-1.13.0", state: { caller: "Hello" } });
    expect(result).toMatchObject({
      model: "jev-1.13.0",
      answers: { route: { type: "choice", choice: "none", confidence: 0.8, probabilities: { billing: 0.1, none: 0.9 } } },
      usage: { inputTokens: 42, outputTokens: 8 },
    });
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it.each([
    { answers: { route: { type: "choice", choice: "invented", confidence: 1, probabilities: { billing: 0, none: 1 } } } },
    { answers: { route: { type: "choice", choice: "none", confidence: 2, probabilities: { billing: 0, none: 1 } } } },
    { answers: { route: { type: "choice", choice: "none", confidence: 1, probabilities: { billing: 0, none: 0 } } } },
    { answers: { route: { type: "choice", choice: "none", confidence: 1, probabilities: { billing: 0.9, none: 0.1 } } } },
    { answers: { route: { type: "noul", noul: 0.9 } } },
    { answers: {} },
    { usage: { input_tokens: "42", output_tokens: 8 } },
    { model: "" },
  ])("rejects malformed provider answers without leaking their payload", async (override) => {
    const client = new TypeSafeClient({ apiKey: "test-key", model: "jev-1.13.0", fetch: async () => Response.json({
      model: "jev-1.13.0",
      answers: { route: { type: "choice", choice: "none", confidence: 1, probabilities: { billing: 0, none: 1 } } },
      usage: { input_tokens: 42, output_tokens: 8 },
      ...override,
    }) });
    await expect(client.evaluate({ state: "private text", questions: {
      route: { type: "choice", instructions: "Which route?", criteria: { billing: null, none: null } },
    } })).rejects.toMatchObject({ code: "invalid_response", message: "TypeSafe invalid_response." });
  });

  it("returns a Noul probability without inventing confidence", async () => {
    const client = new TypeSafeClient({ apiKey: "test-key", model: "jev-1.13.0", fetch: async () => Response.json({
      model: "jev-1.13.0", answers: { resolved: { type: "noul", noul: 0.2 } }, usage: { input_tokens: 10, output_tokens: 2 },
    }) });
    const result = await client.evaluate({ state: "Still broken", questions: { resolved: { type: "noul", instructions: "Resolved?" } } });
    expect(result.answers["resolved"]).toEqual({ type: "noul", noul: 0.2 });
  });

  it("requires explicit credentials and a fixed model when configured", () => {
    expect(createTypeSafeClient({})).toBeUndefined();
    expect(() => createTypeSafeClient({ TYPESAFE_API_KEY: "key" })).toThrow("TypeSafe invalid_request.");
    expect(() => createTypeSafeClient({ TYPESAFE_API_KEY: "key", TYPESAFE_MODEL: "jev-latest" })).toThrow();
    expect(createTypeSafeClient({ TYPESAFE_API_KEY: "key", TYPESAFE_MODEL: "jev-1.13.0" })).toBeInstanceOf(TypeSafeClient);
    expect(readTypeSafeMode(undefined)).toBe("off");
    expect(readTypeSafeMode("shadow")).toBe("shadow");
    expect(readTypeSafeMode("enabled")).toBe("enabled");
    expect(() => readTypeSafeMode("true")).toThrow();
  });

  it.each([[401, "authentication_failed"], [403, "authentication_failed"], [429, "rate_limited"], [503, "provider_failed"]])(
    "hides HTTP %s error bodies and does not retry", async (status, code) => {
      let calls = 0;
      const client = new TypeSafeClient({ apiKey: "key", model: "jev-1.13.0", fetch: async () => {
        calls++;
        return new Response("private upstream failure", { status: Number(status) });
      } });
      await expect(client.evaluate({ state: "private input", questions: { q: { type: "noul", instructions: "Yes?" } } })).rejects.toMatchObject({ code, message: `TypeSafe ${code}.` });
      expect(calls).toBe(1);
    },
  );

  it("rejects oversized input before sending customer data", async () => {
    let calls = 0;
    const client = new TypeSafeClient({ apiKey: "key", model: "jev-1.13.0", fetch: async () => { calls++; throw new Error("must not send"); } });
    await expect(client.evaluate({ state: "x".repeat(100_001), questions: { q: { type: "noul", instructions: "Yes?" } } })).rejects.toMatchObject({ code: "invalid_request" });
    expect(calls).toBe(0);
  });

  it("aborts an expired request, including response-body reads", async () => {
    let signal: AbortSignal | null | undefined;
    const client = new TypeSafeClient({ apiKey: "key", model: "jev-1.13.0", timeoutMs: 10, fetch: async (_url, init) => {
      signal = init?.signal;
      return new Response(new ReadableStream({ start() { /* Provider never finishes its response. */ } }));
    } });
    await expect(client.evaluate({ state: "hello", questions: { q: { type: "noul", instructions: "Yes?" } } })).rejects.toMatchObject({ code: "timeout" });
    expect(signal?.aborted).toBe(true);
  });

  it("does not send an already aborted request", async () => {
    let calls = 0;
    const controller = new AbortController();
    controller.abort();
    const client = new TypeSafeClient({ apiKey: "key", model: "jev-1.13.0", fetch: async () => { calls++; throw new Error("private error"); } });
    await expect(client.evaluate({ state: "hello", questions: { q: { type: "noul", instructions: "Yes?" } }, abortSignal: controller.signal })).rejects.toMatchObject({ code: "aborted" });
    expect(calls).toBe(0);
  });

  it("bounds the response body before parsing it", async () => {
    const client = new TypeSafeClient({ apiKey: "key", model: "jev-1.13.0", fetch: async () => new Response(JSON.stringify({
      model: "jev-1.13.0", answers: { q: { type: "noul", noul: 0.5 } },
      usage: { input_tokens: 1, output_tokens: 1 }, unexpected: "x".repeat(1_000_001),
    })) });
    await expect(client.evaluate({ state: "hello", questions: { q: { type: "noul", instructions: "Yes?" } } })).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("limits concurrent requests across clients and releases capacity on abort", async () => {
    const controller = new AbortController();
    let calls = 0;
    const client = () => new TypeSafeClient({ apiKey: "key", model: "jev-1.13.0", fetch: async () => {
      calls++;
      return new Promise<Response>(() => undefined);
    } });
    const input = { state: "hello", questions: { q: { type: "noul" as const, instructions: "Yes?" } }, abortSignal: controller.signal };
    const pending = Array.from({ length: 8 }, () => client().evaluate(input).catch((error: unknown) => error));
    try {
      await expect(client().evaluate(input)).rejects.toMatchObject({ code: "capacity_exceeded" });
      expect(calls).toBe(8);
    } finally {
      controller.abort();
      await Promise.all(pending);
    }
  });
});
