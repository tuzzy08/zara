import { Module } from "@nestjs/common";

import {
  FileRuntimeRoutePolicyRepository,
  InMemoryRuntimeRoutePolicyRepository,
} from "./runtime-route-policy.repository";
import {
  RuntimeRoutePolicyService,
  runtimeRoutePolicyRepositoryToken,
} from "./runtime-route-policy.service";

@Module({
  providers: [
    RuntimeRoutePolicyService,
    {
      provide: runtimeRoutePolicyRepositoryToken,
      useFactory: () => {
        if (process.env.NODE_ENV === "test" || process.env.VITEST !== undefined) {
          return new InMemoryRuntimeRoutePolicyRepository();
        }

        return new FileRuntimeRoutePolicyRepository(
          process.env.ZARA_RUNTIME_ROUTE_POLICY_STATE_DIR ?? ".zara/runtime-route-policy",
        );
      },
    },
  ],
  exports: [RuntimeRoutePolicyService],
})
export class RuntimeRoutePolicyModule {}
