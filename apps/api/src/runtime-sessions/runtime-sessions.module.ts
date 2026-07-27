import { Module } from "@nestjs/common";

import { PremiumRealtimeRuntimeModule } from "./premium-realtime-runtime.module";
import { RuntimeSessionsController } from "./runtime-sessions.controller";
import { RuntimeSessionsWebSocketBridge } from "./runtime-sessions.websocket-bridge";

@Module({
  imports: [PremiumRealtimeRuntimeModule],
  controllers: [RuntimeSessionsController],
  providers: [RuntimeSessionsWebSocketBridge],
  exports: [PremiumRealtimeRuntimeModule],
})
export class RuntimeSessionsModule {}
