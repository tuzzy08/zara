const fallbackApiBaseUrl = "http://127.0.0.1:4010";

export class ApiError extends Error {
  status: number;
  payload: unknown;

  constructor(message: string, status: number, payload?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

export function buildApiUrl(pathname: string) {
  const configuredBaseUrl =
    ((import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_API_BASE_URL)?.trim()
    || fallbackApiBaseUrl;
  const normalizedBaseUrl = configuredBaseUrl.endsWith("/") ? configuredBaseUrl.slice(0, -1) : configuredBaseUrl;
  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;

  return `${normalizedBaseUrl}${normalizedPath}`;
}

export async function requestJson<TResponse>(
  pathname: string,
  init?: RequestInit,
): Promise<TResponse> {
  let response: Response;

  try {
    response = await fetch(buildApiUrl(pathname), {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
  } catch (error) {
    throw new ApiError(
      error instanceof Error ? error.message : "The Zara API is unreachable right now.",
      0,
    );
  }

  const rawBody = await response.text();
  const payload = rawBody.length === 0 ? null : safeParseJson(rawBody);

  if (!response.ok) {
    const message =
      isRecord(payload) && typeof payload.message === "string"
        ? payload.message
        : `Request failed with status ${response.status}.`;

    throw new ApiError(message, response.status, payload);
  }

  return payload as TResponse;
}

function safeParseJson(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}
