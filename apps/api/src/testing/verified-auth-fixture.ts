import type request from "supertest";
import { getAuthEmailDeliveriesForTests } from "../auth/auth-email-delivery";

type Agent = Pick<ReturnType<typeof request.agent>, "get" | "post">;
type Credentials = { email: string; password: string; name: string; organizationName?: string; [key: string]: unknown };

// Test setup crosses the real verification endpoint; it never changes user rows.
export async function verifiedSignup(agent: Agent, input: Credentials) {
  const signup = await agent.post("/api/auth/sign-up/email").send(input);
  if (signup.status !== 200) return signup;
  await verifyEmail(agent, input.email);
  return agent.post("/api/auth/sign-in/email").send({ email: input.email, password: input.password });
}

export async function verifiedOnboarding(agent: Agent, input: Credentials) {
  const signup = await agent.post("/api/auth/onboarding/signup").send(input);
  if (signup.body.onboarding?.status !== "verification_required") return signup;
  await verifyEmail(agent, input.email);
  return agent.post("/api/auth/onboarding/signup").send({ ...input, resume: true });
}

export async function verifyEmail(agent: Agent, email: string) {
  const delivery = getAuthEmailDeliveriesForTests().slice().reverse().find((item) => item.to === email && item.kind === "email_verification");
  if (!delivery) throw new Error("Test account has no verification email");
  const link = new URL(delivery.url);
  const response = await agent.get(`${link.pathname}${link.search}`);
  if (response.status !== 200 && response.status !== 302) throw new Error(`Test email verification failed: ${response.status}`);
}
