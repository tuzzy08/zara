import { BadRequestException, ServiceUnavailableException } from "@nestjs/common";

import type { VoiceCloneProvider } from "./voice-library.service";

const defaultCartesiaApiUrl = "https://api.cartesia.ai";

export class UnavailableVoiceCloneProvider implements VoiceCloneProvider {
  async clone(): Promise<{ providerVoiceId: string }> {
    throw new ServiceUnavailableException("Cartesia voice cloning is not configured.");
  }
}

export class CartesiaVoiceCloneProvider implements VoiceCloneProvider {
  constructor(private readonly config: {
    apiKey: string;
    apiVersion: string;
    apiUrl?: string | undefined;
  }) {}

  async clone(input: Parameters<VoiceCloneProvider["clone"]>[0]) {
    const form = new FormData();
    const clipBytes = new Uint8Array(input.content.length);
    clipBytes.set(input.content);
    form.set("clip", new Blob([clipBytes.buffer], { type: input.contentType }), input.fileName);
    form.set("name", input.name);
    form.set("language", input.language);

    const response = await fetch(`${this.config.apiUrl ?? defaultCartesiaApiUrl}/voices/clone`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Cartesia-Version": this.config.apiVersion,
      },
      body: form,
    });
    const payload = await response.json().catch(() => null) as unknown;

    if (!response.ok) {
      throw new BadRequestException(readCartesiaCloneError(payload, response.status));
    }

    const providerVoiceId = readCartesiaVoiceId(payload);
    if (providerVoiceId === null) {
      throw new BadRequestException("Cartesia clone response did not include a voice ID.");
    }

    return { providerVoiceId };
  }
}

function readCartesiaVoiceId(payload: unknown) {
  if (payload !== null && typeof payload === "object" && "id" in payload && typeof payload.id === "string") {
    return payload.id;
  }

  return null;
}

function readCartesiaCloneError(payload: unknown, status: number) {
  if (payload !== null && typeof payload === "object") {
    const message = "message" in payload && typeof payload.message === "string" ? payload.message : null;
    const title = "title" in payload && typeof payload.title === "string" ? payload.title : null;
    return message ?? title ?? `Cartesia voice clone failed with status ${status}.`;
  }

  return `Cartesia voice clone failed with status ${status}.`;
}
