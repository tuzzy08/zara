const workerIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const releaseIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/;

export function isPstnRealtimeWorkerId(value: unknown): value is string {
  return typeof value === "string" && workerIdPattern.test(value);
}

export function isPstnRealtimeWorkerReleaseId(
  value: unknown,
): value is string {
  return typeof value === "string" && releaseIdPattern.test(value);
}

export function normalizePstnRealtimeWorkerMediaStreamBaseUrl(
  value: unknown,
): string | undefined {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) {
    return undefined;
  }
  try {
    const url = new URL(value);
    const secure = url.protocol === "wss:";
    const loopback =
      url.protocol === "ws:"
      && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
    if (
      (!secure && !loopback)
      || url.username.length > 0
      || url.password.length > 0
      || url.search.length > 0
      || url.hash.length > 0
      || url.pathname === "/"
    ) {
      return undefined;
    }
    return value.replace(/\/+$/, "");
  } catch {
    return undefined;
  }
}

export function isPstnRealtimeWorkerMediaStreamBaseUrl(
  value: unknown,
): value is string {
  return normalizePstnRealtimeWorkerMediaStreamBaseUrl(value) !== undefined;
}
