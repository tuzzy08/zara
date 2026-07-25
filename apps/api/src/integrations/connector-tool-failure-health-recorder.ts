import type {
  IntegrationConnectionHealth,
  IntegrationProvider,
} from "./integrations.models";
import type { IntegrationsService } from "./integrations.service";

export const CONNECTOR_TOOL_FAILURE_HEALTH_RECORDER = Symbol(
  "CONNECTOR_TOOL_FAILURE_HEALTH_RECORDER",
);

export interface ConnectorToolFailureHealthRecorder {
  recordConnectionToolFailureHealth(
    organizationId: string,
    connectionId: string,
    provider: IntegrationProvider,
    health: IntegrationConnectionHealth,
  ): void | Promise<void>;
}

const readOnlyFailureHealthRecorder: ConnectorToolFailureHealthRecorder = {
  recordConnectionToolFailureHealth: () => undefined,
};

export function createConnectorToolFailureHealthRecorder(
  env: Record<string, string | undefined>,
  integrationsService: IntegrationsService,
): ConnectorToolFailureHealthRecorder {
  return env.ZARA_PROCESS_ROLE?.trim() === "pstn-realtime-worker"
    ? readOnlyFailureHealthRecorder
    : integrationsService;
}
