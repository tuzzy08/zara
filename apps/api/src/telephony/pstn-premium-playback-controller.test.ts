import { describe, expect, it, vi } from "vitest";

import { PstnPremiumPlaybackAdmission } from "./pstn-premium-playback-admission";
import { PstnPremiumPlaybackController } from "./pstn-premium-playback-controller";

describe("PstnPremiumPlaybackController", () => {
  it("reports whether an interruption actually cleared owned playback", () => {
    const clear = vi.fn();
    const controller = new PstnPremiumPlaybackController({
      sendFrame() {}, sendMark() {}, clear,
    });

    expect(controller.interrupt()).toEqual({ playbackCleared: false, truncations: [] });
    controller.startResponse("response-owned");
    expect(controller.interrupt()).toEqual({ playbackCleared: true, truncations: [] });
    expect(controller.interrupt()).toEqual({ playbackCleared: false, truncations: [] });
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it("truncates exact assistant content at the latest acknowledged 20 ms frame mark", () => {
    const marks: string[] = [];
    const controller = new PstnPremiumPlaybackController({
      sendFrame() {},
      sendMark(name) {
        marks.push(name);
      },
      clear: vi.fn(),
    });

    controller.startResponse("response-1");
    controller.appendDelta(
      "response-1",
      Buffer.alloc(4 * 160, 7).toString("base64"),
      { itemId: "assistant-item-1", contentIndex: 2 },
    );
    controller.acknowledgeMark(marks[2] ?? "missing");

    expect(controller.interrupt()).toEqual({
      playbackCleared: true,
      truncations: [{
        responseId: "response-1",
        itemId: "assistant-item-1",
        contentIndex: 2,
        audioEndMs: 60,
      }],
    });
  });

  it("does not truncate assistant content before Twilio acknowledges any played audio", () => {
    const controller = new PstnPremiumPlaybackController({
      sendFrame() {},
      sendMark() {},
      clear: vi.fn(),
    });

    controller.startResponse("response-unplayed");
    controller.appendDelta(
      "response-unplayed",
      Buffer.alloc(160, 7).toString("base64"),
      { itemId: "assistant-item-unplayed", contentIndex: 0 },
    );

    expect(controller.interrupt()).toEqual({
      playbackCleared: true,
      truncations: [],
    });
  });

  it("normalizes arbitrary delta boundaries into ordered 160-byte frames followed by unique marks", () => {
    const events: Array<{ type: "frame"; bytes: Buffer } | { type: "mark"; name: string }> = [];
    const controller = new PstnPremiumPlaybackController({
      sendFrame(frame) {
        events.push({ type: "frame", bytes: Buffer.from(frame.payloadBase64, "base64") });
      },
      sendMark(name) {
        events.push({ type: "mark", name });
      },
      clear: vi.fn(),
    });
    const audio = Buffer.from(Array.from({ length: 320 }, (_, index) => index % 256));

    controller.startResponse("response-1");
    controller.appendDelta("response-1", audio.subarray(0, 17).toString("base64"));
    controller.appendDelta("response-1", audio.subarray(17, 201).toString("base64"));
    controller.appendDelta("response-1", audio.subarray(201).toString("base64"));

    expect(events.map((event) => event.type)).toEqual(["frame", "mark", "frame", "mark"]);
    const frames = events.filter((event): event is { type: "frame"; bytes: Buffer } => event.type === "frame");
    expect(frames.map((frame) => frame.bytes.length)).toEqual([160, 160]);
    expect(Buffer.concat(frames.map((frame) => frame.bytes))).toEqual(audio);
    const marks = events.filter((event): event is { type: "mark"; name: string } => event.type === "mark");
    expect(new Set(marks.map((mark) => mark.name)).size).toBe(2);
  });

  it("pads a final partial frame with mu-law silence only when the response finishes", () => {
    const frames: Buffer[] = [];
    const controller = new PstnPremiumPlaybackController({
      sendFrame(frame) {
        frames.push(Buffer.from(frame.payloadBase64, "base64"));
      },
      sendMark() {},
      clear: vi.fn(),
    });
    const partial = Buffer.from([1, 2, 3]);

    controller.startResponse("response-partial");
    controller.appendDelta("response-partial", partial.toString("base64"));
    expect(frames).toEqual([]);

    controller.finishResponse("response-partial");

    expect(frames).toHaveLength(1);
    expect(frames[0]?.subarray(0, partial.length)).toEqual(partial);
    expect(frames[0]?.subarray(partial.length)).toEqual(Buffer.alloc(157, 0xff));
  });

  it("holds a 50-mark in-flight window and drains queued frames in order as marks are acknowledged", () => {
    const sentFirstBytes: number[] = [];
    const marks: string[] = [];
    const controller = new PstnPremiumPlaybackController({
      sendFrame(frame) {
        sentFirstBytes.push(Buffer.from(frame.payloadBase64, "base64")[0] ?? -1);
      },
      sendMark(name) {
        marks.push(name);
      },
      clear: vi.fn(),
    });
    const frames = Array.from({ length: 52 }, (_, index) => Buffer.alloc(160, index));

    controller.startResponse("response-window");
    controller.appendDelta("response-window", Buffer.concat(frames).toString("base64"));

    expect(sentFirstBytes).toEqual(Array.from({ length: 50 }, (_, index) => index));
    expect(controller.getState()).toMatchObject({
      inFlightMarkCount: 50,
      queuedFrameCount: 2,
      queuedAudioBytes: 320,
    });

    controller.acknowledgeMark(marks[0] ?? "missing");

    expect(sentFirstBytes).toEqual(Array.from({ length: 51 }, (_, index) => index));
    expect(controller.getState()).toMatchObject({
      inFlightMarkCount: 50,
      queuedFrameCount: 1,
      queuedAudioBytes: 160,
    });
  });

  it("absorbs a normal multi-second provider burst while Twilio playback acknowledgements lag", () => {
    const controller = new PstnPremiumPlaybackController({
      sendFrame() {},
      sendMark() {},
      clear: vi.fn(),
    });

    controller.startResponse("response-production-burst");

    expect(() => {
      for (let second = 0; second < 15; second += 1) {
        controller.appendDelta(
          "response-production-burst",
          Buffer.alloc(50 * 160, second).toString("base64"),
        );
      }
    }).not.toThrow();
    expect(controller.getState()).toMatchObject({
      inFlightMarkCount: 50,
      queuedFrameCount: 700,
      queuedAudioBytes: 112_000,
    });
  });

  it("throws instead of exceeding the 30-second local audio queue", () => {
    const controller = new PstnPremiumPlaybackController({
      sendFrame() {},
      sendMark() {},
      clear: vi.fn(),
    });

    controller.startResponse("response-overflow");
    for (let second = 0; second < 31; second += 1) {
      controller.appendDelta(
        "response-overflow",
        Buffer.alloc(50 * 160, second).toString("base64"),
      );
    }

    expect(controller.getState()).toMatchObject({
      inFlightMarkCount: 50,
      queuedFrameCount: 1_500,
      queuedAudioBytes: 240_000,
    });
    expect(() => controller.appendDelta(
      "response-overflow",
      Buffer.alloc(160, 2).toString("base64"),
    )).toThrow("premium_playback_overflow");
    expect(controller.getState().queuedAudioBytes).toBe(240_000);
  });

  it("releases aggregate queued playback admission as frames drain and on interruption", () => {
    const marks: string[] = [];
    const admission = new PstnPremiumPlaybackAdmission(320);
    const controller = new PstnPremiumPlaybackController({
      sendFrame() {},
      sendMark(name) {
        marks.push(name);
      },
      clear: vi.fn(),
    }, { admission });

    controller.startResponse("response-admitted");
    controller.appendDelta("response-admitted", Buffer.alloc(52 * 160, 1).toString("base64"));
    expect(admission.getResidentBytes()).toBe(320);

    controller.acknowledgeMark(marks[0] ?? "missing");
    expect(admission.getResidentBytes()).toBe(160);

    controller.interrupt();
    expect(admission.getResidentBytes()).toBe(0);
  });

  it("releases queued playback admission on terminal disposal without clearing Twilio", () => {
    const clear = vi.fn();
    const admission = new PstnPremiumPlaybackAdmission(320);
    const controller = new PstnPremiumPlaybackController({
      sendFrame() {},
      sendMark() {},
      clear,
    }, { admission });

    controller.startResponse("response-disposed");
    controller.appendDelta("response-disposed", Buffer.alloc(52 * 160, 1).toString("base64"));
    controller.dispose();

    expect(admission.getResidentBytes()).toBe(0);
    expect(clear).not.toHaveBeenCalled();
  });

  it("rejects an oversized provider delta before decoding it", () => {
    const controller = new PstnPremiumPlaybackController({
      sendFrame() {},
      sendMark() {},
      clear() {},
    });
    controller.startResponse("response-oversized-delta");

    expect(() => controller.appendDelta(
      "response-oversized-delta",
      "A".repeat(100_000),
    )).toThrow("premium_playback_delta_too_large");
  });

  it("reports response completion only after all of its playback marks are acknowledged", () => {
    const marks: string[] = [];
    const completed = vi.fn();
    const controller = new PstnPremiumPlaybackController({
      sendFrame() {},
      sendMark(name) {
        marks.push(name);
      },
      clear: vi.fn(),
      onResponseCompleted: completed,
    });

    controller.startResponse("response-complete");
    controller.appendDelta("response-complete", Buffer.alloc(320, 7).toString("base64"));
    expect(marks).toHaveLength(2);
    controller.finishResponse("response-complete");
    expect(marks).toHaveLength(3);
    controller.finishResponse("response-complete");
    expect(marks).toHaveLength(3);
    expect(completed).not.toHaveBeenCalled();

    controller.acknowledgeMark(marks[1] ?? "missing");
    expect(completed).not.toHaveBeenCalled();
    controller.acknowledgeMark(marks[0] ?? "missing");
    expect(completed).not.toHaveBeenCalled();
    controller.acknowledgeMark(marks[2] ?? "missing");

    expect(completed).toHaveBeenCalledOnce();
    expect(completed).toHaveBeenCalledWith({ responseId: "response-complete", generation: 0 });
    expect(controller.finishResponse("response-complete")).toEqual({
      accepted: false,
      reason: "response_invalidated",
    });
    expect(controller.appendDelta("response-complete", Buffer.alloc(160).toString("base64"))).toEqual({
      accepted: false,
      reason: "response_invalidated",
    });
    expect(marks).toHaveLength(3);
  });

  it("clears interrupted ownership and rejects late old-response events while accepting a new generation", () => {
    const sent: Array<{ responseId: string; generation: number }> = [];
    const marks: string[] = [];
    const clear = vi.fn();
    const completed = vi.fn();
    const controller = new PstnPremiumPlaybackController({
      sendFrame(frame) {
        sent.push({ responseId: frame.responseId, generation: frame.generation });
      },
      sendMark(name) {
        marks.push(name);
      },
      clear,
      onResponseCompleted: completed,
    });
    controller.startResponse("response-old");
    controller.appendDelta("response-old", Buffer.alloc((51 * 160) + 3, 5).toString("base64"));
    const staleMark = marks[0] ?? "missing";

    controller.interrupt();

    expect(clear).toHaveBeenCalledOnce();
    expect(controller.getState()).toMatchObject({
      generation: 1,
      inFlightMarkCount: 0,
      queuedFrameCount: 0,
      queuedAudioBytes: 0,
      remainderByteCount: 0,
      trackedResponseCount: 0,
      invalidatedResponseCount: 1,
    });
    expect(controller.appendDelta("response-old", Buffer.alloc(160).toString("base64"))).toEqual({
      accepted: false,
      reason: "response_invalidated",
    });
    expect(controller.finishResponse("response-old")).toEqual({
      accepted: false,
      reason: "response_invalidated",
    });
    controller.acknowledgeMark(staleMark);
    expect(controller.getState().inFlightMarkCount).toBe(0);

    controller.interrupt();
    expect(clear).toHaveBeenCalledOnce();
    expect(controller.getState().generation).toBe(1);

    expect(controller.startResponse("response-new")).toEqual({ accepted: true });
    const newMarkStart = marks.length;
    expect(controller.appendDelta("response-new", Buffer.alloc(160, 9).toString("base64"))).toEqual({
      accepted: true,
    });
    controller.finishResponse("response-new");
    for (const mark of marks.slice(newMarkStart)) {
      controller.acknowledgeMark(mark);
    }
    expect(sent.at(-1)).toEqual({ responseId: "response-new", generation: 1 });
    expect(completed).toHaveBeenCalledWith({ responseId: "response-new", generation: 1 });
  });

  it("bounds active and invalidated response ID metadata", () => {
    const controller = new PstnPremiumPlaybackController({
      sendFrame() {},
      sendMark() {},
      clear() {},
    });

    for (let index = 0; index < 64; index += 1) {
      controller.startResponse(`active-${index}`);
      controller.appendDelta(`active-${index}`, Buffer.from([index]).toString("base64"));
    }
    expect(() => controller.startResponse("active-overflow"))
      .toThrow("premium_playback_overflow");
    expect(controller.getState().trackedResponseCount).toBe(64);

    controller.interrupt();
    for (let index = 0; index < 70; index += 1) {
      controller.startResponse(`new-${index}`);
      controller.appendDelta(`new-${index}`, Buffer.from([index]).toString("base64"));
      controller.interrupt();
    }

    expect(controller.getState()).toMatchObject({
      trackedResponseCount: 0,
      invalidatedResponseCount: 64,
    });
    expect(controller.appendDelta("active-0", Buffer.alloc(160).toString("base64"))).toEqual({
      accepted: false,
      reason: "response_unregistered",
    });
  });

  it("invalidates a response interrupted before its first audio delta", () => {
    const clear = vi.fn();
    const controller = new PstnPremiumPlaybackController({
      sendFrame() {},
      sendMark() {},
      clear,
    });
    controller.startResponse("response-before-audio");

    controller.interrupt();

    expect(clear).toHaveBeenCalledOnce();
    expect(controller.getState().generation).toBe(1);
    expect(controller.appendDelta(
      "response-before-audio",
      Buffer.alloc(160).toString("base64"),
    )).toEqual({ accepted: false, reason: "response_invalidated" });
  });
});
