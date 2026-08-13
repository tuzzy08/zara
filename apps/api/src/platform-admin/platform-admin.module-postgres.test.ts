import { describe, expect, it } from "vitest";

import { DatabaseModule } from "../database/database.module";
import { PostgresPoolService } from "../database/postgres-pool.service";
import { PlatformAdminModule } from "./platform-admin.module";

describe("PlatformAdminModule Postgres provider graph", () => {
  it("imports the shared database provider instead of declaring an independent pool", () => {
    const imports = Reflect.getMetadata("imports", PlatformAdminModule) as unknown[];
    const providers = Reflect.getMetadata("providers", PlatformAdminModule) as unknown[];
    const databaseProviders = Reflect.getMetadata("providers", DatabaseModule) as unknown[];
    const databaseExports = Reflect.getMetadata("exports", DatabaseModule) as unknown[];

    expect(imports).toContain(DatabaseModule);
    expect(providers).not.toContain(PostgresPoolService);
    expect(databaseProviders).toContain(PostgresPoolService);
    expect(databaseExports).toContain(PostgresPoolService);
  });
});
