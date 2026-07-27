import {
  isPstnRealtimeWorkerId,
  isPstnRealtimeWorkerReleaseId,
} from "./pstn-realtime-worker-routing-contract";

export const PSTN_MEDIA_PROCESS_ROLE = Symbol("PSTN_MEDIA_PROCESS_ROLE");
export const PSTN_MEDIA_WORKER_ID = Symbol("PSTN_MEDIA_WORKER_ID");
export const PSTN_MEDIA_WORKER_RELEASE_ID = Symbol(
  "PSTN_MEDIA_WORKER_RELEASE_ID",
);
export const PSTN_MEDIA_WORKER_READINESS = Symbol(
  "PSTN_MEDIA_WORKER_READINESS",
);

export type PstnMediaProcessRole = "api" | "pstn-realtime-worker";

export interface PstnMediaWorkerReadiness {
  isAcceptingCalls(): boolean;
}

export function isPstnRuntimeServedByProcess(
  role: PstnMediaProcessRole,
  runtimePath: "pstn-sandwich" | "pstn-premium-realtime",
) {
  return role === "api"
    ? runtimePath === "pstn-sandwich"
    : runtimePath === "pstn-premium-realtime";
}

export function resolvePstnMediaProcessRole(
  env: Record<string, string | undefined> = process.env,
): PstnMediaProcessRole {
  const configured = env.ZARA_PROCESS_ROLE?.trim();
  if (configured === undefined || configured.length === 0 || configured === "api") {
    return "api";
  }
  if (configured === "pstn-realtime-worker") {
    return configured;
  }
  throw new Error(
    "Invalid ZARA_PROCESS_ROLE. Expected 'api' or 'pstn-realtime-worker'.",
  );
}

export function resolvePstnMediaWorkerId(
  role: PstnMediaProcessRole,
  env: Record<string, string | undefined> = process.env,
) {
  if (role === "api") {
    return undefined;
  }
  const workerId = env.PSTN_WORKER_ID?.trim();
  if (!isPstnRealtimeWorkerId(workerId)) {
    throw new Error(
      "PSTN_WORKER_ID must be an explicit bounded worker identifier.",
    );
  }
  return workerId;
}

export function resolvePstnMediaWorkerReleaseId(
  role: PstnMediaProcessRole,
  env: Record<string, string | undefined> = process.env,
) {
  if (role === "api") {
    return undefined;
  }
  const releaseId = env.PSTN_WORKER_RELEASE_ID?.trim();
  if (!isPstnRealtimeWorkerReleaseId(releaseId)) {
    throw new Error(
      "PSTN_WORKER_RELEASE_ID must be an explicit bounded release identifier.",
    );
  }
  return releaseId;
}
