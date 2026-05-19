import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { Pool } from "pg";

@Injectable()
export class PostgresPoolService implements OnModuleDestroy {
  readonly pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  async onModuleDestroy() {
    await this.pool.end();
  }
}
