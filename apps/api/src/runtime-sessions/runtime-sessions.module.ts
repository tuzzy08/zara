import { Module } from "@nestjs/common";

import { RuntimeSessionsController } from "./runtime-sessions.controller";
import { RuntimeSessionsService } from "./runtime-sessions.service";

@Module({
  controllers: [RuntimeSessionsController],
  providers: [RuntimeSessionsService],
})
export class RuntimeSessionsModule {}
