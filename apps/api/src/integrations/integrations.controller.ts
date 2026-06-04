import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";

import { IntegrationsService } from "./integrations.service";
import type {
  CheckIntegrationConnectionHealthRequest,
  ConfigureZendeskApiTokenRequest,
  CreateWebhookHttpToolRequest,
  ExecuteConnectorToolRequest,
  GrantToolPermissionRequest,
  IntegrationProvider,
  RevokeIntegrationConnectionRequest,
  StartOAuthConnectRequest,
} from "./integrations.models";
import { ConnectorToolsService } from "./connector-tools.service";
import { ToolPermissionGrantsService } from "./tool-permission-grants.service";
import { WebhookHttpToolsService } from "./webhook-http-tools.service";

@Controller()
export class IntegrationsController {
  constructor(
    private readonly integrationsService: IntegrationsService,
    private readonly toolPermissionGrantsService: ToolPermissionGrantsService,
    private readonly webhookHttpToolsService: WebhookHttpToolsService,
    private readonly connectorToolsService: ConnectorToolsService,
  ) {}

  @Post("organizations/:organizationId/integrations/:provider/connect")
  async startOAuthConnect(
    @Param("organizationId") organizationId: string,
    @Param("provider") provider: IntegrationProvider,
    @Body() body: StartOAuthConnectRequest,
  ) {
    return {
      connect: await this.integrationsService.startOAuthConnect(organizationId, provider, body),
    };
  }

  @Post("organizations/:organizationId/integrations/zendesk/configure")
  async configureZendeskApiToken(
    @Param("organizationId") organizationId: string,
    @Body() body: ConfigureZendeskApiTokenRequest,
  ) {
    return {
      connection: await this.integrationsService.configureZendeskApiToken(organizationId, body),
    };
  }

  @Get("integrations/oauth/:provider/callback")
  async completeOAuthCallback(
    @Param("provider") provider: IntegrationProvider,
    @Query("state") state: string,
    @Query("code") code: string,
    @Query("now") now?: string | undefined,
  ) {
    return {
      connection: await this.integrationsService.completeOAuthCallback({
        provider,
        state,
        code,
        now,
      }),
    };
  }

  @Get("organizations/:organizationId/integrations/connections")
  async listConnections(@Param("organizationId") organizationId: string) {
    return {
      connections: await this.integrationsService.listConnections(organizationId),
    };
  }

  @Post("organizations/:organizationId/integrations/connections/:connectionId/health-check")
  async checkConnectionHealth(
    @Param("organizationId") organizationId: string,
    @Param("connectionId") connectionId: string,
    @Body() body: CheckIntegrationConnectionHealthRequest,
  ) {
    return {
      connection: await this.integrationsService.checkConnectionHealth(
        organizationId,
        connectionId,
        body,
      ),
    };
  }

  @Post("organizations/:organizationId/integrations/connections/:connectionId/revoke")
  async revokeConnection(
    @Param("organizationId") organizationId: string,
    @Param("connectionId") connectionId: string,
    @Body() body: RevokeIntegrationConnectionRequest,
  ) {
    return {
      connection: await this.integrationsService.revokeConnection(
        organizationId,
        connectionId,
        body,
      ),
    };
  }

  @Post("organizations/:organizationId/integrations/tool-grants")
  async grantToolPermission(
    @Param("organizationId") organizationId: string,
    @Body() body: GrantToolPermissionRequest,
  ) {
    return {
      grant: await this.toolPermissionGrantsService.grantToolPermission(organizationId, body),
    };
  }

  @Get("organizations/:organizationId/integrations/tool-grants")
  async listToolPermissionGrants(
    @Param("organizationId") organizationId: string,
    @Query("workspaceId") workspaceId?: string | undefined,
    @Query("workflowId") workflowId?: string | undefined,
  ) {
    return {
      grants: await this.toolPermissionGrantsService.listToolPermissionGrants({
        organizationId,
        ...(workspaceId !== undefined ? { workspaceId } : {}),
        ...(workflowId !== undefined ? { workflowId } : {}),
      }),
    };
  }

  @Post("organizations/:organizationId/integrations/webhook-tools")
  async createWebhookTool(
    @Param("organizationId") organizationId: string,
    @Body() body: CreateWebhookHttpToolRequest,
  ) {
    return {
      webhookTool: await this.webhookHttpToolsService.createWebhookTool(organizationId, body),
    };
  }

  @Get("organizations/:organizationId/integrations/webhook-tools")
  async listWebhookTools(
    @Param("organizationId") organizationId: string,
    @Query("workspaceId") workspaceId?: string | undefined,
  ) {
    return {
      webhookTools: await this.webhookHttpToolsService.listWebhookTools({
        organizationId,
        ...(workspaceId !== undefined ? { workspaceId } : {}),
      }),
    };
  }

  @Get("organizations/:organizationId/integrations/connectors/:provider/tools")
  listConnectorTools(
    @Param("provider") provider: Exclude<IntegrationProvider, "webhook-http">,
  ) {
    return {
      tools: this.connectorToolsService.listTools(provider),
    };
  }

  @Post("organizations/:organizationId/integrations/connectors/:provider/tools/:toolId/execute")
  async executeConnectorTool(
    @Param("organizationId") organizationId: string,
    @Param("provider") provider: Exclude<IntegrationProvider, "webhook-http">,
    @Param("toolId") toolId: string,
    @Body() body: ExecuteConnectorToolRequest,
  ) {
    return {
      result: await this.connectorToolsService.executeTool(organizationId, provider, toolId, body),
    };
  }
}
