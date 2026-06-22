import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from "@nestjs/common";

import {
  TenantAuth,
  type TenantAuthContext,
  TenantOrganizationGuard,
  withTenantActor,
} from "../auth/tenant-auth";
import { IntegrationsService } from "./integrations.service";
import type {
  CheckIntegrationConnectionHealthRequest,
  ConfigureFreshdeskApiTokenRequest,
  ConfigureSlackDestinationsRequest,
  ConfigureZendeskApiTokenRequest,
  CreateWebhookHttpToolRequest,
  DeleteIntegrationConnectionRequest,
  ExecuteConnectorToolRequest,
  GrantToolPermissionRequest,
  IntegrationProvider,
  PromoteIntegrationConnectionRequest,
  RevokeIntegrationConnectionRequest,
  StartOAuthConnectRequest,
} from "./integrations.models";
import { ConnectorToolsService } from "./connector-tools.service";
import { ProviderRegistryService } from "./provider-registry.service";
import { ToolPermissionGrantsService } from "./tool-permission-grants.service";
import { WebhookHttpToolsService } from "./webhook-http-tools.service";

@Controller()
export class IntegrationsController {
  constructor(
    private readonly integrationsService: IntegrationsService,
    private readonly toolPermissionGrantsService: ToolPermissionGrantsService,
    private readonly webhookHttpToolsService: WebhookHttpToolsService,
    private readonly connectorToolsService: ConnectorToolsService,
    private readonly providerRegistryService: ProviderRegistryService,
  ) {}

  @Get("organizations/:organizationId/integrations/catalog")
  @UseGuards(TenantOrganizationGuard)
  listProviderCatalog(@Param("organizationId") organizationId: string) {
    void organizationId;

    return {
      catalog: this.providerRegistryService.listCatalog(),
    };
  }

  @Get("organizations/:organizationId/integrations/catalog/:provider")
  @UseGuards(TenantOrganizationGuard)
  getProviderCatalog(
    @Param("organizationId") organizationId: string,
    @Param("provider") provider: string,
  ) {
    void organizationId;

    return {
      provider: this.providerRegistryService.getProviderCatalog(provider),
    };
  }

  @Post("organizations/:organizationId/integrations/:provider/connect")
  @UseGuards(TenantOrganizationGuard)
  async startOAuthConnect(
    @Param("organizationId") organizationId: string,
    @Param("provider") provider: IntegrationProvider,
    @Body() body: StartOAuthConnectRequest,
    @TenantAuth() tenantAuth: TenantAuthContext,
  ) {
    return {
      connect: await this.integrationsService.startOAuthConnect(
        organizationId,
        provider,
        withTenantActor(body, tenantAuth),
      ),
    };
  }

  @Post("organizations/:organizationId/integrations/zendesk/configure")
  @UseGuards(TenantOrganizationGuard)
  async configureZendeskApiToken(
    @Param("organizationId") organizationId: string,
    @Body() body: ConfigureZendeskApiTokenRequest,
    @TenantAuth() tenantAuth: TenantAuthContext,
  ) {
    return {
      connection: await this.integrationsService.configureZendeskApiToken(
        organizationId,
        withTenantActor(body, tenantAuth),
      ),
    };
  }

  @Post("organizations/:organizationId/integrations/freshdesk/configure")
  @UseGuards(TenantOrganizationGuard)
  async configureFreshdeskApiToken(
    @Param("organizationId") organizationId: string,
    @Body() body: ConfigureFreshdeskApiTokenRequest,
    @TenantAuth() tenantAuth: TenantAuthContext,
  ) {
    return {
      connection: await this.integrationsService.configureFreshdeskApiToken(
        organizationId,
        withTenantActor(body, tenantAuth),
      ),
    };
  }

  @Post("organizations/:organizationId/integrations/slack/destinations")
  @UseGuards(TenantOrganizationGuard)
  async configureSlackDestinations(
    @Param("organizationId") organizationId: string,
    @Body() body: ConfigureSlackDestinationsRequest,
    @TenantAuth() tenantAuth: TenantAuthContext,
  ) {
    return {
      destinations: await this.integrationsService.configureSlackDestinations(
        organizationId,
        withTenantActor(body, tenantAuth),
      ),
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
  @UseGuards(TenantOrganizationGuard)
  async listConnections(
    @Param("organizationId") organizationId: string,
    @Query("workspaceId") workspaceId?: string | undefined,
  ) {
    return {
      connections: await this.integrationsService.listConnections(organizationId, {
        ...(workspaceId !== undefined ? { workspaceId } : {}),
      }),
    };
  }

  @Post("organizations/:organizationId/integrations/connections/:connectionId/health-check")
  @UseGuards(TenantOrganizationGuard)
  async checkConnectionHealth(
    @Param("organizationId") organizationId: string,
    @Param("connectionId") connectionId: string,
    @Body() body: CheckIntegrationConnectionHealthRequest,
    @TenantAuth() tenantAuth: TenantAuthContext,
  ) {
    return {
      connection: await this.integrationsService.checkConnectionHealth(
        organizationId,
        connectionId,
        withTenantActor(body, tenantAuth),
      ),
    };
  }

  @Post("organizations/:organizationId/integrations/connections/:connectionId/revoke")
  @UseGuards(TenantOrganizationGuard)
  async revokeConnection(
    @Param("organizationId") organizationId: string,
    @Param("connectionId") connectionId: string,
    @Body() body: RevokeIntegrationConnectionRequest,
    @TenantAuth() tenantAuth: TenantAuthContext,
  ) {
    return {
      connection: await this.integrationsService.revokeConnection(
        organizationId,
        connectionId,
        withTenantActor(body, tenantAuth),
      ),
    };
  }

  @Delete("organizations/:organizationId/integrations/connections/:connectionId")
  @UseGuards(TenantOrganizationGuard)
  async deleteConnection(
    @Param("organizationId") organizationId: string,
    @Param("connectionId") connectionId: string,
    @Body() body: DeleteIntegrationConnectionRequest,
    @TenantAuth() tenantAuth: TenantAuthContext,
  ) {
    return {
      deleted: await this.integrationsService.deleteConnection(
        organizationId,
        connectionId,
        withTenantActor(body, tenantAuth),
      ),
    };
  }

  @Post("organizations/:organizationId/integrations/connections/:connectionId/promote")
  @UseGuards(TenantOrganizationGuard)
  async promoteConnectionToOrganization(
    @Param("organizationId") organizationId: string,
    @Param("connectionId") connectionId: string,
    @Body() body: PromoteIntegrationConnectionRequest,
    @TenantAuth() tenantAuth: TenantAuthContext,
  ) {
    return {
      connection: await this.integrationsService.promoteConnectionToOrganization(
        organizationId,
        connectionId,
        withTenantActor(body, tenantAuth),
      ),
    };
  }

  @Post("organizations/:organizationId/integrations/tool-grants")
  @UseGuards(TenantOrganizationGuard)
  async grantToolPermission(
    @Param("organizationId") organizationId: string,
    @Body() body: GrantToolPermissionRequest,
    @TenantAuth() tenantAuth: TenantAuthContext,
  ) {
    return {
      grant: await this.toolPermissionGrantsService.grantToolPermission(
        organizationId,
        withTenantActor(body, tenantAuth),
      ),
    };
  }

  @Get("organizations/:organizationId/integrations/tool-grants")
  @UseGuards(TenantOrganizationGuard)
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
  @UseGuards(TenantOrganizationGuard)
  async createWebhookTool(
    @Param("organizationId") organizationId: string,
    @Body() body: CreateWebhookHttpToolRequest,
    @TenantAuth() tenantAuth: TenantAuthContext,
  ) {
    return {
      webhookTool: await this.webhookHttpToolsService.createWebhookTool(
        organizationId,
        withTenantActor(body, tenantAuth),
      ),
    };
  }

  @Get("organizations/:organizationId/integrations/webhook-tools")
  @UseGuards(TenantOrganizationGuard)
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
  @UseGuards(TenantOrganizationGuard)
  listConnectorTools(
    @Param("provider") provider: Exclude<IntegrationProvider, "webhook-http">,
  ) {
    return {
      tools: this.connectorToolsService.listTools(provider),
    };
  }

  @Post("organizations/:organizationId/integrations/connectors/:provider/tools/:toolId/execute")
  @UseGuards(TenantOrganizationGuard)
  async executeConnectorTool(
    @Param("organizationId") organizationId: string,
    @Param("provider") provider: Exclude<IntegrationProvider, "webhook-http">,
    @Param("toolId") toolId: string,
    @Body() body: ExecuteConnectorToolRequest,
    @TenantAuth() tenantAuth: TenantAuthContext,
  ) {
    return {
      result: await this.connectorToolsService.executeTool(
        organizationId,
        provider,
        toolId,
        withTenantActor(body, tenantAuth),
      ),
    };
  }
}
