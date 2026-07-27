import { Module } from "@nestjs/common";

import { IntegrationsController } from "./integrations.controller";
import { IntegrationsRuntimeModule } from "./integrations-runtime.module";

@Module({
  imports: [IntegrationsRuntimeModule],
  controllers: [IntegrationsController],
  exports: [IntegrationsRuntimeModule],
})
export class IntegrationsModule {}
