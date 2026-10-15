import { Module } from "@nestjs/common";

import { WorkspacesController } from "./workspaces.controller";
import { WorkspacesService } from "./workspaces.service";
import { DatabaseModule } from "../database/database.module";
import { PostgresPoolService } from "../database/postgres-pool.service";
import { InMemoryWorkspaceRepository, WORKSPACE_REPOSITORY } from "./workspace.repository";
import { PostgresWorkspaceRepository } from "./postgres-workspace.repository";

@Module({
  imports: [DatabaseModule],
  controllers: [WorkspacesController],
  providers: [WorkspacesService, {
    provide: WORKSPACE_REPOSITORY,
    useFactory: (database: PostgresPoolService) => process.env.NODE_ENV === "test" && process.env.ZARA_AUTH_DATABASE !== "postgres"
      ? new InMemoryWorkspaceRepository()
      : new PostgresWorkspaceRepository(database.pool),
    inject: [PostgresPoolService],
  }],
  exports: [WorkspacesService],
})
export class WorkspacesModule {}
