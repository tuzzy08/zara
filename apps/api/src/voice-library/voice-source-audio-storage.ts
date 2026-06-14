import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { VoiceSourceAudioStorage } from "./voice-library.service";

const maxSourceAudioBytes = 25 * 1024 * 1024;

export class FileVoiceSourceAudioStorage implements VoiceSourceAudioStorage {
  constructor(private readonly directoryPath: string) {}

  async save(input: {
    organizationId: string;
    fileName: string;
    contentType: string;
    contentBase64: string;
  }) {
    const audioBuffer = Buffer.from(input.contentBase64, "base64");
    if (audioBuffer.length === 0) {
      throw new Error("Voice source audio upload is empty.");
    }

    if (audioBuffer.length > maxSourceAudioBytes) {
      throw new Error("Voice source audio upload exceeds the 25 MB limit.");
    }

    const uploadId = `voice_source_${randomUUID()}`;
    const organizationToken = encodeURIComponent(input.organizationId);
    const safeFileName = sanitizeFileName(input.fileName);
    const targetDirectory = join(this.directoryPath, organizationToken);
    const targetPath = join(targetDirectory, `${uploadId}-${safeFileName}`);

    mkdirSync(targetDirectory, { recursive: true });
    writeFileSync(targetPath, audioBuffer);
    writeFileSync(`${targetPath}.json`, `${JSON.stringify({
      sourceAudioRef: `voice-upload://${organizationToken}/${uploadId}`,
      fileName: input.fileName,
      contentType: input.contentType,
      audioPath: targetPath,
    }, null, 2)}\n`);

    return {
      sourceAudioRef: `voice-upload://${organizationToken}/${uploadId}`,
      fileName: input.fileName,
      contentType: input.contentType,
    };
  }

  async load(input: {
    organizationId: string;
    sourceAudioRef: string;
  }) {
    const organizationToken = encodeURIComponent(input.organizationId);
    const uploadId = parseVoiceUploadRef(input.sourceAudioRef, organizationToken);
    const targetDirectory = join(this.directoryPath, organizationToken);
    const metadataPath = existsSync(targetDirectory)
      ? readdirSync(targetDirectory).find((fileName) => fileName.startsWith(`${uploadId}-`) && fileName.endsWith(".json"))
      : undefined;

    if (metadataPath === undefined) {
      throw new Error("Voice source audio upload was not found.");
    }

    const metadata = JSON.parse(readFileSync(join(targetDirectory, metadataPath), "utf8")) as {
      fileName?: string | undefined;
      contentType?: string | undefined;
      audioPath?: string | undefined;
    };
    if (metadata.audioPath === undefined || !existsSync(metadata.audioPath)) {
      throw new Error("Voice source audio upload was not found.");
    }

    return {
      sourceAudioRef: input.sourceAudioRef,
      fileName: metadata.fileName ?? "source-audio.wav",
      contentType: metadata.contentType ?? "audio/wav",
      content: readFileSync(metadata.audioPath),
    };
  }
}

function sanitizeFileName(fileName: string) {
  const fallback = "source-audio.wav";
  const cleaned = fileName.trim().replace(/[^a-zA-Z0-9._-]/g, "-");

  return cleaned.length > 0 ? cleaned : fallback;
}

function parseVoiceUploadRef(sourceAudioRef: string, organizationToken: string) {
  const expectedPrefix = `voice-upload://${organizationToken}/`;
  if (!sourceAudioRef.startsWith(expectedPrefix)) {
    throw new Error("Voice source audio upload reference is invalid.");
  }

  const uploadId = sourceAudioRef.slice(expectedPrefix.length);
  if (!/^voice_source_[a-f0-9-]+$/i.test(uploadId)) {
    throw new Error("Voice source audio upload reference is invalid.");
  }

  return uploadId;
}
