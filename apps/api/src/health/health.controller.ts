import {
  Controller,
  Get,
  ServiceUnavailableException,
} from "@nestjs/common";

import { PstnAdmissionCoordinator } from "../telephony/pstn-admission-coordinator";

@Controller("health")
export class HealthController {
  constructor(
    private readonly pstnAdmissionCoordinator: PstnAdmissionCoordinator,
  ) {}

  @Get()
  getHealth() {
    return {
      status: "ok",
      service: "zara-api",
    };
  }

  @Get("ready")
  async getReadiness() {
    const pstnAdmission =
      await this.pstnAdmissionCoordinator.getHealth();
    const response = {
      status:
        pstnAdmission.status === "healthy" ? "ready" : "not_ready",
      checks: {
        pstnAdmission,
      },
    };
    if (pstnAdmission.status !== "healthy") {
      throw new ServiceUnavailableException(response);
    }
    return response;
  }
}

