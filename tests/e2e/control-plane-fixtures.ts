import { spawnSync } from "node:child_process";
import { setTimeout } from "node:timers/promises";
import { expect, type APIRequestContext } from "@playwright/test";

export const origin = "https://127.0.0.1:8443";
export const peer = { "X-E2E-API": "peer" };

function compose(args: string[]) {
  const project = process.env.E2E_COMPOSE_PROJECT;
  if (!project || !/^zara-e2e-\d+-\d+$/.test(project)) throw new Error("Use the isolated E2E runner");
  const result = spawnSync("docker", ["compose", "--env-file", "tests/e2e/compose.env", "-p", project, "-f", "tests/e2e/compose.yml", ...args], { encoding: "utf8", timeout: 60_000 });
  if (result.error || result.status !== 0) throw new Error(JSON.stringify({ exitCode: result.status, error: result.error?.message, stdout: result.stdout, stderr: result.stderr }));
  return result.stdout.trim();
}

export function database(sql: string) {
  return compose(["exec", "-T", "--interactive=false", "db", "psql", "-U", "e2e", "-d", "zara_e2e", "-At", "-v", "ON_ERROR_STOP=1", "-c", sql]);
}

export function literal(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

export function probeShutdownPool() {
  const script = `
import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { PostgresPoolService } from './apps/api/dist-js/database/postgres-pool.service.js';
const pool = new PostgresPoolService();
let completed = false;
class ProbeModule {}
Module({ providers: [
  { provide: PostgresPoolService, useValue: pool },
  { provide: 'drain', useValue: { async beforeApplicationShutdown() {
    await pool.pool.query('CREATE TEMP TABLE shutdown_probe (completed boolean); INSERT INTO shutdown_probe VALUES (true)');
    completed = true;
  } } },
] })(ProbeModule);
const app = await NestFactory.createApplicationContext(ProbeModule, { logger: false });
try {
  await app.close();
  if (!completed) throw new Error('Database drain did not finish');
  if (!pool.pool.ended) throw new Error('Database pool did not close after drain');
  process.stdout.write(JSON.stringify({ databaseDrainCompleted: completed, poolClosed: pool.pool.ended }));
} finally { if (!pool.pool.ended) await pool.pool.end(); }
`;
  return compose(["exec", "-T", "--interactive=false", "api", "node", "--input-type=module", "--eval", script]);
}

export function stopApi() {
  const startedAt = Date.now();
  compose(["stop", "--timeout", "10", "api"]);
  const state = JSON.parse(compose(["ps", "--all", "--format", "json", "api"]));
  return { elapsedMs: Date.now() - startedAt, exitCode: state.ExitCode, state: state.State };
}

export async function startApi(request: APIRequestContext) {
  compose(["start", "api"]);
  await expect.poll(async () => {
    try { return (await request.get("/health")).status(); } catch { return 0; }
  }, { timeout: 45_000 }).toBe(200);
}

export async function signup(request: APIRequestContext, name: string) {
  const email = `${name}@example.test`;
  const create = async (resume = false) => {
    const send = () => request.post("/api/auth/onboarding/signup", {
      headers: { origin }, data: { name, email, password: "Disposable-E2E-Password-834!", organizationName: `E2E ${name}`, resume },
    });
    let response = await send();
    if (response.status() === 400 && (await response.json()).message === "Too many requests. Please try again later.") {
      await setTimeout(11_000);
      response = await send();
    }
    return response;
  };
  const response = await create();
  expect(response.status(), await response.text()).toBe(200);
  let url = "";
  await expect.poll(async () => {
    const messages = await (await request.get(`/__e2e/messages?to=${encodeURIComponent(email)}`)).json();
    url = messages.find((message: { kind: string }) => message.kind === "email_verification")?.url ?? "";
    return url;
  }).not.toBe("");
  expect(new URL(url).origin).toBe(origin);
  await request.get(url);
  const completed = await create(true);
  expect(completed.status(), await completed.text()).toBe(200);
  const account = await completed.json();
  return { organizationId: account.activeOrganization.id as string, userId: account.user.id as string };
}
