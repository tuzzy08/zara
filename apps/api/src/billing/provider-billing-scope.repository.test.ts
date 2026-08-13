import { newDb } from "pg-mem";
import { describe, expect, it } from "vitest";

import { PostgresProviderBillingScopeRepository } from "./provider-billing-scope.repository";

describe("PostgresProviderBillingScopeRepository", () => {
  it("returns one tenant-qualified active provider scope and isolates another tenant", async () => {
    const database = newDb();
    database.public.none(`
      create table billing_provider_tenant_scopes (
        id text primary key,
        tenant_id text not null,
        provider text not null,
        external_scope_id text not null,
        configuration jsonb not null,
        effective_from timestamptz not null,
        effective_until timestamptz,
        created_at timestamptz not null
      );
      insert into billing_provider_tenant_scopes values
        ('scope-a', 'tenant-a', 'openai', 'project-a', '{"projectId":"project-a"}', '2026-01-01', null, '2026-01-01'),
        ('scope-b', 'tenant-b', 'openai', 'project-b', '{"projectId":"project-b"}', '2026-01-01', null, '2026-01-01');
    `);
    const adapter = database.adapters.createPg();
    const pool = new adapter.Pool();
    const repository = new PostgresProviderBillingScopeRepository(pool);

    await expect(repository.readActiveScope({
      organizationId: "tenant-a",
      provider: "openai",
      cycleStartsAt: "2026-08-01T00:00:00.000Z",
      cycleEndsAt: "2026-09-01T00:00:00.000Z",
    })).resolves.toEqual({
      id: "scope-a",
      externalScopeId: "project-a",
      configuration: { projectId: "project-a" },
    });
    await pool.end();
  });

  it("fails closed for missing, overlapping, or partial-cycle scopes", async () => {
    const database = newDb();
    database.public.none(`
      create table billing_provider_tenant_scopes (
        id text primary key,
        tenant_id text not null,
        provider text not null,
        external_scope_id text not null,
        configuration jsonb not null,
        effective_from timestamptz not null,
        effective_until timestamptz,
        created_at timestamptz not null
      );
      insert into billing_provider_tenant_scopes values
        ('scope-a1', 'tenant-a', 'gemini', 'project-a', '{}', '2026-01-01', null, '2026-01-01'),
        ('scope-a2', 'tenant-a', 'gemini', 'project-a-2', '{}', '2026-01-01', null, '2026-01-01'),
        ('scope-c', 'tenant-c', 'openai', 'project-c', '{}', '2026-08-15', null, '2026-08-15');
    `);
    const adapter = database.adapters.createPg();
    const pool = new adapter.Pool();
    const repository = new PostgresProviderBillingScopeRepository(pool);
    const cycle = {
      cycleStartsAt: "2026-08-01T00:00:00.000Z",
      cycleEndsAt: "2026-09-01T00:00:00.000Z",
    };

    await expect(repository.readActiveScope({ organizationId: "tenant-x", provider: "openai", ...cycle }))
      .resolves.toBeNull();
    await expect(repository.readActiveScope({ organizationId: "tenant-a", provider: "gemini", ...cycle }))
      .rejects.toThrow("Provider billing scope is ambiguous");
    await expect(repository.readActiveScope({ organizationId: "tenant-c", provider: "openai", ...cycle }))
      .resolves.toBeNull();
    await pool.end();
  });
});
