import { describe, expect, it } from "vitest";

import { assertProductionAuthCookieOriginCompatibility } from "./auth-cookie-origin";

describe("production auth cookie origin compatibility", () => {
  it("rejects a production API URL on a different site from the tenant app origin", () => {
    expect(() => assertProductionAuthCookieOriginCompatibility({
      NODE_ENV: "production",
      ZARA_ENV: "production",
      BETTER_AUTH_URL: "https://al3jsaee27rqqtxju38wjcf3.178.156.251.144.sslip.io",
      ZARA_TRUSTED_ORIGINS: "https://zharaai.com",
    })).toThrow(/same-site API origin/i);
  });

  it("allows production app and API origins on the same site", () => {
    expect(() => assertProductionAuthCookieOriginCompatibility({
      NODE_ENV: "production",
      ZARA_ENV: "production",
      BETTER_AUTH_URL: "https://api.zharaai.com",
      ZARA_TRUSTED_ORIGINS: "https://zharaai.com,https://admin.zharaai.com",
    })).not.toThrow();
  });

  it("allows the documented zara.ai production subdomains", () => {
    expect(() => assertProductionAuthCookieOriginCompatibility({
      NODE_ENV: "production",
      ZARA_ENV: "production",
      BETTER_AUTH_URL: "https://api.zara.ai",
      ZARA_TRUSTED_ORIGINS: "https://app.zara.ai,https://admin.zara.ai",
    })).not.toThrow();
  });
});
