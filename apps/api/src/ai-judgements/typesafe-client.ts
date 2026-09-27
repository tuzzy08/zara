export type TypeSafeQuestion =
  | { type: "choice"; instructions: string; criteria: Record<string, string | null> }
  | { type: "noul"; instructions: string; criteria?: { true: string; false: string } };

export type TypeSafeAnswer =
  | { type: "choice"; choice: string; confidence: number; probabilities: Record<string, number> }
  | { type: "noul"; noul: number };

export interface TypeSafeResult {
  answers: Record<string, TypeSafeAnswer>;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
  latencyMs: number;
}

export class TypeSafeError extends Error {
  constructor(readonly code: "invalid_response" | "invalid_request" | "timeout" | "aborted" | "rate_limited" | "authentication_failed" | "provider_failed" | "capacity_exceeded") {
    super(`TypeSafe ${code}.`);
    this.name = "TypeSafeError";
  }
}

export type TypeSafeMode = "off" | "shadow" | "enabled";

export function readTypeSafeMode(value: string | undefined): TypeSafeMode {
  if (value === undefined || value === "" || value === "off") return "off";
  if (value === "shadow" || value === "enabled") return value;
  throw new TypeSafeError("invalid_request");
}

export function createTypeSafeClient(env: Record<string, string | undefined> = process.env): TypeSafeClient | undefined {
  const apiKey = env["TYPESAFE_API_KEY"]?.trim();
  const model = env["TYPESAFE_MODEL"]?.trim();
  if (!apiKey && !model) return undefined;
  if (!apiKey || !model) throw new TypeSafeError("invalid_request");
  return new TypeSafeClient({ apiKey, model });
}

// ponytail: eight requests per process; use shared admission only if multi-process quotas require it.
let activeRequests = 0;

export class TypeSafeClient {
  constructor(private readonly config: {
    apiKey: string;
    model: string;
    timeoutMs?: number;
    fetch?: typeof fetch;
  }) {
    if (!config.apiKey.trim() || !/^jev-\d+\.\d+(?:\.\d+)?$/.test(config.model)
      || (config.timeoutMs !== undefined && !validTimeout(config.timeoutMs))) throw new TypeSafeError("invalid_request");
  }

  async evaluate(input: {
    state: unknown;
    questions: Record<string, TypeSafeQuestion>;
    abortSignal?: AbortSignal;
    timeoutMs?: number;
  }): Promise<TypeSafeResult> {
    const startedAt = Date.now();
    const timeoutMs = input.timeoutMs ?? this.config.timeoutMs ?? 5_000;
    if (!validTimeout(timeoutMs)) throw new TypeSafeError("invalid_request");
    if (input.abortSignal?.aborted) throw new TypeSafeError("aborted");
    let body: string;
    try {
      body = JSON.stringify({ model: this.config.model, state: input.state, questions: input.questions });
      if (Buffer.byteLength(body) > 100_000 || !validQuestions(input.questions)) throw new Error();
    } catch {
      throw new TypeSafeError("invalid_request");
    }
    if (activeRequests >= 8) throw new TypeSafeError("capacity_exceeded");
    activeRequests++;
    const controller = new AbortController();
    const abort = () => controller.abort(new TypeSafeError("aborted"));
    input.abortSignal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => controller.abort(new TypeSafeError("timeout")), timeoutMs);
    let rejectAbort: (() => void) | undefined;
    try {
      return await Promise.race([
        (async () => {
          const response = await (this.config.fetch ?? fetch)("https://api.typesafe.ai/v1/systemone", {
            method: "POST",
            headers: { Authorization: `Bearer ${this.config.apiKey}`, "Content-Type": "application/json" },
            body,
            signal: controller.signal,
          });
          if (!response.ok) {
            void response.body?.cancel().catch(() => undefined);
            throw new TypeSafeError(response.status === 401 || response.status === 403 ? "authentication_failed"
              : response.status === 429 ? "rate_limited" : "provider_failed");
          }
          let payload: unknown;
          try { payload = await readResponse(response, controller.signal); } catch { throw new TypeSafeError("invalid_response"); }
          return parseResult(payload, input.questions, Date.now() - startedAt);
        })(),
        new Promise<never>((_resolve, reject) => {
          rejectAbort = () => reject(controller.signal.reason);
          controller.signal.addEventListener("abort", rejectAbort, { once: true });
        }),
      ]);
    } catch (error) {
      if (controller.signal.aborted) throw controller.signal.reason;
      throw error instanceof TypeSafeError ? error : new TypeSafeError("provider_failed");
    } finally {
      activeRequests--;
      clearTimeout(timer);
      input.abortSignal?.removeEventListener("abort", abort);
      if (rejectAbort) controller.signal.removeEventListener("abort", rejectAbort);
    }
  }
}

async function readResponse(response: Response, signal: AbortSignal): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new TypeSafeError("invalid_response");
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 1_000_000) throw new TypeSafeError("invalid_response");
      chunks.push(chunk.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } finally {
    signal.removeEventListener("abort", cancel);
    cancel();
  }
}

function validTimeout(value: number) {
  return Number.isInteger(value) && value > 0 && value <= 30_000;
}

function validQuestions(questions: Record<string, TypeSafeQuestion>) {
  const entries = Object.values(questions);
  return entries.length > 0 && entries.length <= 64 && entries.every((question) =>
    question.instructions.trim().length > 0 && (question.type === "noul"
      || (question.type === "choice" && Object.keys(question.criteria).length > 0 && Object.keys(question.criteria).length <= 255)));
}

function parseResult(payload: unknown, questions: Record<string, TypeSafeQuestion>, latencyMs: number): TypeSafeResult {
  const invalid = () => new TypeSafeError("invalid_response");
  if (!isRecord(payload) || typeof payload.model !== "string" || payload.model.trim() === ""
    || !isRecord(payload.answers) || !isRecord(payload.usage)
    || !isTokenCount(payload.usage.input_tokens) || !isTokenCount(payload.usage.output_tokens)
    || !sameKeys(payload.answers, questions)) throw invalid();

  const answers: Record<string, TypeSafeAnswer> = {};
  for (const [id, question] of Object.entries(questions)) {
    const answer = payload.answers[id];
    if (!isRecord(answer) || answer.type !== question.type) throw invalid();
    if (question.type === "noul") {
      if (!isProbability(answer.noul)) throw invalid();
      answers[id] = { type: "noul", noul: answer.noul };
    } else {
      if (typeof answer.choice !== "string" || !Object.hasOwn(question.criteria, answer.choice)
        || !isProbability(answer.confidence) || !isRecord(answer.probabilities)
        || !sameKeys(answer.probabilities, question.criteria)) throw invalid();
      const values = Object.values(answer.probabilities);
      if (!values.every(isProbability) || Math.abs(values.reduce((sum, value) => sum + value, 0) - 1) > 0.001) throw invalid();
      const probabilities = answer.probabilities as Record<string, number>;
      if ((probabilities[answer.choice] ?? -1) < Math.max(...values)) throw invalid();
      answers[id] = { type: "choice", choice: answer.choice, confidence: answer.confidence, probabilities: { ...probabilities } };
    }
  }
  return { answers, model: payload.model, usage: { inputTokens: payload.usage.input_tokens, outputTokens: payload.usage.output_tokens }, latencyMs };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProbability(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isTokenCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function sameKeys(left: Record<string, unknown>, right: Record<string, unknown>) {
  return Object.keys(left).length === Object.keys(right).length && Object.keys(right).every((key) => Object.hasOwn(left, key));
}
