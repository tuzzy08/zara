import { Body, Controller, Post } from "@nestjs/common";

import {
  RuntimeSessionsService,
  type CreateRealtimeSessionRequest,
} from "./runtime-sessions.service";

@Controller("runtime/realtime/sessions")
export class RuntimeSessionsController {
  constructor(private readonly runtimeSessionsService: RuntimeSessionsService) {}

  @Post()
  async createPremiumRealtimeSession(@Body() body: CreateRealtimeSessionRequest) {
    return {
      session: await this.runtimeSessionsService.createRealtimeSession(body),
    };
  }
}
