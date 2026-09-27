import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { InstructionImprovementService } from "./instruction-improvement.service";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { RuntimePromptPolicyService } from "../runtime-prompt-policy/runtime-prompt-policy.service";
import { PostgresPoolService } from "../database/postgres-pool.service";
import { ConnectorToolsService } from "../integrations/connector-tools.service";

const draft = {
  workspaceId: "workspace-default", name: "Support", businessName: "Sample shop", agentClass: "support",
  instructions: "Help track orders. Never promise a delivery date.",
  languagePolicy: { defaultLanguage: "en", supportedLanguages: ["en"], allowMidCallSwitching: false },
  tools: [{ id: "lookup", label: "Order Lookup", whenToUse: "Track an order", requiredInputs: ["orderId"], requiresHumanApproval: false, available: true }],
  handoffTargets: [],
};
const result = { instructions: "Purpose\nTrack orders.\nProcess\nAsk for the order number, then use Order Lookup.\nLimits\nNever promise a delivery date.",
  changes: ["Added a required-input step."], questions: [], conflicts: [], toolIds: ["lookup"], handoffTargetIds: [] };
const actor = { organizationId: "tenant-test", userId: "builder-1", role: "builder" as const };

function setup(output: unknown = result) {
  const workspaces = new WorkspacesService();
  workspaces.setMembershipRole({ organizationId: actor.organizationId, workspaceId: draft.workspaceId,
    userId: actor.userId, role: "builder", actorUserId: actor.userId });
  const query = vi.fn().mockResolvedValue({ rows: [{ count: 1 }] });
  const policy = { getPromptPolicy: vi.fn().mockResolvedValue({ agentClassTemplates: { support: { label: "Support" } } }) };
  const connectorTools = { listTools: vi.fn().mockReturnValue([{ toolId: "zendesk.tickets.search", inputSchema: { required: ["query"] }, requiredAlternatives: [["email"], ["ticketId"]] }]) };
  const service = new InstructionImprovementService(workspaces,
    policy as unknown as RuntimePromptPolicyService, { pool: { query } } as unknown as PostgresPoolService,
    connectorTools as unknown as ConnectorToolsService);
  const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ id: "chat-test", created: 1_800_000_000,
    usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    choices: [{ finish_reason: "stop", message: { content: JSON.stringify(output) } }] })));
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  return { service, fetchMock, query, workspaces };
}

describe("instruction improvement", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it("returns a review draft with the original intact and sends only bounded safe context", async () => {
    const { service, fetchMock, query } = setup();
    const response = await service.improve({ ...draft, credential: "never-send", tools: [{ ...draft.tools[0], token: "never-send" }] }, actor);
    expect(response).toMatchObject({ originalInstructions: draft.instructions, ...result });
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.messages[0].content).toContain("Do not invent");
    expect(body.messages[1].content).toContain("orderId");
    expect(JSON.stringify(body)).not.toContain("never-send");
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.max_completion_tokens).toBe(4096);
    expect(fetchMock.mock.calls[0]![1].signal).toBeInstanceOf(AbortSignal);
    expect(query.mock.calls.some(([sql]) => String(sql).includes("provider_usage_requests"))).toBe(true);
  });

  it("rejects malformed or oversized input before any provider or database request", async () => {
    const { service, fetchMock, query } = setup();
    for (const invalid of [null, {}, { ...draft, instructions: "x".repeat(12001) },
      { ...draft, tools: "lookup" }, { ...draft, languagePolicy: { ...draft.languagePolicy, defaultLanguage: "fr" } }]) {
      await expect(service.improve(invalid, actor)).rejects.toMatchObject({ status: 400 });
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it("includes connector-owned input rules and saved language guidance", async () => {
    const { service, fetchMock } = setup();
    await service.improve({ ...draft,
      languagePolicy: { ...draft.languagePolicy, languagePrompts: { en: "Use the term parcel." } },
      tools: [{ ...draft.tools[0], connector: "zendesk", toolId: "zendesk.tickets.search" }],
    }, actor);
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    const context = JSON.parse(body.messages[1].content).draftContext;
    expect(context.languagePolicy.languagePrompts.en).toBe("Use the term parcel.");
    expect(context.tools[0].requiredInputs).toEqual(["orderId", "query"]);
    expect(context.tools[0].requiredAlternatives).toEqual([["email"], ["ticketId"]]);
  });

  it("requires a builder in the requested active workspace", async () => {
    const { service, fetchMock } = setup();
    for (const denied of [{ ...actor, role: "viewer" as const }, { ...actor, userId: "another-user" },
      { ...actor, organizationId: "other-tenant" }]) {
      await expect(service.improve(draft, denied)).rejects.toMatchObject({ status: 403 });
    }
    await expect(service.improve({ ...draft, workspaceId: "missing" }, actor)).rejects.toMatchObject({ status: 403 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects unknown classes and unavailable tool references", async () => {
    const { service, fetchMock } = setup();
    await expect(service.improve({ ...draft, agentClass: "invented" }, actor)).rejects.toMatchObject({ status: 400 });
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(service.improve({ ...draft, tools: [{ ...draft.tools[0], available: false }] }, actor)).rejects.toMatchObject({ status: 502 });
  });

  it("does not accept unknown capabilities, malformed output, or oversized drafts", async () => {
    for (const invalid of [{ ...result, toolIds: ["refund"] }, { ...result, handoffTargetIds: ["sales"] },
      { ...result, instructions: "x".repeat(12001) }, { instructions: "draft" }]) {
      const { service } = setup(invalid);
      await expect(service.improve(draft, actor)).rejects.toMatchObject({ status: 502 });
    }
  });

  it("returns provider errors without leaking provider payloads", async () => {
    const { service, fetchMock } = setup();
    fetchMock.mockResolvedValue(new Response("private-provider-error", { status: 429 }));
    await expect(service.improve(draft, actor)).rejects.toThrow("Instructions could not be improved. Try again.");
  });

  it("fails closed if provider configuration is missing", async () => {
    const { service, fetchMock } = setup();
    vi.stubEnv("OPENAI_API_KEY", "");
    await expect(service.improve(draft, actor)).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("enforces a shared database rate limit before spending on generation", async () => {
    const { service, query, fetchMock } = setup();
    query.mockResolvedValue({ rows: [{ count: 7 }] });
    await expect(service.improve(draft, actor)).rejects.toMatchObject({ status: 429 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.skipIf(!process.env.ZARA_TEST_POSTGRES_URL)("limits concurrent requests and resets the window in Postgres", async () => {
    const schema = `instruction_test_${randomUUID().replaceAll("-", "")}`;
    const admin = new Pool({ connectionString: process.env.ZARA_TEST_POSTGRES_URL });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    const pool = new Pool({ connectionString: process.env.ZARA_TEST_POSTGRES_URL, options: `-c search_path=${schema}` });
    try {
      await pool.query(readFileSync(new URL("../database/migrations/0006_auth_rate_limit_table.sql", import.meta.url), "utf8"));
      const { service, query, fetchMock } = setup();
      query.mockImplementation(async (sql: string, params: unknown[]) => sql.includes('INSERT INTO "rateLimit"')
        ? pool.query(sql, params) : { rows: [{ count: 1 }] });
      const requests = await Promise.allSettled(Array.from({ length: 10 }, () => service.improve(draft, actor)));
      expect(requests.filter(request => request.status === "fulfilled")).toHaveLength(6);
      expect(requests.filter(request => request.status === "rejected").map(request => request.reason.status)).toEqual([429, 429, 429, 429]);
      expect(fetchMock).toHaveBeenCalledTimes(6);
      await pool.query('UPDATE "rateLimit" SET "lastRequest" = $1', [Date.now() - 60_001]);
      await expect(service.improve(draft, actor)).resolves.toMatchObject({ instructions: result.instructions });
      expect((await pool.query('SELECT "count" FROM "rateLimit"')).rows[0].count).toBe(1);
    } finally {
      await pool.end();
      await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      await admin.end();
    }
  });
});
