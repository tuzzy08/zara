import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { PremiumRealtimeConversationPolicy } from "./premium-realtime-conversation-policy.models";

export interface PremiumRealtimeConversationPolicyRepository {
  load(): Promise<PremiumRealtimeConversationPolicy | null>;
  save(policy: PremiumRealtimeConversationPolicy): Promise<void>;
}

export class InMemoryPremiumRealtimeConversationPolicyRepository
implements PremiumRealtimeConversationPolicyRepository {
  private policy: PremiumRealtimeConversationPolicy | null = null;

  async load() {
    return this.policy === null ? null : structuredClone(this.policy);
  }

  async save(policy: PremiumRealtimeConversationPolicy) {
    this.policy = structuredClone(policy);
  }
}

export class FilePremiumRealtimeConversationPolicyRepository
implements PremiumRealtimeConversationPolicyRepository {
  private readonly filePath: string;

  constructor(stateDir: string) {
    this.filePath = join(stateDir, "conversation-policy.json");
  }

  async load() {
    try {
      const raw = await readFile(this.filePath, "utf8");
      return JSON.parse(raw) as PremiumRealtimeConversationPolicy;
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  async save(policy: PremiumRealtimeConversationPolicy) {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${Date.now()}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(policy, null, 2)}\n`, "utf8");
    await rename(tempPath, this.filePath);
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
