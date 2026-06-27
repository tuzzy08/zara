import { describe, expect, it } from "vitest";

import { ApiError } from "./apiClient";
import { getDashboardResourceErrorMessage } from "./DashboardScreen";

describe("dashboard resource error messaging", () => {
  it("surfaces auth failures as a session message instead of a generic metrics warning", () => {
    const message = getDashboardResourceErrorMessage([
      {
        reason: new ApiError("Authentication required", 401, { message: "Authentication required" }),
        status: "rejected",
      },
    ]);

    expect(message).toBe("Your session has expired. Sign in again to load dashboard metrics.");
  });

  it("keeps the generic warning for non-auth partial metric failures", () => {
    const message = getDashboardResourceErrorMessage([
      {
        reason: new ApiError("Billing state could not be loaded", 503),
        status: "rejected",
      },
    ]);

    expect(message).toBe("Some dashboard metrics could not be loaded.");
  });
});
