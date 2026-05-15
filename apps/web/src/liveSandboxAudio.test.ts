import { describe, expect, it } from "vitest";

import { decodePcm16Chunk, encodePcm16Chunk } from "./liveSandboxAudio";

describe("live sandbox audio helpers", () => {
  it("round-trips float samples through pcm16 base64 encoding", () => {
    const input = new Float32Array([0, 0.25, -0.5, 0.9, -1]);

    const encoded = encodePcm16Chunk(input);
    const decoded = decodePcm16Chunk(encoded);

    expect(decoded.length).toBe(input.length);
    input.forEach((sample, index) => {
      expect(decoded[index] ?? 0).toBeCloseTo(sample, 3);
    });
  });
});
