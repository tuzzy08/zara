import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = resolve(__dirname, "..");
const repoRoot = resolve(appRoot, "../..");

describe("platform-admin deployment config", () => {
  it("declares separate admin environment and deploy security headers", () => {
    const envExamplePath = resolve(appRoot, ".env.example");
    const vercelConfigPath = resolve(appRoot, "vercel.json");
    const trustedOriginsPath = resolve(repoRoot, "apps/api/src/config/trusted-origins.ts");

    expect(existsSync(envExamplePath)).toBe(true);
    expect(existsSync(vercelConfigPath)).toBe(true);

    const envExample = readFileSync(envExamplePath, "utf8");
    expect(envExample).toContain("VITE_API_BASE_URL=");
    expect(envExample).toContain("VITE_AUTH_BASE_URL=");
    expect(envExample).toContain("VITE_PLATFORM_ADMIN_ORIGIN=");
    expect(envExample).toContain("https://admin.zara.ai");

    const vercelConfig = readFileSync(vercelConfigPath, "utf8");
    expect(vercelConfig).toContain("Content-Security-Policy");
    expect(vercelConfig).toContain("X-Frame-Options");
    expect(vercelConfig).toContain("Referrer-Policy");

    const trustedOriginsConfig = readFileSync(trustedOriginsPath, "utf8");
    expect(trustedOriginsConfig).toContain("http://127.0.0.1:4174");
    expect(trustedOriginsConfig).toContain("http://localhost:4174");
    expect(trustedOriginsConfig).toContain("https://staging-admin.zara.ai");
    expect(trustedOriginsConfig).toContain("https://admin.zara.ai");
    expect(trustedOriginsConfig).toContain("ZARA_TRUSTED_ORIGINS");
  });
});
