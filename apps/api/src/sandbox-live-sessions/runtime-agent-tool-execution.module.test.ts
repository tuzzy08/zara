import { MODULE_METADATA } from "@nestjs/common/constants";
import { describe, expect, it } from "vitest";

import { IntegrationsRuntimeModule } from "../integrations/integrations-runtime.module";
import { RuntimeAgentToolExecutorService } from "./runtime-agent-tool-executor.service";
import { RuntimeAgentToolExecutionModule } from "./runtime-agent-tool-execution.module";
import { SandboxLiveSessionsModule } from "./sandbox-live-sessions.module";

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

  it("re-exports tool execution through its owning module", () => {
    const sandboxExports = Reflect.getMetadata(
      MODULE_METADATA.EXPORTS,
      SandboxLiveSessionsModule,
    );

    expect(sandboxExports).toContain(RuntimeAgentToolExecutionModule);
    expect(sandboxExports).not.toContain(RuntimeAgentToolExecutorService);
  });

  it("imports runtime integrations for sandbox-owned grant checks", () => {
    const sandboxImports = Reflect.getMetadata(
      MODULE_METADATA.IMPORTS,
      SandboxLiveSessionsModule,
    );

    expect(sandboxImports).toContain(IntegrationsRuntimeModule);
  });
});
