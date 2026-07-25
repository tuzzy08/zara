import { createClient } from "@redis/client";

import type { PstnAdmissionRedisCommands } from "./redis-pstn-call-admission";

export interface NodeRedisAdmissionClient {
  readonly isOpen: boolean;
  readonly isReady: boolean;
  connect(): Promise<unknown>;
  destroy(): void;
  eval(
    script: string,
    options: {
      keys: string[];
      arguments: string[];
    },
  ): Promise<unknown>;
  on(event: "error", listener: (error: Error) => void): unknown;
}

export class PstnAdmissionBackendUnavailableError extends Error {
  constructor() {
    super("PSTN admission backend is unavailable.");
    this.name = "PstnAdmissionBackendUnavailableError";
  }
}

export class PstnAdmissionIndeterminateError extends Error {
  constructor() {
    super("PSTN admission command result is indeterminate.");
    this.name = "PstnAdmissionIndeterminateError";
  }
}

export class PstnAdmissionRedisClient
  implements PstnAdmissionRedisCommands
{
  private connectPromise: Promise<void> | undefined;
  private destroyed = false;

  constructor(
    private readonly client: NodeRedisAdmissionClient,
    private readonly commandTimeoutMs: number,
  ) {
    this.client.on("error", () => {
      // The readiness endpoint exposes only the bounded admission posture.
    });
  }

  async connect(): Promise<void> {
    if (this.client.isOpen) {
      return;
    }
    this.connectPromise ??= this.client
      .connect()
      .then(() => undefined)
      .catch(() => {
        this.connectPromise = undefined;
        throw new PstnAdmissionBackendUnavailableError();
      });
    await this.connectPromise;
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    if (this.client.isOpen) {
      this.client.destroy();
    }
  }

  async eval(
    script: string,
    keys: readonly string[],
    args: readonly string[],
  ): Promise<unknown> {
    if (this.destroyed || !this.client.isReady) {
      throw new PstnAdmissionBackendUnavailableError();
    }

    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.client.eval(script, {
          keys: [...keys],
          arguments: [...args],
        }),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () => reject(new PstnAdmissionIndeterminateError()),
            this.commandTimeoutMs,
          );
          timeout.unref?.();
        }),
      ]);
    } finally {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
    }
  }
}

export function createPstnAdmissionRedisClient(
  url: string,
  commandTimeoutMs: number,
) {
  const client = createClient({
    url,
    disableOfflineQueue: true,
    commandsQueueMaxLength: 100,
    name: "zara-pstn-admission",
    pingInterval: 10_000,
    socket: {
      connectTimeout: commandTimeoutMs,
      reconnectStrategy: (retries) =>
        Math.min(1_000, 50 * 2 ** Math.min(retries, 5)) +
        Math.floor(Math.random() * 100),
    },
  });
  return new PstnAdmissionRedisClient(
    client as unknown as NodeRedisAdmissionClient,
    commandTimeoutMs,
  );
}
