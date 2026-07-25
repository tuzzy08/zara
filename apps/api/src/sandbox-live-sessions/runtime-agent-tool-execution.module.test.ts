import { MODULE_METADATA } from "@nestjs/common/constants";
import { describe, expect, it } from "vitest";

import { RuntimeAgentToolExecutorService } from "./runtime-agent-tool-executor.service";
import { RuntimeAgentToolExecutionModule } from "./runtime-agent-tool-execution.module";

describe("RuntimeAgentToolExecutionModule", () => {
  it("exports realtime tool execution without sandbox controllers or bridges", () => {
    expect(
      Reflect.getMetadata(
        MODULE_METADATA.CONTROLLERS,
        RuntimeAgentToolExecutionModule,
      ),
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(MODULE_METADATA.EXPORTS, RuntimeAgentToolExecutionModule),
    ).toContain(RuntimeAgentToolExecutorService);
  });
});
