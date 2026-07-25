import { Module } from "@nestjs/common";

import { PstnAdmissionModule } from "../telephony/pstn-admission.module";
import { HealthController } from "./health.controller";

@Module({
  imports: [PstnAdmissionModule],
  controllers: [HealthController],
})
export class HealthModule {}

