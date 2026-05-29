export interface TenantMirrorInput {
  id: string;
  name: string;
  slug: string;
}

export interface TenantMirror {
  upsertTenant: (input: TenantMirrorInput) => Promise<void>;
}

export interface TenantMirrorQueryClient {
  query: (sql: string, values: unknown[]) => Promise<unknown>;
}

export function createPostgresTenantMirror(client: TenantMirrorQueryClient): TenantMirror {
  return {
    async upsertTenant(input) {
      await client.query(
        `
          INSERT INTO "tenants" ("id", "slug", "name", "status", "default_locale")
          VALUES ($1, $2, $3, 'active', 'en')
          ON CONFLICT ("id") DO UPDATE
          SET "slug" = EXCLUDED."slug",
              "name" = EXCLUDED."name",
              "updated_at" = now()
        `,
        [
          input.id,
          input.slug,
          input.name,
        ],
      );
    },
  };
}
