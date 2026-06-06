export interface LiveSandboxToolFailureClassification {
  code: string;
  summary: string;
  message: string;
}

export function classifyLiveSandboxToolExecutionFailure(
  error: unknown,
  toolLabel: string,
): LiveSandboxToolFailureClassification {
  const rawMessage = error instanceof Error ? error.message : "Live sandbox tool execution failed.";
  const message = redactFailureMessage(rawMessage);
  const normalized = rawMessage.toLowerCase();
  const statusCode = readFailureStatusCode(error);
  const providerCode = readFailureCode(error);

  if (isPostSendSideEffectTimeout(error, normalized)) {
    return {
      code: "tool_execution.side_effect_unknown",
      summary: `Tool '${toolLabel}' has an unknown provider write outcome.`,
      message: "The provider write may have completed before the request timed out.",
    };
  }

  if (
    providerCode === "integration_connection_revoked"
    || providerCode === "auth_revoked"
    || statusCode === 401
    || normalized.includes("revoked")
    || normalized.includes("expired token")
    || normalized.includes("unauthorized")
  ) {
    return {
      code: "tool_execution.auth_revoked",
      summary: `Tool '${toolLabel}' cannot run because credentials were revoked.`,
      message,
    };
  }

  if (
    providerCode === "permission_denied"
    || providerCode === "missing_scope"
    || statusCode === 403
    || normalized.includes("permission denied")
    || normalized.includes("missing scope")
  ) {
    return {
      code: "tool_execution.permission_denied",
      summary: `Tool '${toolLabel}' cannot run because permission was denied.`,
      message,
    };
  }

  if (providerCode === "not_found" || statusCode === 404 || normalized.includes("not found")) {
    return {
      code: "tool_execution.not_found",
      summary: `Tool '${toolLabel}' could not find the requested record.`,
      message,
    };
  }

  if (
    providerCode === "rate_limited"
    || statusCode === 429
    || normalized.includes("rate limit")
    || normalized.includes("rate-limited")
    || normalized.includes("http 429")
  ) {
    return {
      code: "tool_execution.rate_limited",
      summary: `Tool '${toolLabel}' was rate limited.`,
      message,
    };
  }

  if (
    providerCode === "provider_unavailable"
    || statusCode === 502
    || statusCode === 503
    || normalized.includes("provider unavailable")
    || normalized.includes("service unavailable")
  ) {
    return {
      code: "tool_execution.provider_unavailable",
      summary: `Tool '${toolLabel}' provider is unavailable.`,
      message,
    };
  }

  if (
    providerCode === "timeout"
    || statusCode === 504
    || normalized.includes("timed out")
    || normalized.includes("timeout")
  ) {
    return {
      code: "tool_execution.timeout",
      summary: `Tool '${toolLabel}' timed out.`,
      message,
    };
  }

  if (
    providerCode === "validation_error"
    || statusCode === 400
    || statusCode === 422
    || normalized.includes("validation")
    || normalized.includes("invalid input")
  ) {
    return {
      code: "tool_execution.validation_error",
      summary: `Tool '${toolLabel}' received invalid input or provider payload.`,
      message,
    };
  }

  return {
    code: "tool_execution.failed",
    summary: `Tool '${toolLabel}' failed.`,
    message,
  };
}

export function isLiveSandboxSideEffectTool(toolId: string) {
  return /(\.|_|\b)(create|update|delete|sync|post|note|task|event)(\.|_|\b)/i.test(toolId);
}

function isPostSendSideEffectTimeout(error: unknown, normalizedMessage: string) {
  if (!normalizedMessage.includes("timeout") && !normalizedMessage.includes("timed out")) {
    return false;
  }

  if (typeof error !== "object" || error === null) {
    return false;
  }

  const candidate = error as { sideEffectRequestSent?: unknown; providerRequestSent?: unknown };
  return candidate.sideEffectRequestSent === true || candidate.providerRequestSent === true;
}

function readFailureStatusCode(error: unknown) {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  const candidate = error as { statusCode?: unknown; status?: unknown };
  const value = candidate.statusCode ?? candidate.status;
  return typeof value === "number" ? value : undefined;
}

function readFailureCode(error: unknown) {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  const value = (error as { code?: unknown }).code;
  return typeof value === "string" ? value : undefined;
}

function redactFailureMessage(value: string) {
  return value
    .replace(/secret:\/\/[^\s)]+/gi, "[redacted-secret]")
    .replace(/\b(password|token|api key)\s*[:=]\s*[^\s]+/gi, "$1=[redacted-secret]");
}
