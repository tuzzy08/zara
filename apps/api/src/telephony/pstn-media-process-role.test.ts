import { describe, expect, it } from "vitest";

import {
  isPstnRuntimeServedByProcess,
  resolvePstnMediaProcessRole,
  resolvePstnMediaWorkerId,
  resolvePstnMediaWorkerReleaseId,
} from "./pstn-media-process-role";

describe("resolvePstnMediaProcessRole", () => {
  it("defaults the API artifact to sandwich-only media ownership", () => {
    expect(resolvePstnMediaProcessRole({})).toBe("api");
  });

  it("selects the premium worker explicitly", () => {
    expect(
      resolvePstnMediaProcessRole({
        ZARA_PROCESS_ROLE: "pstn-realtime-worker",
      }),
    ).toBe("pstn-realtime-worker");
  });

  it("rejects unknown process roles instead of enabling both media owners", () => {
    expect(() =>
      resolvePstnMediaProcessRole({
        ZARA_PROCESS_ROLE: "all",
      }),
    ).toThrow("Invalid ZARA_PROCESS_ROLE");
  });

  it("serves exactly one PSTN runtime per process role", () => {
    expect(isPstnRuntimeServedByProcess("api", "pstn-sandwich")).toBe(true);
    expect(
      isPstnRuntimeServedByProcess("api", "pstn-premium-realtime"),
    ).toBe(false);
    expect(
      isPstnRuntimeServedByProcess(
        "pstn-realtime-worker",
        "pstn-premium-realtime",
      ),
    ).toBe(true);
    expect(
      isPstnRuntimeServedByProcess(
        "pstn-realtime-worker",
        "pstn-sandwich",
      ),
    ).toBe(false);
  });

  it("requires a bounded identity only for the premium worker", () => {
    expect(resolvePstnMediaWorkerId("api", {})).toBeUndefined();
    expect(resolvePstnMediaWorkerId("pstn-realtime-worker", {
      PSTN_WORKER_ID: "worker-eu-1",
    })).toBe("worker-eu-1");
    expect(() =>
      resolvePstnMediaWorkerId("pstn-realtime-worker", {
        PSTN_WORKER_ID: "",
      }),
    ).toThrow("PSTN_WORKER_ID");
    expect(() =>
      resolvePstnMediaWorkerId("pstn-realtime-worker", {
        PSTN_WORKER_ID: "worker@legacy/path",
      }),
    ).toThrow("PSTN_WORKER_ID");
  });

  it("requires an explicit release identity only for the premium worker", () => {
    expect(resolvePstnMediaWorkerReleaseId("api", {})).toBeUndefined();
    expect(resolvePstnMediaWorkerReleaseId("pstn-realtime-worker", {
      PSTN_WORKER_RELEASE_ID: "release-2026-07-25",
    })).toBe("release-2026-07-25");
    expect(() =>
      resolvePstnMediaWorkerReleaseId("pstn-realtime-worker", {
        PSTN_WORKER_RELEASE_ID: "",
      }),
    ).toThrow("PSTN_WORKER_RELEASE_ID");
  });
});
