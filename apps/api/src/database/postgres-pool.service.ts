import { Injectable, OnApplicationShutdown } from "@nestjs/common";
import { Pool } from "pg";

@Injectable()
export class PostgresPoolService implements OnApplicationShutdown {
  readonly pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  async onApplicationShutdown() {
    await this.pool.end();
  }
}
