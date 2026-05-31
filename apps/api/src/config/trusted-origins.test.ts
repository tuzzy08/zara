import { describe, expect, it } from "vitest";

import { resolveTrustedOrigins } from "./trusted-origins";

describe("resolveTrustedOrigins", () => {
  it("adds deployment-specific browser origins for API CORS and Better Auth", () => {
    expect(
      resolveTrustedOrigins({
        ZARA_TRUSTED_ORIGINS: "https://app.example.com, https://admin.example.com",
      }),
    ).toEqual(
      expect.arrayContaining([
        "https://app.zara.ai",
        "https://admin.zara.ai",
        "https://app.example.com",
        "https://admin.example.com",
      ]),
    );
  });

  it("rejects non-origin values instead of widening browser trust", () => {
    expect(() =>
      resolveTrustedOrigins({
        ZARA_TRUSTED_ORIGINS: "https://app.example.com/path",
      }),
    ).toThrow("ZARA_TRUSTED_ORIGINS entry 'https://app.example.com/path' must be an origin");
  });
});
