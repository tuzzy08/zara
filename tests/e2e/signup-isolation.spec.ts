import { expect, test, type Page } from "@playwright/test";

const password = "Disposable-E2E-Password-834!";
async function signup(page: Page, name: string, checkValidation = false) {
  const email = `${name}@example.test`;
  await page.goto("/signup");
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Organization name", { exact: true }).fill(`E2E ${name}`);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  if (checkValidation) {
    await page.getByLabel("Confirm password", { exact: true }).fill("Different-password-834!");
    await page.getByRole("button", { name: "Create account", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveText("Passwords do not match.");
    expect((await (await page.request.get("/api/auth/context")).json()).authenticated).toBe(false);
    await page.getByLabel("Confirm password", { exact: true }).fill(password);
    await page.getByLabel("Email", { exact: true }).fill("not-an-email");
    await page.getByRole("button", { name: "Create account", exact: true }).click();
    expect(await page.getByLabel("Email", { exact: true }).evaluate((input: HTMLInputElement) => input.validity.typeMismatch)).toBe(true);
    await page.getByLabel("Email", { exact: true }).fill(email);
  }
  await page.getByLabel("Confirm password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Check your email.");
  expect((await (await page.request.get("/api/auth/context")).json()).authenticated).toBe(false);
  if (checkValidation) {
    const unverifiedSignin = await page.request.post("/api/auth/sign-in/email", {
      headers: { origin: "https://127.0.0.1:8443" },
      data: { email, password },
    });
    expect(unverifiedSignin.status()).toBe(403);
    expect((await unverifiedSignin.json()).code).toBe("EMAIL_NOT_VERIFIED");
  }
  let verificationUrl = "";
  await expect.poll(async () => {
    const messages = await (await page.request.get(`/__e2e/messages?to=${encodeURIComponent(email)}`)).json();
    verificationUrl = messages.find((message: { kind: string }) => message.kind === "email_verification")?.url ?? "";
    return verificationUrl;
  }).not.toBe("");
  const link = new URL(verificationUrl);
  expect(link.origin).toBe("https://127.0.0.1:8443");
  if (checkValidation) {
    const invalidLink = new URL(link);
    invalidLink.searchParams.set("token", "invalid-e2e-token");
    const invalid = await page.request.get(invalidLink.href);
    expect(new URL(invalid.url()).searchParams.get("error")).toBe("INVALID_TOKEN");
    expect((await (await page.request.get("/api/auth/context")).json()).authenticated).toBe(false);
  }
  await page.request.get(verificationUrl);
  expect((await (await page.request.get("/api/auth/context")).json()).authenticated).toBe(false);
  if (checkValidation) {
    // A mail link can open after the original form has been closed.
    await page.goto(verificationUrl);
    await expect(page.getByRole("button", { name: "Continue after verification", exact: true })).toBeVisible();
    await page.getByLabel("Name", { exact: true }).fill(name);
    await page.getByLabel("Organization name", { exact: true }).fill(`E2E ${name}`);
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByLabel("Confirm password", { exact: true }).fill(password);
  }
  await page.getByRole("button", { name: "Continue after verification", exact: true }).click();
  await expect(page.getByRole("button", { name: "Open profile menu" })).toBeVisible();
  const response = await page.request.get("/api/auth/context");
  expect(response.status()).toBe(200);
  const context = await response.json();
  expect(context.authenticated).toBe(true);
  expect(context.user.email).toBe(email);
  expect(context.activeOrganization.id).toBeTruthy();
  expect((await (await page.request.get("/api/auth/get-session")).json()).user.emailVerified).toBe(true);
  const sessionCookie = (await page.context().cookies()).find((cookie) => cookie.name.endsWith("session_token"));
  expect(sessionCookie).toMatchObject({ secure: true, httpOnly: true });
  return { email, userId: context.user.id, organizationId: context.activeOrganization.id };
}

test("signup, email verification, sign-out and password sign-in", async ({ page }, testInfo) => {
  const account = await signup(page, "signup-owner", true);
  await page.goto("/");
  await page.getByRole("button", { name: "Open profile menu" }).click();
  await page.getByText("Sign out", { exact: true }).click();
  await expect.poll(async () => (await (await page.request.get("/api/auth/context")).json()).authenticated).toBe(false);
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  await page.getByLabel("Email", { exact: true }).fill(account.email);
  await page.getByLabel("Password", { exact: true }).fill("wrong-password");
  const wrongPasswordResponse = page.waitForResponse((response) => response.url().endsWith("/api/auth/sign-in/email") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  expect((await wrongPasswordResponse).status()).toBe(401);
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("button", { name: "Open profile menu" })).not.toBeVisible();
  await page.getByLabel("Password", { exact: true }).fill(password);
  let signinResponse = page.waitForResponse((response) => response.url().endsWith("/api/auth/sign-in/email") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  let response = await signinResponse;
  if (response.status() === 429) {
    await expect(page.getByRole("alert")).toContainText("Too many requests");
    const retryAfter = Number(response.headers()["x-retry-after"]);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(10);
    // Respect the real server rate limit; this is server-directed backoff, not a readiness sleep.
    await page.waitForTimeout((retryAfter + 1) * 1000);
    signinResponse = page.waitForResponse((result) => result.url().endsWith("/api/auth/sign-in/email") && result.request().method() === "POST");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    response = await signinResponse;
  }
  expect(response.status()).toBe(200);
  await expect(page.getByRole("button", { name: "Open profile menu" })).toBeVisible();
  expect((await (await page.request.get("/api/auth/context")).json()).user.id).toBe(account.userId);
  await testInfo.attach("verified-account", { body: JSON.stringify({ email: account.email, verified: true, signedInAgain: true }), contentType: "application/json" });
});

test("two tenants cannot read or change each other's workspaces, even with forged headers", async ({ browser }, testInfo) => {
  const ownerContext = await browser.newContext({ baseURL: "https://127.0.0.1:8443", ignoreHTTPSErrors: true });
  const otherContext = await browser.newContext({ baseURL: "https://127.0.0.1:8443", ignoreHTTPSErrors: true });
  const anonymous = await browser.newContext({ baseURL: "https://127.0.0.1:8443", ignoreHTTPSErrors: true });
  try {
    const owner = await signup(await ownerContext.newPage(), "tenant-owner");
    const other = await signup(await otherContext.newPage(), "tenant-other");
    expect(owner.organizationId).not.toBe(other.organizationId);
    const path = `/organizations/${owner.organizationId}/workspaces`;
    const created = await ownerContext.request.post(path, { data: { name: "Private owner workspace" } });
    expect(created.status()).toBe(201);
    const before = await (await ownerContext.request.get(`${path}/state`)).json();
    const workspace = before.workspaces.find((item: { name: string }) => item.name === "Private owner workspace");
    expect(workspace).toBeTruthy();
    const headers = { "x-zara-test-organization-id": owner.organizationId, "x-zara-test-user-id": owner.userId, "x-zara-test-tenant-role": "owner" };
    for (const attacker of [otherContext, anonymous]) {
      const expectedStatus = attacker === anonymous ? 401 : 403;
      expect((await attacker.request.get(`${path}/state`, { headers })).status()).toBe(expectedStatus);
      expect((await attacker.request.post(path, { headers, data: { name: "Injected workspace" } })).status()).toBe(expectedStatus);
      expect((await attacker.request.patch(`${path}/${workspace.id}`, { headers, data: { action: "rename", nextName: "Stolen", actorUserId: owner.userId } })).status()).toBe(expectedStatus);
    }
    const after = await (await ownerContext.request.get(`${path}/state`)).json();
    expect(after.workspaces).toEqual(before.workspaces);
    const otherState = await otherContext.request.get(`/organizations/${other.organizationId}/workspaces/state`);
    expect(otherState.status()).toBe(200);
    expect(JSON.stringify(await otherState.json())).not.toContain("Private owner workspace");
    await testInfo.attach("isolation-evidence", { body: JSON.stringify({ deniedRequests: 6, ownerDataUnchanged: true, tenantsDistinct: true }), contentType: "application/json" });
  } finally {
    await ownerContext.close(); await otherContext.close(); await anonymous.close();
  }
});
