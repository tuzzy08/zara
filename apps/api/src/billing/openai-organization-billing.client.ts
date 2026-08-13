export interface OpenAiOrganizationUsageFact {
  bucketStartsAt: string;
  bucketEndsAt: string;
  projectId: string;
  model: string | null;
  serviceTier: string | null;
  inputTokens: number;
  outputTokens: number;
  inputCachedTokens: number;
  inputAudioTokens: number;
  outputAudioTokens: number;
  requestCount: number;
}

export interface OpenAiOrganizationCostFact {
  bucketStartsAt: string;
  bucketEndsAt: string;
  projectId: string;
  lineItem: string | null;
  amount: number;
  currency: string;
}

export interface OpenAiProjectCycleEvidence {
  usage: OpenAiOrganizationUsageFact[];
  costs: OpenAiOrganizationCostFact[];
}

export interface OpenAiProjectBillingClient {
  getProjectCycleEvidence(input: {
    projectId: string;
    cycleStartsAt: string;
    cycleEndsAt: string;
  }): Promise<OpenAiProjectCycleEvidence>;
}

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export class OpenAiOrganizationBillingClient implements OpenAiProjectBillingClient {
  private readonly adminKey: string;
  private readonly fetchImplementation: FetchFn;

  constructor(input: { adminKey: string; fetchImplementation?: FetchFn }) {
    this.adminKey = input.adminKey.trim();
    if (this.adminKey === "") throw new Error("OpenAI billing evidence admin key is required.");
    this.fetchImplementation = input.fetchImplementation ?? fetch;
  }

  async getProjectCycleEvidence(input: {
    projectId: string;
    cycleStartsAt: string;
    cycleEndsAt: string;
  }): Promise<OpenAiProjectCycleEvidence> {
    const projectId = input.projectId.trim();
    if (projectId === "") throw new Error("OpenAI billing evidence project ID is required.");
    const startTime = unixSeconds(input.cycleStartsAt);
    const endTime = unixSeconds(input.cycleEndsAt);
    if (startTime >= endTime) throw new Error("OpenAI billing evidence cycle is invalid.");

    const usage = await this.readPages(
      "/v1/organization/usage/completions",
      {
        start_time: String(startTime),
        end_time: String(endTime),
        bucket_width: "1d",
        limit: "31",
        project_ids: projectId,
        group_by: ["project_id", "model", "service_tier"],
      },
      { startTime, endTime },
      (bucket, result) => mapUsage(bucket, result, projectId),
    );
    const costs = await this.readPages(
      "/v1/organization/costs",
      {
        start_time: String(startTime),
        end_time: String(endTime),
        bucket_width: "1d",
        limit: "180",
        project_ids: projectId,
        group_by: ["project_id", "line_item"],
      },
      { startTime, endTime },
      (bucket, result) => mapCost(bucket, result, projectId),
    );
    return { usage, costs };
  }

  private async readPages<T>(
    path: string,
    parameters: Record<string, string | string[]>,
    cycle: { startTime: number; endTime: number },
    mapResult: (bucket: Record<string, unknown>, result: unknown) => T,
  ): Promise<T[]> {
    const values: T[] = [];
    let page: string | null = null;
    do {
      const url = new URL(path, "https://api.openai.com");
      for (const [key, raw] of Object.entries(parameters)) {
        for (const value of Array.isArray(raw) ? raw : [raw]) url.searchParams.append(key, value);
      }
      if (page !== null) url.searchParams.set("page", page);
      const response = await this.fetchImplementation(url.toString(), {
        method: "GET",
        headers: { Accept: "application/json", Authorization: `Bearer ${this.adminKey}` },
      });
      if (!response.ok) {
        throw new Error(`OpenAI billing evidence request failed with status ${response.status}.`);
      }
      const payload = record(await response.json(), "response");
      if (payload.object !== "page" || !Array.isArray(payload.data)
        || typeof payload.has_more !== "boolean") {
        throw new Error("OpenAI billing evidence response is invalid.");
      }
      for (const rawBucket of payload.data) {
        const bucket = record(rawBucket, "bucket");
        if (!Array.isArray(bucket.results)) {
          throw new Error("OpenAI billing evidence response is invalid.");
        }
        const bucketStart = integerTime(bucket.start_time);
        const bucketEnd = integerTime(bucket.end_time);
        if (bucketStart < cycle.startTime || bucketEnd > cycle.endTime || bucketStart >= bucketEnd) {
          throw new Error("OpenAI billing evidence bucket is outside the requested cycle.");
        }
        values.push(...bucket.results.map((result) => mapResult(bucket, result)));
      }
      if (payload.has_more) {
        if (typeof payload.next_page !== "string" || payload.next_page.trim() === "") {
          throw new Error("OpenAI billing evidence pagination is invalid.");
        }
        page = payload.next_page;
      } else {
        page = null;
      }
    } while (page !== null);
    return values;
  }
}

function mapUsage(
  bucket: Record<string, unknown>,
  raw: unknown,
  projectId: string,
): OpenAiOrganizationUsageFact {
  const value = record(raw, "usage result");
  assertProject(value.project_id, projectId);
  return {
    bucketStartsAt: providerTime(bucket.start_time),
    bucketEndsAt: providerTime(bucket.end_time),
    projectId,
    model: nullableText(value.model),
    serviceTier: nullableText(value.service_tier),
    inputTokens: nonnegativeInteger(value.input_tokens),
    outputTokens: nonnegativeInteger(value.output_tokens),
    inputCachedTokens: optionalNonnegativeInteger(value.input_cached_tokens),
    inputAudioTokens: optionalNonnegativeInteger(value.input_audio_tokens),
    outputAudioTokens: optionalNonnegativeInteger(value.output_audio_tokens),
    requestCount: nonnegativeInteger(value.num_model_requests),
  };
}

function optionalNonnegativeInteger(value: unknown) {
  return value === undefined ? 0 : nonnegativeInteger(value);
}

function mapCost(
  bucket: Record<string, unknown>,
  raw: unknown,
  projectId: string,
): OpenAiOrganizationCostFact {
  const value = record(raw, "cost result");
  assertProject(value.project_id, projectId);
  const amount = record(value.amount, "cost amount");
  if (typeof amount.value !== "number" || !Number.isFinite(amount.value) || amount.value < 0
    || typeof amount.currency !== "string" || amount.currency.trim() === "") {
    throw new Error("OpenAI billing evidence cost is invalid.");
  }
  return {
    bucketStartsAt: providerTime(bucket.start_time),
    bucketEndsAt: providerTime(bucket.end_time),
    projectId,
    lineItem: nullableText(value.line_item),
    amount: amount.value,
    currency: amount.currency.toLowerCase(),
  };
}

function assertProject(value: unknown, projectId: string) {
  if (value !== projectId) throw new Error("OpenAI billing evidence project scope is invalid.");
}

function unixSeconds(value: string) {
  const time = Date.parse(value);
  if (!Number.isFinite(time) || time % 1000 !== 0) {
    throw new Error("OpenAI billing evidence cycle time is invalid.");
  }
  return time / 1000;
}

function providerTime(value: unknown) {
  return new Date(integerTime(value) * 1000).toISOString();
}

function integerTime(value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error("OpenAI billing evidence bucket time is invalid.");
  }
  return Number(value);
}

function nonnegativeInteger(value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error("OpenAI billing evidence usage value is invalid.");
  }
  return Number(value);
}

function nullableText(value: unknown) {
  if (value === null) return null;
  if (typeof value !== "string") throw new Error("OpenAI billing evidence response is invalid.");
  return value;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`OpenAI billing evidence ${label} is invalid.`);
  }
  return value as Record<string, unknown>;
}
