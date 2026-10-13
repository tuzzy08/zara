import { expect, test } from "@playwright/test";

test("signup loads within its script budget and works on a narrow screen", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/signup", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Create your Zara account" })).toBeVisible();
  await page.getByLabel("Email", { exact: true }).fill("load-check@example.test");
  const metrics = await page.evaluate(() => ({
    scriptBytes: performance.getEntriesByType("resource")
      .filter((entry) => (entry as PerformanceResourceTiming).initiatorType === "script")
      .reduce((bytes, entry) => bytes + (entry as PerformanceResourceTiming).decodedBodySize, 0),
    navigation: performance.getEntriesByType("navigation").map((entry) => entry.toJSON()),
    paints: performance.getEntriesByType("paint").map((entry) => entry.toJSON()),
    fitsViewport: document.documentElement.scrollWidth <= window.innerWidth,
  }));
  await testInfo.attach("signup-load", { body: JSON.stringify(metrics), contentType: "application/json" });
  await testInfo.attach("signup-mobile", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  expect(errors).toEqual([]);
  expect(metrics.fitsViewport).toBe(true);
  expect(metrics.scriptBytes).toBeGreaterThan(0);
  expect(metrics.scriptBytes).toBeLessThan(500_000);
});
