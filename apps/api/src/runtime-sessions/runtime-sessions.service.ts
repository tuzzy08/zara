import {
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  createPremiumRealtimeSession,
  type CompiledRuntimeManifest,
  type PremiumRealtimeSession,
} from "@zara/core";
import { resolveLiveSandboxProviderConfig } from "../sandbox-live-sessions/sandbox-live-env";

export interface CreateRealtimeSessionRequest {
  manifest: CompiledRuntimeManifest;
  activeRoleId: string;
  budgetAllowed: boolean;
  now?: string | undefined;
  ttlMinutes?: number | undefined;
  realtimeAvailable?: boolean | undefined;
}

@Injectable()
export class RuntimeSessionsService {
  createRealtimeSession(input: CreateRealtimeSessionRequest): PremiumRealtimeSession {
    if (input.realtimeAvailable === false) {
      throw new ServiceUnavailableException("Premium realtime is unavailable right now.");
    }

    try {
      return createPremiumRealtimeSession({
        manifest: input.manifest,
        activeRoleId: input.activeRoleId,
        budgetAllowed: input.budgetAllowed,
        defaultGeminiLiveModel: resolveLiveSandboxProviderConfig(process.env).geminiLiveModel,
        ...(input.now !== undefined ? { now: () => input.now! } : {}),
        ...(input.ttlMinutes !== undefined ? { ttlMinutes: input.ttlMinutes } : {}),
      });
    } catch (error) {
      if (
        error instanceof Error &&
        (
          error.message.startsWith("Premium realtime is not enabled") ||
          error.message === "Premium realtime is blocked by the current budget policy."
        )
      ) {
        throw new ConflictException(error.message);
      }

      throw error;
    }
  }
}
