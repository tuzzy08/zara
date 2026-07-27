import { Module } from "@nestjs/common";

import { PostgresPoolService } from "../database/postgres-pool.service";
import {
  PUBLISHED_WORKFLOW_MANIFEST_REPOSITORY,
} from "./published-workflow-manifest.repository";
import { PostgresPublishedWorkflowManifestRepository } from "./postgres-published-workflow-manifest.repository";

@Module({
  providers: [
    PostgresPoolService,
    {
      provide: PUBLISHED_WORKFLOW_MANIFEST_REPOSITORY,
      useFactory: (postgresPoolService: PostgresPoolService) =>
        new PostgresPublishedWorkflowManifestRepository(
          postgresPoolService.pool,
        ),
      inject: [PostgresPoolService],
    },
  ],
  exports: [PUBLISHED_WORKFLOW_MANIFEST_REPOSITORY],
})
export class PublishedWorkflowManifestReadModule {}
