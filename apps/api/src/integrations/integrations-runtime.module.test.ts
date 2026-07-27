import { MODULE_METADATA } from "@nestjs/common/constants";
import { describe, expect, it } from "vitest";

import { IntegrationsRuntimeModule } from "./integrations-runtime.module";
import { ToolPermissionGrantsService } from "./tool-permission-grants.service";

describe("IntegrationsRuntimeModule", () => {
  it("exports runtime integration providers without mounting controllers", () => {
    expect(
      Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, IntegrationsRuntimeModule),
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(MODULE_METADATA.EXPORTS, IntegrationsRuntimeModule),
    ).toContain(ToolPermissionGrantsService);
  });
});
