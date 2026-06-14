import {
  configureOpenTelemetryRuntimeTracing,
  resolveRuntimeObservabilityConfig,
} from "../runtime-observability/runtime-observability";

let initialized = false;

export function initializeApiObservability(env: Record<string, string | undefined> = process.env) {
  if (initialized) {
    return;
  }

  initialized = true;
  const config = resolveRuntimeObservabilityConfig(env);
  configureOpenTelemetryRuntimeTracing({ config, env });
}
