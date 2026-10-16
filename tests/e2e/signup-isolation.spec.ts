import { expect, test, type Page } from "@playwright/test";

const password = "Disposable-E2E-Password-834!";
async function signup(page: Page, name: string, checkValidation = false) {
  const email = `${name}@example.test`;
  await page.goto("/signup");
  if (checkValidation) {
    await page.getByRole("link", { name: "Continue an existing signup" }).click();
    await page.getByLabel("Name", { exact: true }).fill(name);
    await page.getByLabel("Organization name", { exact: true }).fill(`E2E ${name}`);
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByLabel("Confirm password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Continue after verification", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Invalid email or password");
    expect((await (await page.request.get("/api/auth/context")).json()).authenticated).toBe(false);
    await expect(page.getByRole("heading", { name: "Continue your Zara signup" })).toBeVisible();
    await page.getByRole("link", { name: "Create a new account" }).click();
    await expect(page).toHaveURL(/\/signup$/);
    await expect(page.getByRole("alert")).not.toBeVisible();
  }
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Organization name", { exact: true }).fill(`E2E ${name}`);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  if (checkValidation) {
    await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("type", "password");
    await page.getByRole("button", { name: "Show password", exact: true }).click();
    await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("type", "text");
    await expect(page.getByLabel("Password", { exact: true })).toHaveValue(password);
    await page.getByRole("button", { name: "Hide password", exact: true }).press("Space");
    await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("type", "password");
    await page.getByLabel("Confirm password", { exact: true }).fill("Different-password-834!");
    await page.getByRole("button", { name: "Show confirm password", exact: true }).click();
    await expect(page.getByLabel("Confirm password", { exact: true })).toHaveAttribute("type", "text");
    await expect(page.getByLabel("Confirm password", { exact: true })).toHaveValue("Different-password-834!");
    await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("type", "password");
    await page.getByRole("button", { name: "Hide confirm password", exact: true }).press("Space");
    await expect(page.getByLabel("Confirm password", { exact: true })).toHaveAttribute("type", "password");
    await expect(page.getByRole("alert")).not.toBeVisible();
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
  await expect(page).toHaveURL(/\/signup\/success$/);
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  await expect(page.getByText(email, { exact: true })).toBeVisible();
  await expect(page.getByLabel("Password", { exact: true })).not.toBeVisible();
  if (checkValidation) {
    await test.info().attach("signup-success-desktop", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await test.info().attach("signup-success-mobile", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.reload();
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
    await expect(page.getByText(email, { exact: true })).toBeVisible();
    expect(await page.evaluate(() => JSON.stringify({ history: history.state, local: { ...localStorage }, session: { ...sessionStorage } }))).not.toContain(password);
  }
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
  let verificationHtml = "";
  let verificationText = "";
  await expect.poll(async () => {
    const messages = await (await page.request.get(`/__e2e/messages?to=${encodeURIComponent(email)}`)).json();
    const verification = messages.find((message: { kind: string }) => message.kind === "email_verification");
    verificationUrl = verification?.url ?? "";
    verificationHtml = verification?.html ?? "";
    verificationText = verification?.text ?? "";
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
  if (checkValidation) {
    expect(verificationText).toContain(verificationUrl);
    const inbox = await page.context().newPage();
    try {
      await inbox.setContent(verificationHtml);
      await expect(inbox.getByRole("heading", { name: "Verify your email" })).toBeVisible();
      const verify = inbox.getByRole("link", { name: "Verify email", exact: true });
      await expect(verify).toHaveAttribute("href", verificationUrl);
      await expect(inbox.getByRole("link", { name: verificationUrl, exact: true })).toHaveAttribute("href", verificationUrl);
      await test.info().attach("verification-email-desktop", { body: await inbox.screenshot({ fullPage: true }), contentType: "image/png" });
      await inbox.setViewportSize({ width: 390, height: 844 });
      expect(await inbox.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await test.info().attach("verification-email-mobile", { body: await inbox.screenshot({ fullPage: true }), contentType: "image/png" });
      await verify.click();
      await expect(inbox).toHaveURL(/\/signup\/verified$/);
      await expect(inbox.getByRole("heading", { name: "Email verified", exact: true })).toBeVisible();
    } finally {
      await inbox.close();
    }
  } else await page.request.get(verificationUrl);
  await page.goto("/signup/verified");
  await expect(page.getByRole("heading", { name: "Email verified", exact: true })).toBeVisible();
  await expect(page.getByLabel("Password", { exact: true })).not.toBeVisible();
  await expect(page.getByLabel("Organization name", { exact: true })).not.toBeVisible();
  if (checkValidation) {
    await page.reload();
    await expect(page.getByRole("heading", { name: "Email verified", exact: true })).toBeVisible();
    await test.info().attach("email-verified-desktop", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await test.info().attach("email-verified-mobile", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    await page.setViewportSize({ width: 1280, height: 720 });
  }
  await page.getByRole("button", { name: "Continue setup", exact: true }).click();
  await expect(page.getByRole("button", { name: "Open profile menu" })).toBeVisible();
  const response = await page.request.get("/api/auth/context");
  expect(response.status()).toBe(200);
  const context = await response.json();
  expect(context.authenticated).toBe(true);
  expect(context.user.email).toBe(email);
  expect(context.activeOrganization.id).toBeTruthy();
  expect(context.activeOrganization.name).toBe(`E2E ${name}`);
  expect(context.activeOrganization.role).toBe("owner");
  if (checkValidation) {
    const repeated = await Promise.all([1, 2].map(() => page.request.post("/api/auth/onboarding/complete", {
      headers: { origin: "https://127.0.0.1:8443" }, data: {},
    })));
    for (const result of repeated) {
      expect(result.status()).toBe(200);
      expect((await result.json()).activeOrganization.id).toBe(context.activeOrganization.id);
    }
    expect((await (await page.request.get("/api/auth/context")).json()).memberships).toHaveLength(1);
    const anonymous = await page.context().browser()!.newContext({ ignoreHTTPSErrors: true, baseURL: "https://127.0.0.1:8443" });
    try {
      const forged = await anonymous.newPage();
      await forged.goto("/signup/verified?verified=true");
      await expect(forged.getByRole("heading", { name: "Email verified", exact: true })).not.toBeVisible();
      const denied = await anonymous.request.post("/api/auth/onboarding/complete", { headers: { origin: "https://127.0.0.1:8443" }, data: {} });
      expect(denied.status()).toBe(401);
      await forged.goto(verificationUrl);
      await expect(forged.getByRole("heading", { name: "Email verified", exact: true })).not.toBeVisible();
      expect((await (await anonymous.request.get("/api/auth/context")).json()).authenticated).toBe(false);
    } finally { await anonymous.close(); }
  }
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
  await page.getByRole("button", { name: "Show password", exact: true }).click();
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("type", "text");
  expect((await submitSignin(page)).status()).toBe(401);
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("type", "password");
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("button", { name: "Open profile menu" })).not.toBeVisible();
  await page.getByLabel("Password", { exact: true }).fill(password);
  expect((await submitSignin(page)).status()).toBe(200);
  await expect(page.getByRole("button", { name: "Open profile menu" })).toBeVisible();
  expect((await (await page.request.get("/api/auth/context")).json()).user.id).toBe(account.userId);
  await testInfo.attach("verified-account", { body: JSON.stringify({ email: account.email, verified: true, signedInAgain: true }), contentType: "application/json" });
});

async function submitSignin(page: Page) {
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
  return response;
}

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
