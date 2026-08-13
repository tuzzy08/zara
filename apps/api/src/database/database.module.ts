import { Module } from "@nestjs/common";

import { PostgresPoolService } from "./postgres-pool.service";

@Module({
  providers: [PostgresPoolService],
  exports: [PostgresPoolService],
})
export class DatabaseModule {}
