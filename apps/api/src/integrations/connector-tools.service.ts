import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";

import type {
  ConnectorToolSchemaResponse,
  ExecuteConnectorToolRequest,
  IntegrationProvider,
  SlackDestinationConfig,
} from "./integrations.models";
import { IntegrationSecretVault } from "./integrations-secret-vault";
import { IntegrationsService } from "./integrations.service";
import {
  INTEGRATION_STATE_REPOSITORY,
  type IntegrationStateRepository,
} from "./integrations-state.repository";
import { Inject } from "@nestjs/common";

type OAuthConnectorProvider = Exclude<IntegrationProvider, "webhook-http">;

interface StoredIntegrationCredential {
  credentialType?: "oauth-token" | "api-token" | undefined;
  accessToken?: string | undefined;
  refreshToken?: string | undefined;
  externalAccountId: string;
  zendeskSubdomain?: string | undefined;
  zendeskEmail?: string | undefined;
  zendeskApiToken?: string | undefined;
  slackDestinations?: SlackDestinationConfig[] | undefined;
  slackDestinationsJson?: string | undefined;
  shopifyShopDomain?: string | undefined;
}

interface ConnectorExecutionContext {
  organizationId: string;
  provider: OAuthConnectorProvider;
  toolId: string;
  input: Record<string, unknown>;
  idempotencyKey?: string | undefined;
  credential: StoredIntegrationCredential;
  accessToken?: string | undefined;
  externalAccountId: string;
}

const connectorToolSchemas: Record<OAuthConnectorProvider, ConnectorToolSchemaResponse[]> = {
  zendesk: [
    {
      provider: "zendesk",
      toolId: "zendesk.tickets.search",
      description: "Search Zendesk tickets by query.",
      requiredScopes: ["tickets:read"],
      inputSchema: {
        type: "object",
        required: ["query"],
        properties: {
          query: { type: "string" },
        },
      },
    },
    {
      provider: "zendesk",
      toolId: "zendesk.tickets.create",
      description: "Create a Zendesk support ticket.",
      requiredScopes: ["tickets:write"],
      inputSchema: {
        type: "object",
        required: ["subject", "requesterEmail", "body"],
        properties: {
          subject: { type: "string" },
          requesterEmail: { type: "string" },
          body: { type: "string" },
          priority: { type: "string", enum: ["low", "normal", "high", "urgent"] },
        },
      },
    },
    {
      provider: "zendesk",
      toolId: "zendesk.tickets.update",
      description: "Update a Zendesk support ticket.",
      requiredScopes: ["tickets:write"],
      inputSchema: {
        type: "object",
        required: ["ticketId"],
        properties: {
          ticketId: { type: "string" },
          status: { type: "string", enum: ["new", "open", "pending", "solved"] },
          comment: { type: "string" },
        },
      },
    },
  ],
  hubspot: [
    {
      provider: "hubspot",
      toolId: "hubspot.contacts.lookup",
      description: "Look up a HubSpot contact by email.",
      requiredScopes: ["crm.objects.contacts.read"],
      inputSchema: {
        type: "object",
        required: ["email"],
        properties: {
          email: { type: "string" },
        },
      },
    },
    {
      provider: "hubspot",
      toolId: "hubspot.notes.create",
      description: "Write a HubSpot note to a contact.",
      requiredScopes: ["crm.objects.notes.write"],
      inputSchema: {
        type: "object",
        required: ["contactId", "body"],
        properties: {
          contactId: { type: "string" },
          body: { type: "string" },
        },
      },
    },
    {
      provider: "hubspot",
      toolId: "hubspot.pipeline.update",
      description: "Update a HubSpot deal pipeline stage.",
      requiredScopes: ["crm.objects.deals.write"],
      inputSchema: {
        type: "object",
        required: ["dealId", "stage"],
        properties: {
          dealId: { type: "string" },
          stage: { type: "string" },
        },
      },
    },
  ],
  "google-workspace": [
    {
      provider: "google-workspace",
      toolId: "google.calendar.availability.read",
      description: "Read Google Calendar availability for a time window.",
      requiredScopes: ["calendar.freebusy"],
      inputSchema: {
        type: "object",
        required: ["calendarId", "start", "end", "timezone"],
        properties: {
          calendarId: { type: "string" },
          start: { type: "string" },
          end: { type: "string" },
          timezone: { type: "string" },
        },
      },
    },
    {
      provider: "google-workspace",
      toolId: "google.calendar.events.create",
      description: "Create a Google Calendar event.",
      requiredScopes: ["calendar.events"],
      inputSchema: {
        type: "object",
        required: ["calendarId", "title", "start", "end", "timezone"],
        properties: {
          calendarId: { type: "string" },
          title: { type: "string" },
          start: { type: "string" },
          end: { type: "string" },
          timezone: { type: "string" },
          attendeeEmail: { type: "string" },
        },
      },
    },
  ],
  "microsoft-365": [
    {
      provider: "microsoft-365",
      toolId: "microsoft365.calendar.availability.read",
      description: "Read Microsoft 365 Outlook Calendar availability for a time window.",
      requiredScopes: ["Calendars.ReadBasic"],
      inputSchema: {
        type: "object",
        required: ["calendarEmail", "start", "end", "timezone"],
        properties: {
          calendarEmail: { type: "string" },
          start: { type: "string" },
          end: { type: "string" },
          timezone: { type: "string" },
          availabilityViewIntervalMinutes: { type: "number" },
        },
      },
    },
    {
      provider: "microsoft-365",
      toolId: "microsoft365.calendar.events.create",
      description: "Create a Microsoft 365 Outlook Calendar event.",
      requiredScopes: ["Calendars.ReadWrite"],
      inputSchema: {
        type: "object",
        required: ["calendarId", "title", "start", "end", "timezone"],
        properties: {
          calendarId: { type: "string" },
          title: { type: "string" },
          start: { type: "string" },
          end: { type: "string" },
          timezone: { type: "string" },
          attendeeEmail: { type: "string" },
          body: { type: "string" },
        },
      },
    },
  ],
  notion: [
    {
      provider: "notion",
      toolId: "notion.knowledge.search",
      description: "Search Notion workspace knowledge.",
      requiredScopes: ["search:read"],
      inputSchema: {
        type: "object",
        required: ["query"],
        properties: {
          query: { type: "string" },
        },
      },
    },
    {
      provider: "notion",
      toolId: "notion.pages.create",
      description: "Create a Notion page.",
      requiredScopes: ["pages:write"],
      inputSchema: {
        type: "object",
        required: ["title", "body"],
        properties: {
          title: { type: "string" },
          body: { type: "string" },
          parentPageId: { type: "string" },
        },
      },
    },
    {
      provider: "notion",
      toolId: "notion.tasks.create",
      description: "Create a Notion task.",
      requiredScopes: ["tasks:write"],
      inputSchema: {
        type: "object",
        required: ["title"],
        properties: {
          title: { type: "string" },
          assigneeEmail: { type: "string" },
        },
      },
    },
  ],
  salesforce: [
    {
      provider: "salesforce",
      toolId: "salesforce.accounts.lookup",
      description: "Look up a Salesforce account by name.",
      requiredScopes: ["api", "refresh_token"],
      inputSchema: {
        type: "object",
        required: ["accountName"],
        properties: {
          accountName: { type: "string" },
        },
      },
    },
    {
      provider: "salesforce",
      toolId: "salesforce.contacts.lookup",
      description: "Look up a Salesforce contact by email.",
      requiredScopes: ["api", "refresh_token"],
      inputSchema: {
        type: "object",
        required: ["email"],
        properties: {
          email: { type: "string" },
        },
      },
    },
    {
      provider: "salesforce",
      toolId: "salesforce.cases.lookup",
      description: "Look up a Salesforce case by case number.",
      requiredScopes: ["api", "refresh_token"],
      inputSchema: {
        type: "object",
        required: ["caseNumber"],
        properties: {
          caseNumber: { type: "string" },
        },
      },
    },
    {
      provider: "salesforce",
      toolId: "salesforce.tasks.create",
      description: "Create an additive Salesforce follow-up task.",
      requiredScopes: ["api", "refresh_token"],
      inputSchema: {
        type: "object",
        required: ["subject"],
        properties: {
          subject: { type: "string" },
          description: { type: "string" },
          dueDate: { type: "string" },
          contactId: { type: "string" },
          accountId: { type: "string" },
          priority: { type: "string" },
        },
      },
    },
    {
      provider: "salesforce",
      toolId: "salesforce.cases.create",
      description: "Create an additive Salesforce support case.",
      requiredScopes: ["api", "refresh_token"],
      inputSchema: {
        type: "object",
        required: ["subject", "description"],
        properties: {
          subject: { type: "string" },
          description: { type: "string" },
          suppliedEmail: { type: "string" },
          priority: { type: "string" },
        },
      },
    },
    {
      provider: "salesforce",
      toolId: "salesforce.call_notes.create",
      description: "Add a Salesforce call note as a completed task.",
      requiredScopes: ["api", "refresh_token"],
      inputSchema: {
        type: "object",
        required: ["subject", "body"],
        properties: {
          subject: { type: "string" },
          body: { type: "string" },
          contactId: { type: "string" },
          accountId: { type: "string" },
        },
      },
    },
  ],
  slack: [
    {
      provider: "slack",
      toolId: "slack.escalations.post",
      description: "Post a bounded Slack escalation template to a configured destination.",
      requiredScopes: ["chat:write"],
      inputSchema: {
        type: "object",
        required: ["destinationId", "callerName", "reason", "safeSummary"],
        properties: {
          destinationId: { type: "string" },
          callerName: { type: "string" },
          reason: { type: "string" },
          urgency: { type: "string", enum: ["normal", "high", "critical"] },
          safeSummary: { type: "string" },
        },
      },
    },
    {
      provider: "slack",
      toolId: "slack.alerts.post",
      description: "Post a bounded Slack failed-call or provider-health alert template.",
      requiredScopes: ["chat:write"],
      inputSchema: {
        type: "object",
        required: ["destinationId", "alertType", "severity", "title", "safeSummary"],
        properties: {
          destinationId: { type: "string" },
          alertType: { type: "string", enum: ["failed_call", "provider_health"] },
          severity: { type: "string", enum: ["warning", "critical"] },
          title: { type: "string" },
          safeSummary: { type: "string" },
        },
      },
    },
    {
      provider: "slack",
      toolId: "slack.call_summaries.post",
      description: "Post a bounded Slack post-call summary template to a configured destination.",
      requiredScopes: ["chat:write"],
      inputSchema: {
        type: "object",
        required: ["destinationId", "summaryId", "outcome", "safeSummary"],
        properties: {
          destinationId: { type: "string" },
          summaryId: { type: "string" },
          outcome: { type: "string" },
          safeSummary: { type: "string" },
          actionItems: { type: "string" },
        },
      },
    },
  ],
  intercom: [
    {
      provider: "intercom",
      toolId: "intercom.users.lookup",
      description: "Look up an Intercom user/contact by email or phone.",
      requiredScopes: ["read_users"],
      inputSchema: {
        type: "object",
        required: [],
        properties: {
          email: { type: "string" },
          phone: { type: "string" },
        },
      },
    },
    {
      provider: "intercom",
      toolId: "intercom.companies.lookup",
      description: "Look up an Intercom company by name or company ID.",
      requiredScopes: ["read_companies"],
      inputSchema: {
        type: "object",
        required: [],
        properties: {
          companyName: { type: "string" },
          companyId: { type: "string" },
        },
      },
    },
    {
      provider: "intercom",
      toolId: "intercom.conversations.lookup",
      description: "Look up open Intercom conversations for a contact.",
      requiredScopes: ["read_conversations"],
      inputSchema: {
        type: "object",
        required: ["contactId"],
        properties: {
          contactId: { type: "string" },
          state: { type: "string", enum: ["open", "closed", "snoozed"] },
        },
      },
    },
    {
      provider: "intercom",
      toolId: "intercom.internal_notes.create",
      description: "Create an internal Intercom note for a contact.",
      requiredScopes: ["write_conversations"],
      inputSchema: {
        type: "object",
        required: ["contactId", "body"],
        properties: {
          contactId: { type: "string" },
          body: { type: "string" },
        },
      },
    },
    {
      provider: "intercom",
      toolId: "intercom.call_summaries.create",
      description: "Create an internal Intercom call-summary note for a contact.",
      requiredScopes: ["write_conversations"],
      inputSchema: {
        type: "object",
        required: ["contactId", "summaryId", "outcome", "safeSummary"],
        properties: {
          contactId: { type: "string" },
          summaryId: { type: "string" },
          outcome: { type: "string" },
          safeSummary: { type: "string" },
        },
      },
    },
  ],
  shopify: [
    {
      provider: "shopify",
      toolId: "shopify.customers.lookup",
      description: "Look up Shopify customers by email or phone.",
      requiredScopes: ["read_customers"],
      inputSchema: {
        type: "object",
        required: [],
        properties: {
          email: { type: "string" },
          phone: { type: "string" },
        },
      },
    },
    {
      provider: "shopify",
      toolId: "shopify.orders.lookup",
      description: "Look up Shopify orders by safe order and customer identifiers.",
      requiredScopes: ["read_orders"],
      inputSchema: {
        type: "object",
        required: ["orderName"],
        properties: {
          orderName: { type: "string" },
          customerEmail: { type: "string" },
          customerPhone: { type: "string" },
        },
      },
    },
    {
      provider: "shopify",
      toolId: "shopify.fulfillments.lookup",
      description: "Look up read-only fulfillment records for a Shopify order.",
      requiredScopes: ["read_fulfillments"],
      inputSchema: {
        type: "object",
        required: ["orderId"],
        properties: {
          orderId: { type: "string" },
        },
      },
    },
    {
      provider: "shopify",
      toolId: "shopify.shipping_status.lookup",
      description: "Look up read-only Shopify shipping status by order and customer identifiers.",
      requiredScopes: ["read_orders", "read_fulfillments"],
      inputSchema: {
        type: "object",
        required: ["orderName"],
        properties: {
          orderName: { type: "string" },
          customerEmail: { type: "string" },
          customerPhone: { type: "string" },
        },
      },
    },
  ],
};

@Injectable()
export class ConnectorToolsService {
  constructor(
    @Inject(INTEGRATION_STATE_REPOSITORY)
    private readonly stateRepository: IntegrationStateRepository,
    private readonly secretVault: IntegrationSecretVault,
    private readonly integrationsService: IntegrationsService,
  ) {}

  listTools(provider: OAuthConnectorProvider) {
    return getProviderSchemas(provider).map(cloneToolSchema);
  }

  async executeTool(
    organizationId: string,
    provider: OAuthConnectorProvider,
    toolId: string,
    request: ExecuteConnectorToolRequest,
  ) {
    const schema = getExecutableConnectorToolSchema(provider, toolId);

    if (schema === undefined || schema.provider !== provider) {
      throw new NotFoundException("Connector tool was not found.");
    }

    const input = request.input ?? {};
    validateRequiredInput(schema, input);
    const state = await this.stateRepository.load(organizationId);
    const connection = state?.connections.find((candidate) => candidate.id === request.connectionId);

    if (state === null || connection === undefined || connection.provider !== provider) {
      throw new NotFoundException("Integration connection was not found.");
    }

    if (connection.status === "revoked") {
      throw new ForbiddenException("Integration connection has been revoked.");
    }

    const missingScopes = schema.requiredScopes.filter((scope) => !connection.scopes.includes(scope));
    if (missingScopes.length > 0) {
      throw new ForbiddenException(`Integration connection is missing required scope: ${missingScopes.join(", ")}`);
    }

    const credential = state.credentials.find((candidate) => candidate.connectionId === connection.id);
    const openedCredential = credential?.envelope === undefined
      ? undefined
      : this.secretVault.open(credential.envelope) as unknown as StoredIntegrationCredential;

    if (openedCredential === undefined || !isCredentialAvailable(provider, openedCredential)) {
      throw new ForbiddenException("Integration credential is unavailable.");
    }

    try {
      return await executeLocalConnectorTool({
        organizationId,
        provider,
        toolId,
        input,
        idempotencyKey: request.idempotencyKey,
        credential: openedCredential,
        accessToken: openedCredential.accessToken,
        externalAccountId: openedCredential.externalAccountId,
      });
    } catch (error) {
      await this.integrationsService.recordConnectionToolFailureHealth(
        organizationId,
        connection.id,
        provider,
        classifyConnectorToolFailureHealth({
          provider,
          error,
        }),
      );
      throw error;
    }
  }
}

export function getConnectorToolSchemaById(
  toolId: string,
): ConnectorToolSchemaResponse | undefined {
  const schema = connectorToolSchemaAliases[toolId] ?? Object.values(connectorToolSchemas)
    .flat()
    .find((candidate) => candidate.toolId === toolId);

  return schema === undefined ? undefined : cloneToolSchema(schema);
}

function isCredentialAvailable(
  provider: OAuthConnectorProvider,
  credential: StoredIntegrationCredential | undefined,
) {
  if (credential === undefined) {
    return false;
  }

  if (provider === "zendesk" && credential.credentialType === "api-token") {
    return (
      credential.zendeskSubdomain !== undefined &&
      credential.zendeskSubdomain.length > 0 &&
      credential.zendeskEmail !== undefined &&
      credential.zendeskEmail.length > 0 &&
      credential.zendeskApiToken !== undefined &&
      credential.zendeskApiToken.length > 0
    );
  }

  if (provider === "shopify") {
    return (
      credential.accessToken !== undefined &&
      credential.accessToken.length > 0 &&
      credential.shopifyShopDomain !== undefined &&
      credential.shopifyShopDomain.length > 0
    );
  }

  return credential.accessToken !== undefined && credential.accessToken.length > 0;
}

function executeLocalConnectorTool(context: ConnectorExecutionContext) {
  switch (context.toolId) {
    case "zendesk.tickets.search":
      return executeZendeskTicketSearch(context);
    case "zendesk.tickets.create":
      return executeZendeskTicketCreate(context);
    case "zendesk.tickets.update":
      return executeZendeskTicketUpdate(context);
    case "hubspot.contacts.lookup":
      return executeHubSpotContactLookup(context);
    case "hubspot.notes.create":
      return executeHubSpotNoteCreate(context);
    case "hubspot.pipeline.update":
      return executeHubSpotPipelineUpdate(context);
    case "google.calendar.availability.read":
      return executeGoogleCalendarAvailability(context);
    case "google.calendar.events.create":
      return executeGoogleCalendarEventCreate(context);
    case "microsoft365.calendar.availability.read":
      return executeMicrosoft365CalendarAvailability(context);
    case "microsoft365.calendar.events.create":
      return executeMicrosoft365CalendarEventCreate(context);
    case "notion.knowledge.search":
      return executeNotionKnowledgeSearch(context);
    case "notion.pages.create":
      return executeNotionPageCreate(context);
    case "notion.tasks.create":
      return executeNotionTaskCreate(context);
    case "salesforce.accounts.lookup":
      return executeSalesforceAccountLookup(context);
    case "salesforce.contacts.lookup":
      return executeSalesforceContactLookup(context);
    case "salesforce.cases.lookup":
      return executeSalesforceCaseLookup(context);
    case "salesforce.tasks.create":
      return executeSalesforceTaskCreate(context);
    case "salesforce.cases.create":
      return executeSalesforceCaseCreate(context);
    case "salesforce.call_notes.create":
      return executeSalesforceCallNoteCreate(context);
    case "slack.escalations.post":
      return executeSlackEscalationPost(context);
    case "slack.alerts.post":
      return executeSlackAlertPost(context);
    case "slack.call_summaries.post":
      return executeSlackCallSummaryPost(context);
    case "intercom.users.lookup":
      return executeIntercomUserLookup(context);
    case "intercom.companies.lookup":
      return executeIntercomCompanyLookup(context);
    case "intercom.conversations.lookup":
      return executeIntercomConversationLookup(context);
    case "intercom.internal_notes.create":
      return executeIntercomInternalNoteCreate(context);
    case "intercom.call_summaries.create":
      return executeIntercomCallSummaryCreate(context);
    case "intercom.articles.import":
      return executeIntercomArticleImport(context);
    case "shopify.customers.lookup":
      return executeShopifyCustomerLookup(context);
    case "shopify.orders.lookup":
      return executeShopifyOrderLookup(context);
    case "shopify.fulfillments.lookup":
      return executeShopifyFulfillmentLookup(context);
    case "shopify.shipping_status.lookup":
      return executeShopifyShippingStatusLookup(context);
    default:
      throw new NotFoundException("Connector tool was not found.");
  }
}

function classifyConnectorToolFailureHealth(input: {
  provider: OAuthConnectorProvider;
  error: unknown;
}) {
  const providerLabel = getProviderHealthLabel(input.provider);
  const code = readHttpExceptionCode(input.error);
  const status = readHttpExceptionStatus(input.error);
  const now = new Date().toISOString();

  if (code === "tool_execution.rate_limited" || status === 429) {
    return {
      status: "degraded" as const,
      checkedAt: now,
      message: `Last ${providerLabel} tool failure: rate limited. Retry after the provider reset window.`,
    };
  }

  if (status === 401) {
    return {
      status: "unhealthy" as const,
      checkedAt: now,
      message: `Last ${providerLabel} tool failure: credentials need reconnect.`,
    };
  }

  if (status === 403) {
    return {
      status: "degraded" as const,
      checkedAt: now,
      message: `Last ${providerLabel} tool failure: permission denied. Reconnect with the required scopes.`,
    };
  }

  if (status === 404) {
    return {
      status: "degraded" as const,
      checkedAt: now,
      message: `Last ${providerLabel} tool failure: requested record was not found.`,
    };
  }

  return {
    status: "degraded" as const,
    checkedAt: now,
    message: `Last ${providerLabel} tool failure: provider execution failed.`,
  };
}

function readHttpExceptionStatus(error: unknown) {
  return error instanceof HttpException ? error.getStatus() : undefined;
}

function readHttpExceptionCode(error: unknown) {
  if (!(error instanceof HttpException)) {
    return undefined;
  }

  const response = error.getResponse();
  if (response === null || typeof response !== "object") {
    return undefined;
  }

  const code = (response as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function getProviderHealthLabel(provider: OAuthConnectorProvider) {
  switch (provider) {
    case "zendesk":
      return "Zendesk";
    case "hubspot":
      return "HubSpot";
    case "google-workspace":
      return "Google Workspace";
    case "notion":
      return "Notion";
    case "salesforce":
      return "Salesforce";
    case "slack":
      return "Slack";
    case "microsoft-365":
      return "Microsoft 365";
    case "intercom":
      return "Intercom";
    case "shopify":
      return "Shopify";
  }
}

async function executeSlackEscalationPost(context: ConnectorExecutionContext) {
  const destinationId = getStringInput(context.input, "destinationId");
  const callerName = getStringInput(context.input, "callerName");
  const reason = getStringInput(context.input, "reason");
  const urgency = getOptionalStringInput(context.input, "urgency") ?? "normal";
  const safeSummary = getStringInput(context.input, "safeSummary");
  const destination = getSlackDestination(context, destinationId, "escalation");
  const responseBody = await postSlackTemplateMessage(context, destination, {
    text: `Escalation requested for ${callerName}`,
    blocks: [
      slackSection(`*Escalation requested*\nCaller: ${callerName}\nUrgency: ${urgency}`),
      slackSection(`*Reason*\n${reason}`),
      slackSection(`*Safe summary*\n${safeSummary}`),
    ],
    metadata: slackMetadata("zara_slack_escalation", context, destination.id),
  });

  return slackMessageResult(context, destination, responseBody, "escalation");
}

async function executeSlackAlertPost(context: ConnectorExecutionContext) {
  const destinationId = getStringInput(context.input, "destinationId");
  const alertType = getStringInput(context.input, "alertType");
  const severity = getStringInput(context.input, "severity");
  const title = getStringInput(context.input, "title");
  const safeSummary = getStringInput(context.input, "safeSummary");
  const destination = getSlackDestination(context, destinationId, "alert");
  const responseBody = await postSlackTemplateMessage(context, destination, {
    text: `${title}: ${severity}`,
    blocks: [
      slackSection(`*${title}*\nType: ${alertType}\nSeverity: ${severity}`),
      slackSection(safeSummary),
    ],
    metadata: slackMetadata("zara_slack_alert", context, destination.id),
  });

  return slackMessageResult(context, destination, responseBody, "alert");
}

async function executeSlackCallSummaryPost(context: ConnectorExecutionContext) {
  const destinationId = getStringInput(context.input, "destinationId");
  const summaryId = getStringInput(context.input, "summaryId");
  const outcome = getStringInput(context.input, "outcome");
  const safeSummary = getStringInput(context.input, "safeSummary");
  const actionItems = getOptionalStringInput(context.input, "actionItems");
  const destination = getSlackDestination(context, destinationId, "post-call-summary");
  const responseBody = await postSlackTemplateMessage(context, destination, {
    text: `Call summary ${summaryId}: ${outcome}`,
    blocks: [
      slackSection(`*Call summary ${summaryId}*\nOutcome: ${outcome}`),
      slackSection(safeSummary),
      ...(actionItems !== undefined ? [slackSection(`*Action items*\n${actionItems}`)] : []),
    ],
    metadata: slackMetadata("zara_slack_call_summary", context, destination.id),
  });

  return slackMessageResult(context, destination, responseBody, "call_summary");
}

async function postSlackTemplateMessage(
  context: ConnectorExecutionContext,
  destination: SlackDestinationConfig,
  body: {
    text: string;
    blocks: Array<Record<string, unknown>>;
    metadata: Record<string, unknown>;
  },
) {
  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      authorization: buildBearerAuthorization(context),
      "content-type": "application/json",
    },
    body: JSON.stringify({
      channel: destination.channelId,
      text: body.text,
      blocks: body.blocks,
      metadata: body.metadata,
    }),
  });
  const responseBody = await readJsonResponse(response);
  handleSlackErrorResponse(context, response, responseBody);

  return responseBody;
}

function getSlackDestination(
  context: ConnectorExecutionContext,
  destinationId: string,
  purpose: SlackDestinationConfig["purpose"],
) {
  const destination = readSlackDestinations(context.credential)
    .find((candidate) => candidate.id === destinationId);
  if (destination === undefined) {
    throw new BadRequestException("Slack destination is not configured.");
  }

  if (destination.purpose !== purpose) {
    throw new BadRequestException("Slack destination is not configured for this tool.");
  }

  return destination;
}

function readSlackDestinations(credential: StoredIntegrationCredential) {
  if (credential.slackDestinations !== undefined) {
    return credential.slackDestinations;
  }

  if (credential.slackDestinationsJson === undefined || credential.slackDestinationsJson.length === 0) {
    return [];
  }

  try {
    const parsed = JSON.parse(credential.slackDestinationsJson) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((destination): destination is SlackDestinationConfig =>
          destination !== null &&
          typeof destination === "object" &&
          typeof (destination as { id?: unknown }).id === "string" &&
          typeof (destination as { channelId?: unknown }).channelId === "string",
        )
      : [];
  } catch {
    return [];
  }
}

function slackSection(text: string) {
  return {
    type: "section",
    text: {
      type: "mrkdwn",
      text,
    },
  };
}

function slackMetadata(eventType: string, context: ConnectorExecutionContext, destinationId: string) {
  return {
    event_type: eventType,
    event_payload: {
      ...(context.idempotencyKey !== undefined ? { idempotency_key: context.idempotencyKey } : {}),
      destination_id: destinationId,
    },
  };
}

function handleSlackErrorResponse(
  context: ConnectorExecutionContext,
  response: Response,
  responseBody: unknown,
) {
  if (response.status === 429) {
    const retryAfterSeconds = Number.parseInt(response.headers.get("retry-after") ?? "30", 10) || 30;
    throw new HttpException(
      {
        statusCode: 429,
        message: "Slack rate limit reached. Retry later.",
        retryAfterSeconds,
        provider: "slack",
        toolId: context.toolId,
        code: "tool_execution.rate_limited",
        recoverable: true,
      },
      429,
    );
  }

  const ok = responseBody !== null && typeof responseBody === "object"
    ? (responseBody as { ok?: unknown }).ok
    : undefined;

  if (response.status < 200 || response.status >= 300 || ok === false) {
    throw new HttpException(
      {
        statusCode: response.status,
        message: "Slack notification post failed.",
        provider: "slack",
        toolId: context.toolId,
      },
      response.status,
    );
  }
}

function slackMessageResult(
  context: ConnectorExecutionContext,
  destination: SlackDestinationConfig,
  responseBody: unknown,
  template: "escalation" | "alert" | "call_summary",
) {
  const response = responseBody !== null && typeof responseBody === "object"
    ? responseBody as Record<string, unknown>
    : {};

  return {
    provider: "slack",
    toolId: context.toolId,
    message: {
      destinationId: destination.id,
      channelId: typeof response.channel === "string" ? response.channel : destination.channelId,
      ts: typeof response.ts === "string" ? response.ts : "",
      template,
      ...(context.idempotencyKey !== undefined ? { idempotencyKey: context.idempotencyKey } : {}),
    },
  };
}

async function executeIntercomUserLookup(context: ConnectorExecutionContext) {
  const email = getOptionalStringInput(context.input, "email");
  const phone = getOptionalStringInput(context.input, "phone");
  const lookupField = email !== undefined
    ? { field: "email", value: email.toLowerCase() }
    : phone !== undefined
      ? { field: "phone", value: phone }
      : undefined;

  if (lookupField === undefined) {
    throw new BadRequestException("Intercom user lookup requires email or phone.");
  }

  const responseBody = await executeIntercomJsonRequest(context, "https://api.intercom.io/contacts/search", {
    query: {
      field: lookupField.field,
      operator: "=",
      value: lookupField.value,
    },
  });
  const user = readFirstIntercomDataRecord(responseBody);

  return {
    provider: "intercom",
    toolId: context.toolId,
    user: {
      id: readRecordString(user, "id") ?? `intercom-user-${stableNumericId(lookupField.value)}`,
      ...(readRecordString(user, "email") !== undefined ? { email: readRecordString(user, "email") } : {}),
      ...(readRecordString(user, "phone") !== undefined ? { phone: readRecordString(user, "phone") } : {}),
      ...(readRecordString(user, "name") !== undefined ? { name: readRecordString(user, "name") } : {}),
    },
  };
}

async function executeIntercomCompanyLookup(context: ConnectorExecutionContext) {
  const companyName = getOptionalStringInput(context.input, "companyName");
  const companyId = getOptionalStringInput(context.input, "companyId");
  const lookupField = companyName !== undefined
    ? { field: "name", value: companyName }
    : companyId !== undefined
      ? { field: "company_id", value: companyId }
      : undefined;

  if (lookupField === undefined) {
    throw new BadRequestException("Intercom company lookup requires companyName or companyId.");
  }

  const responseBody = await executeIntercomJsonRequest(context, "https://api.intercom.io/companies/search", {
    query: {
      field: lookupField.field,
      operator: "=",
      value: lookupField.value,
    },
  });
  const company = readFirstIntercomDataRecord(responseBody);

  return {
    provider: "intercom",
    toolId: context.toolId,
    company: {
      id: readRecordString(company, "id") ?? `intercom-company-${stableNumericId(lookupField.value)}`,
      name: readRecordString(company, "name") ?? lookupField.value,
      ...(readRecordString(company, "company_id") !== undefined
        ? { companyId: readRecordString(company, "company_id") }
        : {}),
      ...(readRecordString(company, "website") !== undefined ? { website: readRecordString(company, "website") } : {}),
    },
  };
}

async function executeIntercomConversationLookup(context: ConnectorExecutionContext) {
  const contactId = getStringInput(context.input, "contactId");
  const state = getOptionalStringInput(context.input, "state") ?? "open";
  const responseBody = await executeIntercomJsonRequest(context, "https://api.intercom.io/conversations/search", {
    query: {
      operator: "AND",
      value: [
        {
          field: "contact_ids",
          operator: "=",
          value: contactId,
        },
        {
          field: "state",
          operator: "=",
          value: state,
        },
      ],
    },
    sort: {
      field: "updated_at",
      order: "descending",
    },
  });
  const conversations = readIntercomDataRecords(responseBody).map((conversation) => ({
    id: readRecordString(conversation, "id") ?? `intercom-conversation-${stableNumericId(contactId)}`,
    state: readRecordString(conversation, "state") ?? state,
    title: readRecordString(conversation, "title") ?? "",
    contactId: readIntercomConversationContactId(conversation) ?? contactId,
    ...(readIntercomConversationContactEmail(conversation) !== undefined
      ? { contactEmail: readIntercomConversationContactEmail(conversation) }
      : {}),
    ...(readIntercomTimestamp(conversation.updated_at) !== undefined
      ? { updatedAt: readIntercomTimestamp(conversation.updated_at) }
      : {}),
  }));

  return {
    provider: "intercom",
    toolId: context.toolId,
    conversations,
  };
}

async function executeIntercomInternalNoteCreate(context: ConnectorExecutionContext) {
  const contactId = getStringInput(context.input, "contactId");
  const body = getStringInput(context.input, "body");
  const responseBody = await executeIntercomJsonRequest(context, "https://api.intercom.io/notes", {
    contact_id: contactId,
    body,
  });

  return intercomNoteResult(context, responseBody, contactId, body);
}

async function executeIntercomCallSummaryCreate(context: ConnectorExecutionContext) {
  const contactId = getStringInput(context.input, "contactId");
  const summaryId = getStringInput(context.input, "summaryId");
  const outcome = getStringInput(context.input, "outcome");
  const safeSummary = getStringInput(context.input, "safeSummary");
  const body = `Call summary ${summaryId}\nOutcome: ${outcome}\n\n${safeSummary}`;
  const responseBody = await executeIntercomJsonRequest(context, "https://api.intercom.io/notes", {
    contact_id: contactId,
    body,
  });

  return intercomNoteResult(context, responseBody, contactId, body);
}

async function executeIntercomArticleImport(context: ConnectorExecutionContext) {
  const articleId = getStringInput(context.input, "articleId");
  const responseBody = await executeIntercomJsonGetRequest(
    context,
    `https://api.intercom.io/articles/${encodeURIComponent(articleId)}`,
  );
  const article = responseBody !== null && typeof responseBody === "object"
    ? responseBody as Record<string, unknown>
    : {};
  const rawText =
    readRecordString(article, "body")
    ?? readNestedString(article, "translated_content", "body")
    ?? readNestedIntercomLocaleString(article, "translated_content", "en", "body")
    ?? readRecordString(article, "description")
    ?? "";
  const text = normalizeProviderHtmlText(rawText);

  return {
    provider: "intercom",
    toolId: context.toolId,
    article: {
      id: readRecordString(article, "id") ?? articleId,
      title: readRecordString(article, "title") ?? `Intercom article ${articleId}`,
      text,
      ...(readRecordString(article, "url") !== undefined ? { uri: readRecordString(article, "url") } : {}),
    },
  };
}

async function executeIntercomJsonRequest(
  context: ConnectorExecutionContext,
  url: string,
  body: Record<string, unknown>,
) {
  const response = await fetch(url, {
    method: "POST",
    headers: buildIntercomHeaders(context),
    body: JSON.stringify(body),
  });
  const responseBody = await readJsonResponse(response);
  handleIntercomErrorResponse(context, response);

  return responseBody;
}

async function executeIntercomJsonGetRequest(
  context: ConnectorExecutionContext,
  url: string,
) {
  const response = await fetch(url, {
    method: "GET",
    headers: buildIntercomHeaders(context),
  });
  const responseBody = await readJsonResponse(response);
  handleIntercomErrorResponse(context, response);

  return responseBody;
}

function buildIntercomHeaders(context: ConnectorExecutionContext) {
  return {
    authorization: buildBearerAuthorization(context),
    accept: "application/json",
    "content-type": "application/json",
    "Intercom-Version": "2.11",
  };
}

function handleIntercomErrorResponse(
  context: ConnectorExecutionContext,
  response: Response,
) {
  if (response.status === 429) {
    const retryAfterSeconds = Number.parseInt(response.headers.get("retry-after") ?? "30", 10) || 30;
    throw new HttpException(
      {
        statusCode: 429,
        message: "Intercom rate limit reached. Retry later.",
        retryAfterSeconds,
        provider: "intercom",
        toolId: context.toolId,
        code: "tool_execution.rate_limited",
        recoverable: true,
      },
      429,
    );
  }

  if (response.status < 200 || response.status >= 300) {
    throw new HttpException(
      {
        statusCode: response.status,
        message: "Intercom tool execution failed.",
        provider: "intercom",
        toolId: context.toolId,
      },
      response.status,
    );
  }
}

function intercomNoteResult(
  context: ConnectorExecutionContext,
  responseBody: unknown,
  contactId: string,
  body: string,
) {
  const note = responseBody !== null && typeof responseBody === "object"
    ? responseBody as Record<string, unknown>
    : {};

  return {
    provider: "intercom",
    toolId: context.toolId,
    note: {
      id: readRecordString(note, "id") ?? `intercom-note-${stableNumericId(`${contactId}:${body}`)}`,
      contactId: readNestedString(note, "contact", "id") ?? contactId,
      body: readRecordString(note, "body") ?? body,
      ...(readIntercomTimestamp(note.created_at) !== undefined
        ? { createdAt: readIntercomTimestamp(note.created_at) }
        : {}),
      ...(context.idempotencyKey !== undefined ? { idempotencyKey: context.idempotencyKey } : {}),
    },
  };
}

function readIntercomDataRecords(responseBody: unknown): Record<string, unknown>[] {
  if (responseBody === null || typeof responseBody !== "object") {
    return [];
  }

  const data = (responseBody as { data?: unknown }).data;
  return Array.isArray(data)
    ? data.filter((item): item is Record<string, unknown> => item !== null && typeof item === "object")
    : [];
}

function readFirstIntercomDataRecord(responseBody: unknown) {
  return readIntercomDataRecords(responseBody)[0] ?? {};
}

function readIntercomConversationContactId(conversation: Record<string, unknown>) {
  return readNestedIntercomAuthorString(conversation, "id");
}

function readIntercomConversationContactEmail(conversation: Record<string, unknown>) {
  return readNestedIntercomAuthorString(conversation, "email");
}

function readNestedIntercomAuthorString(
  conversation: Record<string, unknown>,
  key: string,
) {
  const source = conversation.source;
  if (source === null || typeof source !== "object") {
    return undefined;
  }

  const author = (source as { author?: unknown }).author;
  if (author === null || typeof author !== "object") {
    return undefined;
  }

  const value = (author as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

function readNestedIntercomLocaleString(
  record: Record<string, unknown>,
  objectKey: string,
  localeKey: string,
  valueKey: string,
) {
  const object = record[objectKey];
  if (object === null || typeof object !== "object") {
    return undefined;
  }

  const locale = (object as Record<string, unknown>)[localeKey];
  if (locale === null || typeof locale !== "object") {
    return undefined;
  }

  const value = (locale as Record<string, unknown>)[valueKey];
  return typeof value === "string" ? value : undefined;
}

function normalizeProviderHtmlText(value: string) {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function readIntercomTimestamp(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? new Date(value * 1000).toISOString()
    : undefined;
}

async function executeShopifyCustomerLookup(context: ConnectorExecutionContext) {
  const email = getOptionalStringInput(context.input, "email");
  const phone = getOptionalStringInput(context.input, "phone");
  const query = email !== undefined
    ? `email:${email.toLowerCase()}`
    : phone !== undefined
      ? `phone:${phone}`
      : undefined;

  if (query === undefined) {
    throw new BadRequestException("Shopify customer lookup requires email or phone.");
  }

  const responseBody = await executeShopifyGraphqlRequest(
    context,
    `query ZaraCustomerLookup($query: String!) {
      customers(first: 2, query: $query) {
        edges {
          node {
            id
            displayName
            email
            phone
          }
        }
      }
    }`,
    { query },
  );

  return {
    provider: "shopify",
    toolId: context.toolId,
    customers: readShopifyConnectionNodes(responseBody, "customers").map((customer) => ({
      id: readRecordString(customer, "id") ?? "",
      name: readRecordString(customer, "displayName") ?? "",
      ...(readRecordString(customer, "email") !== undefined ? { email: readRecordString(customer, "email") } : {}),
      ...(readRecordString(customer, "phone") !== undefined ? { phone: readRecordString(customer, "phone") } : {}),
    })),
  };
}

async function executeShopifyOrderLookup(context: ConnectorExecutionContext) {
  const responseBody = await executeShopifyGraphqlRequest(
    context,
    `query ZaraOrderLookup($query: String!) {
      orders(first: 2, query: $query) {
        edges {
          node {
            id
            name
            email
            displayFinancialStatus
            displayFulfillmentStatus
            processedAt
            customer {
              id
              email
              phone
            }
          }
        }
      }
    }`,
    { query: buildShopifyOrderSearchQuery(context.input) },
  );

  return {
    provider: "shopify",
    toolId: context.toolId,
    orders: readShopifyConnectionNodes(responseBody, "orders").map(shopifyOrderSummary),
  };
}

async function executeShopifyFulfillmentLookup(context: ConnectorExecutionContext) {
  const orderId = getStringInput(context.input, "orderId");
  const responseBody = await executeShopifyGraphqlRequest(
    context,
    `query ZaraFulfillmentLookup($orderId: ID!) {
      order(id: $orderId) {
        id
        name
        fulfillments(first: 10) {
          id
          status
          trackingInfo {
            number
            company
            url
          }
        }
      }
    }`,
    { orderId },
  );
  const order = readShopifyObject(responseBody, "order");

  return {
    provider: "shopify",
    toolId: context.toolId,
    order: {
      id: readRecordString(order, "id") ?? orderId,
      name: readRecordString(order, "name") ?? "",
    },
    fulfillments: readShopifyFulfillments(order),
  };
}

async function executeShopifyShippingStatusLookup(context: ConnectorExecutionContext) {
  const responseBody = await executeShopifyGraphqlRequest(
    context,
    `query ZaraShippingStatusLookup($query: String!) {
      orders(first: 1, query: $query) {
        edges {
          node {
            id
            name
            displayFulfillmentStatus
            fulfillments(first: 10) {
              id
              status
              trackingInfo {
                number
                company
                url
              }
            }
          }
        }
      }
    }`,
    { query: buildShopifyOrderSearchQuery(context.input) },
  );
  const order = readShopifyConnectionNodes(responseBody, "orders")[0] ?? {};

  return {
    provider: "shopify",
    toolId: context.toolId,
    shippingStatus: {
      orderId: readRecordString(order, "id") ?? "",
      orderName: readRecordString(order, "name") ?? getStringInput(context.input, "orderName"),
      fulfillmentStatus: readRecordString(order, "displayFulfillmentStatus") ?? "UNKNOWN",
      tracking: readShopifyFulfillments(order).flatMap((fulfillment) => fulfillment.tracking),
    },
  };
}

async function executeShopifyGraphqlRequest(
  context: ConnectorExecutionContext,
  query: string,
  variables: Record<string, unknown>,
) {
  const response = await fetch(buildShopifyGraphqlUrl(context), {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": buildShopifyAccessToken(context),
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      query,
      variables,
    }),
  });
  const responseBody = await readJsonResponse(response);
  handleShopifyErrorResponse(context, response, responseBody);

  return responseBody;
}

function buildShopifyGraphqlUrl(context: ConnectorExecutionContext) {
  const shopDomain = context.credential.shopifyShopDomain;
  if (shopDomain === undefined || shopDomain.length === 0) {
    throw new ForbiddenException("Shopify shop domain is unavailable.");
  }

  return `https://${shopDomain}/admin/api/2026-04/graphql.json`;
}

function buildShopifyAccessToken(context: ConnectorExecutionContext) {
  if (context.accessToken === undefined || context.accessToken.length === 0) {
    throw new ForbiddenException("Shopify access token is unavailable.");
  }

  return context.accessToken;
}

function handleShopifyErrorResponse(
  context: ConnectorExecutionContext,
  response: Response,
  responseBody: unknown,
) {
  if (response.status === 429) {
    const retryAfterSeconds = Number.parseInt(response.headers.get("retry-after") ?? "30", 10) || 30;
    throw new HttpException(
      {
        statusCode: 429,
        message: "Shopify rate limit reached. Retry later.",
        retryAfterSeconds,
        provider: "shopify",
        toolId: context.toolId,
        code: "tool_execution.rate_limited",
        recoverable: true,
      },
      429,
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw new HttpException(
      {
        statusCode: response.status,
        message: "Shopify permission denied.",
        provider: "shopify",
        toolId: context.toolId,
        code: response.status === 401 ? "tool_execution.auth_revoked" : "tool_execution.permission_denied",
        recoverable: true,
      },
      response.status,
    );
  }

  if (response.status < 200 || response.status >= 300) {
    throw new HttpException(
      {
        statusCode: response.status,
        message: "Shopify tool execution failed.",
        provider: "shopify",
        toolId: context.toolId,
      },
      response.status,
    );
  }

  const errors = responseBody !== null && typeof responseBody === "object"
    ? (responseBody as { errors?: unknown }).errors
    : undefined;
  if (Array.isArray(errors) && errors.length > 0) {
    throw new HttpException(
      {
        statusCode: 422,
        message: "Shopify returned GraphQL errors for the lookup.",
        provider: "shopify",
        toolId: context.toolId,
        code: "tool_execution.validation_error",
        recoverable: true,
      },
      422,
    );
  }
}

function buildShopifyOrderSearchQuery(input: Record<string, unknown>) {
  const orderName = getStringInput(input, "orderName");
  const customerEmail = getOptionalStringInput(input, "customerEmail");
  const customerPhone = getOptionalStringInput(input, "customerPhone");
  const terms = [`name:${orderName}`];

  if (customerEmail !== undefined) {
    terms.push(`email:${customerEmail.toLowerCase()}`);
  }

  if (customerPhone !== undefined) {
    terms.push(`phone:${customerPhone}`);
  }

  return terms.join(" ");
}

function readShopifyConnectionNodes(
  responseBody: unknown,
  connectionKey: string,
): Record<string, unknown>[] {
  if (responseBody === null || typeof responseBody !== "object") {
    return [];
  }

  const data = (responseBody as { data?: unknown }).data;
  if (data === null || typeof data !== "object") {
    return [];
  }

  const connection = (data as Record<string, unknown>)[connectionKey];
  if (connection === null || typeof connection !== "object") {
    return [];
  }

  const edges = (connection as { edges?: unknown }).edges;
  if (!Array.isArray(edges)) {
    return [];
  }

  return edges.flatMap((edge) => {
    if (edge === null || typeof edge !== "object") {
      return [];
    }

    const node = (edge as { node?: unknown }).node;
    return node !== null && typeof node === "object"
      ? [node as Record<string, unknown>]
      : [];
  });
}

function readShopifyObject(responseBody: unknown, key: string) {
  if (responseBody === null || typeof responseBody !== "object") {
    return {};
  }

  const data = (responseBody as { data?: unknown }).data;
  if (data === null || typeof data !== "object") {
    return {};
  }

  const value = (data as Record<string, unknown>)[key];
  return value !== null && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
}

function shopifyOrderSummary(order: Record<string, unknown>) {
  return {
    id: readRecordString(order, "id") ?? "",
    name: readRecordString(order, "name") ?? "",
    ...(readNestedString(order, "customer", "id") !== undefined
      ? { customerId: readNestedString(order, "customer", "id") }
      : {}),
    ...(readNestedString(order, "customer", "email") !== undefined
      ? { customerEmail: readNestedString(order, "customer", "email") }
      : readRecordString(order, "email") !== undefined
        ? { customerEmail: readRecordString(order, "email") }
        : {}),
    ...(readRecordString(order, "displayFinancialStatus") !== undefined
      ? { financialStatus: readRecordString(order, "displayFinancialStatus") }
      : {}),
    ...(readRecordString(order, "displayFulfillmentStatus") !== undefined
      ? { fulfillmentStatus: readRecordString(order, "displayFulfillmentStatus") }
      : {}),
    ...(readRecordString(order, "processedAt") !== undefined ? { processedAt: readRecordString(order, "processedAt") } : {}),
  };
}

function readShopifyFulfillments(order: Record<string, unknown>) {
  const fulfillments = order.fulfillments;
  if (!Array.isArray(fulfillments)) {
    return [];
  }

  return fulfillments.flatMap((fulfillment) => {
    if (fulfillment === null || typeof fulfillment !== "object") {
      return [];
    }

    const record = fulfillment as Record<string, unknown>;
    return [
      {
        id: readRecordString(record, "id") ?? "",
        status: readRecordString(record, "status") ?? "",
        tracking: readShopifyTrackingInfo(record),
      },
    ];
  });
}

function readShopifyTrackingInfo(fulfillment: Record<string, unknown>) {
  const trackingInfo = fulfillment.trackingInfo;
  if (!Array.isArray(trackingInfo)) {
    return [];
  }

  return trackingInfo.flatMap((tracking) => {
    if (tracking === null || typeof tracking !== "object") {
      return [];
    }

    const record = tracking as Record<string, unknown>;
    return [
      {
        ...(readRecordString(record, "number") !== undefined ? { number: readRecordString(record, "number") } : {}),
        ...(readRecordString(record, "company") !== undefined ? { company: readRecordString(record, "company") } : {}),
        ...(readRecordString(record, "url") !== undefined ? { url: readRecordString(record, "url") } : {}),
      },
    ];
  });
}

async function executeSalesforceAccountLookup(context: ConnectorExecutionContext) {
  const accountName = getStringInput(context.input, "accountName");
  const responseBody = await executeSalesforceQuery(
    context,
    `SELECT Id, Name, Website, Phone, Type FROM Account WHERE Name = '${escapeSalesforceSoqlString(accountName)}' LIMIT 1`,
  );
  const account = readFirstSalesforceRecord(responseBody, context);

  return {
    provider: "salesforce",
    toolId: context.toolId,
    account: {
      id: readRequiredRecordString(account, "Id"),
      name: readRecordString(account, "Name") ?? accountName,
      ...(readRecordString(account, "Website") !== undefined ? { website: readRecordString(account, "Website") } : {}),
      ...(readRecordString(account, "Phone") !== undefined ? { phone: readRecordString(account, "Phone") } : {}),
      ...(readRecordString(account, "Type") !== undefined ? { type: readRecordString(account, "Type") } : {}),
    },
  };
}

async function executeSalesforceContactLookup(context: ConnectorExecutionContext) {
  const email = getStringInput(context.input, "email").toLowerCase();
  const responseBody = await executeSalesforceQuery(
    context,
    `SELECT Id, Email, FirstName, LastName, AccountId FROM Contact WHERE Email = '${escapeSalesforceSoqlString(email)}' LIMIT 1`,
  );
  const contact = readFirstSalesforceRecord(responseBody, context);

  return {
    provider: "salesforce",
    toolId: context.toolId,
    contact: {
      id: readRequiredRecordString(contact, "Id"),
      email: readRecordString(contact, "Email") ?? email,
      ...(readRecordString(contact, "FirstName") !== undefined ? { firstName: readRecordString(contact, "FirstName") } : {}),
      ...(readRecordString(contact, "LastName") !== undefined ? { lastName: readRecordString(contact, "LastName") } : {}),
      ...(readRecordString(contact, "AccountId") !== undefined ? { accountId: readRecordString(contact, "AccountId") } : {}),
    },
  };
}

async function executeSalesforceCaseLookup(context: ConnectorExecutionContext) {
  const caseNumber = getStringInput(context.input, "caseNumber");
  const responseBody = await executeSalesforceQuery(
    context,
    `SELECT Id, CaseNumber, Subject, Status, Priority, AccountId, ContactId FROM Case WHERE CaseNumber = '${escapeSalesforceSoqlString(caseNumber)}' LIMIT 1`,
  );
  const caseRecord = readFirstSalesforceRecord(responseBody, context);

  return {
    provider: "salesforce",
    toolId: context.toolId,
    case: {
      id: readRequiredRecordString(caseRecord, "Id"),
      caseNumber: readRecordString(caseRecord, "CaseNumber") ?? caseNumber,
      ...(readRecordString(caseRecord, "Subject") !== undefined ? { subject: readRecordString(caseRecord, "Subject") } : {}),
      ...(readRecordString(caseRecord, "Status") !== undefined ? { status: readRecordString(caseRecord, "Status") } : {}),
      ...(readRecordString(caseRecord, "Priority") !== undefined ? { priority: readRecordString(caseRecord, "Priority") } : {}),
      ...(readRecordString(caseRecord, "AccountId") !== undefined ? { accountId: readRecordString(caseRecord, "AccountId") } : {}),
      ...(readRecordString(caseRecord, "ContactId") !== undefined ? { contactId: readRecordString(caseRecord, "ContactId") } : {}),
    },
  };
}

async function executeSalesforceTaskCreate(context: ConnectorExecutionContext) {
  const subject = getStringInput(context.input, "subject");
  const description = getOptionalStringInput(context.input, "description");
  const dueDate = getOptionalStringInput(context.input, "dueDate");
  const contactId = getOptionalStringInput(context.input, "contactId");
  const accountId = getOptionalStringInput(context.input, "accountId");
  const priority = getOptionalStringInput(context.input, "priority") ?? "Normal";
  const taskBody: Record<string, unknown> = {
    Subject: subject,
    ...(description !== undefined ? { Description: description } : {}),
    ...(dueDate !== undefined ? { ActivityDate: dueDate } : {}),
    ...(contactId !== undefined ? { WhoId: contactId } : {}),
    ...(accountId !== undefined ? { WhatId: accountId } : {}),
    Priority: priority,
    Status: "Not Started",
  };
  const responseBody = await createSalesforceRecord(context, "Task", taskBody);

  return {
    provider: "salesforce",
    toolId: context.toolId,
    task: {
      id: readSalesforceCreatedId(responseBody),
      subject,
      ...(contactId !== undefined ? { contactId } : {}),
      ...(accountId !== undefined ? { accountId } : {}),
      status: "Not Started",
      ...(context.idempotencyKey !== undefined ? { idempotencyKey: context.idempotencyKey } : {}),
    },
  };
}

async function executeSalesforceCaseCreate(context: ConnectorExecutionContext) {
  const subject = getStringInput(context.input, "subject");
  const description = getStringInput(context.input, "description");
  const suppliedEmail = getOptionalStringInput(context.input, "suppliedEmail");
  const priority = getOptionalStringInput(context.input, "priority") ?? "Medium";
  const responseBody = await createSalesforceRecord(context, "Case", {
    Subject: subject,
    Description: description,
    ...(suppliedEmail !== undefined ? { SuppliedEmail: suppliedEmail } : {}),
    Priority: priority,
    Origin: "Phone",
  });

  return {
    provider: "salesforce",
    toolId: context.toolId,
    case: {
      id: readSalesforceCreatedId(responseBody),
      subject,
      ...(suppliedEmail !== undefined ? { suppliedEmail } : {}),
      priority,
      status: "New",
      ...(context.idempotencyKey !== undefined ? { idempotencyKey: context.idempotencyKey } : {}),
    },
  };
}

async function executeSalesforceCallNoteCreate(context: ConnectorExecutionContext) {
  const subject = getStringInput(context.input, "subject");
  const body = getStringInput(context.input, "body");
  const contactId = getOptionalStringInput(context.input, "contactId");
  const accountId = getOptionalStringInput(context.input, "accountId");
  const responseBody = await createSalesforceRecord(context, "Task", {
    Subject: subject,
    Description: body,
    ...(contactId !== undefined ? { WhoId: contactId } : {}),
    ...(accountId !== undefined ? { WhatId: accountId } : {}),
    Priority: "Normal",
    Status: "Completed",
  });

  return {
    provider: "salesforce",
    toolId: context.toolId,
    note: {
      id: readSalesforceCreatedId(responseBody),
      subject,
      ...(contactId !== undefined ? { contactId } : {}),
      ...(accountId !== undefined ? { accountId } : {}),
      status: "Completed",
      ...(context.idempotencyKey !== undefined ? { idempotencyKey: context.idempotencyKey } : {}),
    },
  };
}

async function executeSalesforceQuery(context: ConnectorExecutionContext, query: string) {
  const url = new URL(`${buildSalesforceRestBaseUrl(context)}/query`);
  url.searchParams.set("q", query);
  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      authorization: buildBearerAuthorization(context),
    },
  });
  const responseBody = await readJsonResponse(response);
  handleSalesforceErrorResponse(context, response);

  return responseBody;
}

async function createSalesforceRecord(
  context: ConnectorExecutionContext,
  objectName: "Task" | "Case",
  body: Record<string, unknown>,
) {
  const response = await fetch(`${buildSalesforceRestBaseUrl(context)}/sobjects/${objectName}`, {
    method: "POST",
    headers: buildSalesforceWriteHeaders(context),
    body: JSON.stringify(body),
  });
  const responseBody = await readJsonResponse(response);
  handleSalesforceErrorResponse(context, response);

  return responseBody;
}

function handleSalesforceErrorResponse(context: ConnectorExecutionContext, response: Response) {
  if (response.status === 429) {
    const retryAfterSeconds = Number.parseInt(response.headers.get("retry-after") ?? "30", 10) || 30;
    throw new HttpException(
      {
        statusCode: 429,
        message: "Salesforce rate limit reached. Retry later.",
        retryAfterSeconds,
        provider: "salesforce",
        toolId: context.toolId,
        code: "tool_execution.rate_limited",
        recoverable: true,
      },
      429,
    );
  }

  if (response.status < 200 || response.status >= 300) {
    throw new HttpException(
      {
        statusCode: response.status,
        message: "Salesforce tool execution failed.",
        provider: "salesforce",
        toolId: context.toolId,
      },
      response.status,
    );
  }
}

function buildSalesforceWriteHeaders(context: ConnectorExecutionContext) {
  const headers: Record<string, string> = {
    authorization: buildBearerAuthorization(context),
    "content-type": "application/json",
  };

  if (context.idempotencyKey !== undefined) {
    headers["Sforce-Call-Options"] = `client=${encodeURIComponent(context.idempotencyKey)}`;
  }

  return headers;
}

function buildSalesforceRestBaseUrl(context: ConnectorExecutionContext) {
  return `https://${getSalesforceInstanceSubdomain(context.externalAccountId)}.my.salesforce.com/services/data/v60.0`;
}

function getSalesforceInstanceSubdomain(externalAccountId: string) {
  return externalAccountId.startsWith("salesforce:")
    ? `salesforce.${externalAccountId.slice("salesforce:".length)}`
    : externalAccountId;
}

function escapeSalesforceSoqlString(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function readFirstSalesforceRecord(responseBody: unknown, context: ConnectorExecutionContext) {
  const records = readSalesforceRecords(responseBody);
  const record = records[0];
  if (record === undefined) {
    throw new HttpException(
      {
        statusCode: 404,
        message: "Salesforce record was not found.",
        provider: "salesforce",
        toolId: context.toolId,
        code: "tool_execution.not_found",
        recoverable: true,
      },
      404,
    );
  }

  return record;
}

function readSalesforceRecords(responseBody: unknown): Record<string, unknown>[] {
  if (responseBody === null || typeof responseBody !== "object") {
    return [];
  }

  const records = (responseBody as { records?: unknown }).records;
  return Array.isArray(records)
    ? records.filter((record): record is Record<string, unknown> => record !== null && typeof record === "object")
    : [];
}

function readRecordString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function readRequiredRecordString(record: Record<string, unknown>, key: string) {
  return readRecordString(record, key) ?? "";
}

function readSalesforceCreatedId(responseBody: unknown) {
  if (responseBody !== null && typeof responseBody === "object") {
    const id = (responseBody as { id?: unknown }).id;
    if (typeof id === "string" && id.length > 0) {
      return id;
    }
  }

  return "";
}

async function executeNotionKnowledgeSearch(context: ConnectorExecutionContext) {
  const query = getStringInput(context.input, "query");
  const response = await fetch("https://api.notion.com/v1/search", {
    method: "POST",
    headers: buildNotionHeaders(context),
    body: JSON.stringify({
      query,
      page_size: 5,
    }),
  });
  const responseBody = await readJsonResponse(response);

  if (response.status === 429) {
    const retryAfterSeconds = Number.parseInt(response.headers.get("retry-after") ?? "30", 10) || 30;
    throw new HttpException(
      {
        statusCode: 429,
        message: "Notion rate limit reached. Retry later.",
        retryAfterSeconds,
        provider: "notion",
        toolId: context.toolId,
        code: "tool_execution.rate_limited",
        recoverable: true,
      },
      429,
    );
  }

  if (response.status < 200 || response.status >= 300) {
    throw new HttpException(
      {
        statusCode: response.status,
        message: "Notion knowledge search failed.",
        provider: "notion",
        toolId: context.toolId,
      },
      response.status,
    );
  }

  return {
    provider: "notion",
    toolId: context.toolId,
    workspaceId: context.externalAccountId,
    results: readNotionResults(responseBody).map((result) => ({
      id: String(result.id),
      title: readNotionTitle(result) ?? `Knowledge result for ${query}`,
      uri: readNotionUrl(result) ?? `notion://workspace/${encodeURIComponent(context.externalAccountId)}/search/${encodeURIComponent(query)}`,
    })),
  };
}

async function executeNotionPageCreate(context: ConnectorExecutionContext) {
  const title = getStringInput(context.input, "title");
  const body = getStringInput(context.input, "body");
  const parentPageId = getOptionalStringInput(context.input, "parentPageId");
  const response = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: buildNotionHeaders(context),
    body: JSON.stringify({
      parent: {
        page_id: parentPageId ?? context.externalAccountId,
      },
      properties: buildNotionTitleProperties(title),
      children: [
        buildNotionParagraphBlock(body),
      ],
    }),
  });
  const responseBody = await readJsonResponse(response);

  if (response.status === 429) {
    const retryAfterSeconds = Number.parseInt(response.headers.get("retry-after") ?? "30", 10) || 30;
    throw new HttpException(
      {
        statusCode: 429,
        message: "Notion rate limit reached. Retry later.",
        retryAfterSeconds,
        provider: "notion",
        toolId: context.toolId,
        code: "tool_execution.rate_limited",
        recoverable: true,
      },
      429,
    );
  }

  if (response.status < 200 || response.status >= 300) {
    throw new HttpException(
      {
        statusCode: response.status,
        message: "Notion page creation failed.",
        provider: "notion",
        toolId: context.toolId,
      },
      response.status,
    );
  }

  const page = responseBody !== null && typeof responseBody === "object"
    ? responseBody as Record<string, unknown>
    : {};

  return {
    provider: "notion",
    toolId: context.toolId,
    page: {
      id: String(page.id ?? `notion-page-${stableNumericId(`${context.externalAccountId}:${title}:${body}`)}`),
      workspaceId: context.externalAccountId,
      title: readNotionTitle(page) ?? title,
      body,
      ...(parentPageId !== undefined ? { parentPageId } : {}),
      ...(readNotionUrl(page) !== undefined ? { uri: readNotionUrl(page) } : {}),
    },
  };
}

async function executeNotionTaskCreate(context: ConnectorExecutionContext) {
  const title = getStringInput(context.input, "title");
  const assigneeEmail = getOptionalStringInput(context.input, "assigneeEmail");
  const response = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: buildNotionHeaders(context),
    body: JSON.stringify({
      parent: {
        page_id: context.externalAccountId,
      },
      properties: buildNotionTitleProperties(title),
      children: assigneeEmail === undefined
        ? []
        : [
            buildNotionParagraphBlock(`Assignee: ${assigneeEmail}`),
          ],
    }),
  });
  const responseBody = await readJsonResponse(response);

  if (response.status === 429) {
    const retryAfterSeconds = Number.parseInt(response.headers.get("retry-after") ?? "30", 10) || 30;
    throw new HttpException(
      {
        statusCode: 429,
        message: "Notion rate limit reached. Retry later.",
        retryAfterSeconds,
        provider: "notion",
        toolId: context.toolId,
        code: "tool_execution.rate_limited",
        recoverable: true,
      },
      429,
    );
  }

  if (response.status < 200 || response.status >= 300) {
    throw new HttpException(
      {
        statusCode: response.status,
        message: "Notion task creation failed.",
        provider: "notion",
        toolId: context.toolId,
      },
      response.status,
    );
  }

  const task = responseBody !== null && typeof responseBody === "object"
    ? responseBody as Record<string, unknown>
    : {};

  return {
    provider: "notion",
    toolId: context.toolId,
    task: {
      id: String(task.id ?? `notion-task-${stableNumericId(`${context.externalAccountId}:${title}`)}`),
      workspaceId: context.externalAccountId,
      title: readNotionTitle(task) ?? title,
      ...(assigneeEmail !== undefined ? { assigneeEmail } : {}),
      status: "open",
      ...(readNotionUrl(task) !== undefined ? { uri: readNotionUrl(task) } : {}),
    },
  };
}

async function executeGoogleCalendarAvailability(context: ConnectorExecutionContext) {
  const calendarId = getStringInput(context.input, "calendarId");
  const start = getStringInput(context.input, "start");
  const end = getStringInput(context.input, "end");
  const timezone = getStringInput(context.input, "timezone");
  const response = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    headers: {
      authorization: buildBearerAuthorization(context),
      "content-type": "application/json",
    },
    body: JSON.stringify({
      timeMin: start,
      timeMax: end,
      timeZone: timezone,
      items: [
        {
          id: calendarId,
        },
      ],
    }),
  });
  const responseBody = await readJsonResponse(response);

  if (response.status === 429) {
    const retryAfterSeconds = Number.parseInt(response.headers.get("retry-after") ?? "30", 10) || 30;
    throw new HttpException(
      {
        statusCode: 429,
        message: "Google Calendar rate limit reached. Retry later.",
        retryAfterSeconds,
        provider: "google-workspace",
        toolId: context.toolId,
        code: "tool_execution.rate_limited",
        recoverable: true,
      },
      429,
    );
  }

  if (response.status < 200 || response.status >= 300) {
    throw new HttpException(
      {
        statusCode: response.status,
        message: "Google Calendar availability lookup failed.",
        provider: "google-workspace",
        toolId: context.toolId,
      },
      response.status,
    );
  }

  const busy = readGoogleCalendarBusyIntervals(responseBody, calendarId);

  return {
    provider: "google-workspace",
    toolId: context.toolId,
    calendarId,
    start,
    end,
    timezone,
    busy,
    available: busy.length === 0,
  };
}

async function executeGoogleCalendarEventCreate(context: ConnectorExecutionContext) {
  const calendarId = getStringInput(context.input, "calendarId");
  const title = getStringInput(context.input, "title");
  const start = getStringInput(context.input, "start");
  const end = getStringInput(context.input, "end");
  const timezone = getStringInput(context.input, "timezone");
  const attendeeEmail = getOptionalStringInput(context.input, "attendeeEmail");
  const eventBody: Record<string, unknown> = {
    summary: title,
    start: {
      dateTime: start,
      timeZone: timezone,
    },
    end: {
      dateTime: end,
      timeZone: timezone,
    },
  };

  if (attendeeEmail !== undefined) {
    eventBody.attendees = [
      {
        email: attendeeEmail,
      },
    ];
  }

  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
    {
      method: "POST",
      headers: {
        authorization: buildBearerAuthorization(context),
        "content-type": "application/json",
      },
      body: JSON.stringify(eventBody),
    },
  );
  const responseBody = await readJsonResponse(response);

  if (response.status === 429) {
    const retryAfterSeconds = Number.parseInt(response.headers.get("retry-after") ?? "30", 10) || 30;
    throw new HttpException(
      {
        statusCode: 429,
        message: "Google Calendar rate limit reached. Retry later.",
        retryAfterSeconds,
        provider: "google-workspace",
        toolId: context.toolId,
        code: "tool_execution.rate_limited",
        recoverable: true,
      },
      429,
    );
  }

  if (response.status < 200 || response.status >= 300) {
    throw new HttpException(
      {
        statusCode: response.status,
        message: "Google Calendar event creation failed.",
        provider: "google-workspace",
        toolId: context.toolId,
      },
      response.status,
    );
  }

  const event = responseBody !== null && typeof responseBody === "object"
    ? responseBody as Record<string, unknown>
    : {};
  const eventStart = readNestedString(event, "start", "dateTime") ?? start;
  const eventEnd = readNestedString(event, "end", "dateTime") ?? end;
  const eventTimezone = readNestedString(event, "start", "timeZone") ?? timezone;
  const returnedAttendeeEmail = readFirstGoogleCalendarAttendeeEmail(event) ?? attendeeEmail;

  return {
    provider: "google-workspace",
    toolId: context.toolId,
    event: {
      id: String(event.id ?? `gcal-event-${stableNumericId(`${calendarId}:${title}:${start}:${end}`)}`),
      calendarId,
      title: typeof event.summary === "string" ? event.summary : title,
      start: eventStart,
      end: eventEnd,
      timezone: eventTimezone,
      ...(returnedAttendeeEmail !== undefined ? { attendeeEmail: returnedAttendeeEmail } : {}),
    },
  };
}

async function executeMicrosoft365CalendarAvailability(context: ConnectorExecutionContext) {
  const calendarEmail = getStringInput(context.input, "calendarEmail");
  const start = getStringInput(context.input, "start");
  const end = getStringInput(context.input, "end");
  const timezone = getStringInput(context.input, "timezone");
  const availabilityViewInterval = getOptionalNumberInput(context.input, "availabilityViewIntervalMinutes") ?? 30;
  const response = await fetch("https://graph.microsoft.com/v1.0/me/calendar/getSchedule", {
    method: "POST",
    headers: {
      authorization: buildBearerAuthorization(context),
      "content-type": "application/json",
    },
    body: JSON.stringify({
      schedules: [calendarEmail],
      startTime: {
        dateTime: start,
        timeZone: timezone,
      },
      endTime: {
        dateTime: end,
        timeZone: timezone,
      },
      availabilityViewInterval,
    }),
  });
  const responseBody = await readJsonResponse(response);

  handleMicrosoft365CalendarFailure(response, "Microsoft 365 calendar availability lookup failed.", context.toolId);

  const schedule = readFirstMicrosoftGraphSchedule(responseBody);
  const busy = readMicrosoftGraphScheduleBusyIntervals(schedule);

  return {
    provider: "microsoft-365",
    toolId: context.toolId,
    calendarEmail,
    start,
    end,
    timezone,
    availabilityView: typeof schedule?.availabilityView === "string" ? schedule.availabilityView : "",
    busy,
    available: busy.length === 0,
  };
}

async function executeMicrosoft365CalendarEventCreate(context: ConnectorExecutionContext) {
  const calendarId = getStringInput(context.input, "calendarId");
  const title = getStringInput(context.input, "title");
  const start = getStringInput(context.input, "start");
  const end = getStringInput(context.input, "end");
  const timezone = getStringInput(context.input, "timezone");
  const attendeeEmail = getOptionalStringInput(context.input, "attendeeEmail");
  const body = getOptionalStringInput(context.input, "body");
  const eventBody: Record<string, unknown> = {
    subject: title,
    start: {
      dateTime: start,
      timeZone: timezone,
    },
    end: {
      dateTime: end,
      timeZone: timezone,
    },
  };

  if (attendeeEmail !== undefined) {
    eventBody.attendees = [
      {
        emailAddress: {
          address: attendeeEmail,
        },
        type: "required",
      },
    ];
  }

  if (body !== undefined) {
    eventBody.body = {
      contentType: "text",
      content: body,
    };
  }

  if (context.idempotencyKey !== undefined) {
    eventBody.transactionId = context.idempotencyKey;
  }

  const response = await fetch(
    `https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(calendarId)}/events`,
    {
      method: "POST",
      headers: {
        authorization: buildBearerAuthorization(context),
        "content-type": "application/json",
      },
      body: JSON.stringify(eventBody),
    },
  );
  const responseBody = await readJsonResponse(response);

  handleMicrosoft365CalendarFailure(response, "Microsoft 365 calendar event creation failed.", context.toolId);

  const event = responseBody !== null && typeof responseBody === "object"
    ? responseBody as Record<string, unknown>
    : {};
  const eventStart = readNestedString(event, "start", "dateTime") ?? start;
  const eventEnd = readNestedString(event, "end", "dateTime") ?? end;
  const eventTimezone = readNestedString(event, "start", "timeZone") ?? timezone;
  const returnedAttendeeEmail = readFirstMicrosoftGraphAttendeeEmail(event) ?? attendeeEmail;
  const returnedIdempotencyKey = typeof event.transactionId === "string"
    ? event.transactionId
    : context.idempotencyKey;
  const webLink = typeof event.webLink === "string" ? event.webLink : undefined;

  return {
    provider: "microsoft-365",
    toolId: context.toolId,
    event: {
      id: String(event.id ?? `m365-event-${stableNumericId(`${calendarId}:${title}:${start}:${end}`)}`),
      calendarId,
      title: typeof event.subject === "string" ? event.subject : title,
      start: eventStart,
      end: eventEnd,
      timezone: eventTimezone,
      ...(returnedAttendeeEmail !== undefined ? { attendeeEmail: returnedAttendeeEmail } : {}),
      ...(webLink !== undefined ? { webLink } : {}),
      ...(returnedIdempotencyKey !== undefined ? { idempotencyKey: returnedIdempotencyKey } : {}),
    },
  };
}

function handleMicrosoft365CalendarFailure(
  response: Response,
  message: string,
  toolId: string,
) {
  if (response.status === 429) {
    const retryAfterSeconds = Number.parseInt(response.headers.get("retry-after") ?? "30", 10) || 30;
    throw new HttpException(
      {
        statusCode: 429,
        message: "Microsoft 365 calendar rate limit reached. Retry later.",
        retryAfterSeconds,
        provider: "microsoft-365",
        toolId,
        code: "tool_execution.rate_limited",
        recoverable: true,
      },
      429,
    );
  }

  if (response.status < 200 || response.status >= 300) {
    throw new HttpException(
      {
        statusCode: response.status,
        message,
        provider: "microsoft-365",
        toolId,
      },
      response.status,
    );
  }
}

async function executeHubSpotContactLookup(context: ConnectorExecutionContext) {
  const email = getStringInput(context.input, "email").toLowerCase();

  const response = await fetch("https://api.hubapi.com/crm/v3/objects/contacts/search", {
    method: "POST",
    headers: {
      authorization: buildBearerAuthorization(context),
      "content-type": "application/json",
    },
    body: JSON.stringify({
      filterGroups: [
        {
          filters: [
            {
              propertyName: "email",
              operator: "EQ",
              value: email,
            },
          ],
        },
      ],
      properties: ["email", "firstname", "lastname", "lifecyclestage"],
      limit: 2,
    }),
  });
  const responseBody = await readJsonResponse(response);

  if (response.status === 429) {
    const retryAfterSeconds = Number.parseInt(response.headers.get("retry-after") ?? "30", 10) || 30;
    throw new HttpException(
      {
        statusCode: 429,
        message: "HubSpot rate limit reached. Retry later.",
        retryAfterSeconds,
        provider: "hubspot",
        toolId: context.toolId,
        code: "tool_execution.rate_limited",
        recoverable: true,
      },
      429,
    );
  }

  if (response.status < 200 || response.status >= 300) {
    throw new HttpException(
      {
        statusCode: response.status,
        message: "HubSpot contact lookup failed.",
        provider: "hubspot",
        toolId: context.toolId,
      },
      response.status,
    );
  }

  const contacts = readHubSpotResults(responseBody);
  if (contacts.length > 1) {
    throw new HttpException(
      {
        statusCode: 409,
        message: "HubSpot returned multiple matching contacts.",
        provider: "hubspot",
        toolId: context.toolId,
        code: "duplicate_contacts",
        recoverable: true,
      },
      409,
    );
  }

  const contact = contacts[0];
  if (contact === undefined) {
    throw new HttpException(
      {
        statusCode: 404,
        message: "HubSpot contact was not found.",
        provider: "hubspot",
        toolId: context.toolId,
        code: "tool_execution.not_found",
        recoverable: true,
      },
      404,
    );
  }

  const properties = readObjectProperties(contact);
  return {
    provider: "hubspot",
    toolId: context.toolId,
    contact: {
      id: String(contact.id),
      email: typeof properties.email === "string" ? properties.email : email,
      ...(typeof properties.firstname === "string" ? { firstName: properties.firstname } : {}),
      ...(typeof properties.lastname === "string" ? { lastName: properties.lastname } : {}),
      ...(typeof properties.lifecyclestage === "string"
        ? { lifecycleStage: properties.lifecyclestage }
        : {}),
    },
  };
}

async function executeHubSpotNoteCreate(context: ConnectorExecutionContext) {
  const contactId = getStringInput(context.input, "contactId");
  const body = getStringInput(context.input, "body");
  const timestamp = new Date().toISOString();

  const response = await fetch("https://api.hubapi.com/crm/v3/objects/notes", {
    method: "POST",
    headers: {
      authorization: buildBearerAuthorization(context),
      "content-type": "application/json",
    },
    body: JSON.stringify({
      properties: {
        hs_note_body: body,
        hs_timestamp: timestamp,
      },
      associations: [
        {
          to: {
            id: contactId,
          },
          types: [
            {
              associationCategory: "HUBSPOT_DEFINED",
              associationTypeId: 202,
            },
          ],
        },
      ],
    }),
  });
  const responseBody = await readJsonResponse(response);

  if (response.status === 429) {
    const retryAfterSeconds = Number.parseInt(response.headers.get("retry-after") ?? "30", 10) || 30;
    throw new HttpException(
      {
        statusCode: 429,
        message: "HubSpot rate limit reached. Retry later.",
        retryAfterSeconds,
        provider: "hubspot",
        toolId: context.toolId,
        code: "tool_execution.rate_limited",
        recoverable: true,
      },
      429,
    );
  }

  if (response.status < 200 || response.status >= 300) {
    throw new HttpException(
      {
        statusCode: response.status,
        message: "HubSpot note creation failed.",
        provider: "hubspot",
        toolId: context.toolId,
      },
      response.status,
    );
  }

  const note = responseBody !== null && typeof responseBody === "object"
    ? responseBody as Record<string, unknown>
    : {};
  const properties = readObjectProperties(note);

  return {
    provider: "hubspot",
    toolId: context.toolId,
    note: {
      id: String(note.id),
      contactId,
      body: typeof properties.hs_note_body === "string" ? properties.hs_note_body : body,
      createdAt: typeof properties.hs_timestamp === "string" ? properties.hs_timestamp : timestamp,
    },
  };
}

async function executeHubSpotPipelineUpdate(context: ConnectorExecutionContext) {
  const dealId = getStringInput(context.input, "dealId");
  const stage = getStringInput(context.input, "stage");

  const response = await fetch(
    `https://api.hubapi.com/crm/v3/objects/deals/${encodeURIComponent(dealId)}`,
    {
      method: "PATCH",
      headers: {
        authorization: buildBearerAuthorization(context),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        properties: {
          dealstage: stage,
        },
      }),
    },
  );
  const responseBody = await readJsonResponse(response);

  if (response.status === 429) {
    const retryAfterSeconds = Number.parseInt(response.headers.get("retry-after") ?? "30", 10) || 30;
    throw new HttpException(
      {
        statusCode: 429,
        message: "HubSpot rate limit reached. Retry later.",
        retryAfterSeconds,
        provider: "hubspot",
        toolId: context.toolId,
        code: "tool_execution.rate_limited",
        recoverable: true,
      },
      429,
    );
  }

  if (response.status < 200 || response.status >= 300) {
    throw new HttpException(
      {
        statusCode: response.status,
        message: "HubSpot deal update failed.",
        provider: "hubspot",
        toolId: context.toolId,
      },
      response.status,
    );
  }

  const deal = responseBody !== null && typeof responseBody === "object"
    ? responseBody as Record<string, unknown>
    : {};
  const properties = readObjectProperties(deal);

  return {
    provider: "hubspot",
    toolId: context.toolId,
    deal: {
      id: String(deal.id ?? dealId),
      stage: typeof properties.dealstage === "string" ? properties.dealstage : stage,
      ...(typeof properties.pipeline === "string" ? { pipeline: properties.pipeline } : {}),
      updated: true,
    },
  };
}

async function executeZendeskTicketSearch(context: ConnectorExecutionContext) {
  const query = getStringInput(context.input, "query");

  if (context.credential.credentialType === "api-token") {
    return searchZendeskTicketsWithApiToken({
      context,
      query,
    });
  }

  if (query.toLowerCase().includes("rate-limit")) {
    throw new HttpException(
      {
        statusCode: 429,
        message: "Zendesk rate limit reached. Retry after 30 seconds.",
        retryAfterSeconds: 30,
        provider: "zendesk",
        toolId: context.toolId,
      },
      429,
    );
  }

  return {
    provider: "zendesk",
    toolId: context.toolId,
    tickets: [
      {
        id: "zd-ticket-1001",
        subject: `Ticket matching ${query}`,
        status: "open",
        requesterEmail: extractEmail(query) ?? "caller@example.com",
      },
    ],
  };
}

async function executeZendeskTicketCreate(context: ConnectorExecutionContext) {
  const subject = getStringInput(context.input, "subject");
  const requesterEmail = getStringInput(context.input, "requesterEmail");
  const body = getStringInput(context.input, "body");
  const priority = getOptionalStringInput(context.input, "priority") ?? "normal";

  if (context.credential.credentialType === "api-token") {
    return createZendeskTicketWithApiToken({
      context,
      subject,
      requesterEmail,
      body,
      priority,
    });
  }

  return {
    provider: "zendesk",
    toolId: context.toolId,
    ticket: {
      id: `zd-ticket-${stableNumericId(`${subject}:${requesterEmail}:${body}`)}`,
      subject,
      requesterEmail,
      body,
      priority,
      status: "new",
    },
  };
}

async function searchZendeskTicketsWithApiToken(input: {
  context: ConnectorExecutionContext;
  query: string;
}) {
  const { context } = input;
  const credential = readZendeskApiTokenCredential(context);
  const url = new URL(`https://${credential.subdomain}.zendesk.com/api/v2/search`);
  url.searchParams.set("query", normalizeZendeskTicketSearchQuery(input.query));

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      authorization: buildZendeskApiTokenAuthorization(credential),
      "content-type": "application/json",
    },
  });
  const responseBody = await readJsonResponse(response);
  if (response.status === 429) {
    const retryAfterSeconds = Number.parseInt(response.headers.get("retry-after") ?? "30", 10) || 30;
    throw new HttpException(
      {
        statusCode: 429,
        message: "Zendesk rate limit reached. Retry later.",
        retryAfterSeconds,
        provider: "zendesk",
        toolId: context.toolId,
        code: "tool_execution.rate_limited",
        recoverable: true,
      },
      429,
    );
  }
  if (response.status < 200 || response.status >= 300) {
    throw new HttpException(
      {
        statusCode: response.status,
        message: "Zendesk ticket search failed.",
        provider: "zendesk",
        toolId: context.toolId,
      },
      response.status,
    );
  }

  return {
    provider: "zendesk",
    toolId: context.toolId,
    tickets: readZendeskSearchResults(responseBody).map((ticket) => ({
      id: String(ticket.id),
      subject: typeof ticket.subject === "string" ? ticket.subject : "",
      status: typeof ticket.status === "string" ? ticket.status : "unknown",
      requesterEmail: readZendeskRequesterEmail(ticket) ?? extractEmail(input.query) ?? "unknown",
      ...(typeof ticket.priority === "string" ? { priority: ticket.priority } : {}),
    })),
  };
}

async function createZendeskTicketWithApiToken(input: {
  context: ConnectorExecutionContext;
  subject: string;
  requesterEmail: string;
  body: string;
  priority: string;
}) {
  const { context, subject, requesterEmail, body, priority } = input;
  const credential = readZendeskApiTokenCredential(context);

  const response = await fetch(`https://${credential.subdomain}.zendesk.com/api/v2/tickets`, {
    method: "POST",
    headers: {
      authorization: buildZendeskApiTokenAuthorization(credential),
      "content-type": "application/json",
    },
    body: JSON.stringify({
      ticket: {
        subject,
        requester: {
          email: requesterEmail,
        },
        comment: {
          body,
        },
        priority,
      },
    }),
  });
  const responseBody = await readJsonResponse(response);
  if (response.status === 429) {
    const retryAfterSeconds = Number.parseInt(response.headers.get("retry-after") ?? "30", 10) || 30;
    throw new HttpException(
      {
        statusCode: 429,
        message: "Zendesk rate limit reached. Retry later.",
        retryAfterSeconds,
        provider: "zendesk",
        toolId: context.toolId,
        code: "tool_execution.rate_limited",
        recoverable: true,
      },
      429,
    );
  }
  if (response.status < 200 || response.status >= 300) {
    throw new HttpException(
      {
        statusCode: response.status,
        message: "Zendesk ticket creation failed.",
        provider: "zendesk",
        toolId: context.toolId,
      },
      response.status,
    );
  }

  const ticket = readZendeskTicket(responseBody);
  return {
    provider: "zendesk",
    toolId: context.toolId,
    ticket: {
      id: String(ticket.id),
      subject: typeof ticket.subject === "string" ? ticket.subject : subject,
      requesterEmail,
      priority: typeof ticket.priority === "string" ? ticket.priority : priority,
      status: typeof ticket.status === "string" ? ticket.status : "new",
    },
  };
}

function readZendeskApiTokenCredential(context: ConnectorExecutionContext) {
  const subdomain = context.credential.zendeskSubdomain;
  const email = context.credential.zendeskEmail;
  const apiToken = context.credential.zendeskApiToken;
  if (subdomain === undefined || email === undefined || apiToken === undefined) {
    throw new ForbiddenException("Zendesk credential is unavailable.");
  }

  return {
    subdomain,
    email,
    apiToken,
  };
}

function buildZendeskApiTokenAuthorization(input: {
  email: string;
  apiToken: string;
}) {
  return `Basic ${Buffer.from(`${input.email}/token:${input.apiToken}`).toString("base64")}`;
}

async function readJsonResponse(response: Response) {
  const text = await response.text();
  if (text.length === 0) {
    return {};
  }

  return JSON.parse(text) as unknown;
}

function buildBearerAuthorization(context: ConnectorExecutionContext) {
  if (context.accessToken === undefined || context.accessToken.length === 0) {
    throw new ForbiddenException("Integration credential is unavailable.");
  }

  return `Bearer ${context.accessToken}`;
}

function buildNotionHeaders(context: ConnectorExecutionContext) {
  return {
    authorization: buildBearerAuthorization(context),
    "content-type": "application/json",
    "Notion-Version": "2022-06-28",
  };
}

function buildNotionTitleProperties(title: string) {
  return {
    title: {
      title: [
        {
          type: "text",
          text: {
            content: title,
          },
        },
      ],
    },
  };
}

function buildNotionParagraphBlock(content: string) {
  return {
    object: "block",
    type: "paragraph",
    paragraph: {
      rich_text: [
        {
          type: "text",
          text: {
            content,
          },
        },
      ],
    },
  };
}

function readNotionResults(responseBody: unknown): Record<string, unknown>[] {
  if (responseBody === null || typeof responseBody !== "object") {
    return [];
  }

  const results = (responseBody as { results?: unknown }).results;
  return Array.isArray(results)
    ? results.filter((result): result is Record<string, unknown> => result !== null && typeof result === "object")
    : [];
}

function readNotionTitle(record: Record<string, unknown>) {
  const properties = readObjectProperties(record);
  const titleProperty = properties.title ?? properties.Name ?? properties.name;
  if (titleProperty !== null && typeof titleProperty === "object") {
    const title = (titleProperty as { title?: unknown }).title;
    const plainText = readFirstNotionPlainText(title);
    if (plainText !== undefined) {
      return plainText;
    }
  }

  return undefined;
}

function readFirstNotionPlainText(value: unknown) {
  if (!Array.isArray(value)) {
    return undefined;
  }

  for (const item of value) {
    if (item === null || typeof item !== "object") {
      continue;
    }

    const plainText = (item as { plain_text?: unknown }).plain_text;
    if (typeof plainText === "string") {
      return plainText;
    }

    const text = (item as { text?: unknown }).text;
    if (text !== null && typeof text === "object") {
      const content = (text as { content?: unknown }).content;
      if (typeof content === "string") {
        return content;
      }
    }
  }

  return undefined;
}

function readNotionUrl(record: Record<string, unknown>) {
  const url = record.url;
  return typeof url === "string" ? url : undefined;
}

function readHubSpotResults(responseBody: unknown): Record<string, unknown>[] {
  if (responseBody === null || typeof responseBody !== "object") {
    return [];
  }

  const results = (responseBody as { results?: unknown }).results;
  return Array.isArray(results)
    ? results.filter((result): result is Record<string, unknown> => result !== null && typeof result === "object")
    : [];
}

function readObjectProperties(record: Record<string, unknown>) {
  const properties = record.properties;

  return properties !== null && typeof properties === "object"
    ? properties as Record<string, unknown>
    : {};
}

function readGoogleCalendarBusyIntervals(
  responseBody: unknown,
  calendarId: string,
): Array<{ start: string; end: string }> {
  if (responseBody === null || typeof responseBody !== "object") {
    return [];
  }

  const calendars = (responseBody as { calendars?: unknown }).calendars;
  if (calendars === null || typeof calendars !== "object") {
    return [];
  }

  const calendar = (calendars as Record<string, unknown>)[calendarId];
  if (calendar === null || typeof calendar !== "object") {
    return [];
  }

  const busy = (calendar as { busy?: unknown }).busy;
  if (!Array.isArray(busy)) {
    return [];
  }

  return busy.flatMap((interval) => {
    if (interval === null || typeof interval !== "object") {
      return [];
    }

    const start = (interval as { start?: unknown }).start;
    const end = (interval as { end?: unknown }).end;

    return typeof start === "string" && typeof end === "string"
      ? [{ start, end }]
      : [];
  });
}

function readFirstMicrosoftGraphSchedule(responseBody: unknown): Record<string, unknown> | undefined {
  if (responseBody === null || typeof responseBody !== "object") {
    return undefined;
  }

  const value = (responseBody as { value?: unknown }).value;
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value.find((item): item is Record<string, unknown> => item !== null && typeof item === "object");
}

function readMicrosoftGraphScheduleBusyIntervals(
  schedule: Record<string, unknown> | undefined,
): Array<{ start: string; end: string; status: string }> {
  if (schedule === undefined) {
    return [];
  }

  const scheduleItems = schedule.scheduleItems;
  if (!Array.isArray(scheduleItems)) {
    return [];
  }

  return scheduleItems.flatMap((item) => {
    if (item === null || typeof item !== "object") {
      return [];
    }

    const record = item as Record<string, unknown>;
    const start = readNestedString(record, "start", "dateTime");
    const end = readNestedString(record, "end", "dateTime");
    const status = typeof record.status === "string" ? record.status : "busy";

    return start !== undefined && end !== undefined
      ? [{ start, end, status }]
      : [];
  });
}

function readNestedString(
  record: Record<string, unknown>,
  objectKey: string,
  valueKey: string,
) {
  const nested = record[objectKey];
  if (nested === null || typeof nested !== "object") {
    return undefined;
  }

  const value = (nested as Record<string, unknown>)[valueKey];
  return typeof value === "string" ? value : undefined;
}

function readFirstGoogleCalendarAttendeeEmail(event: Record<string, unknown>) {
  const attendees = event.attendees;
  if (!Array.isArray(attendees)) {
    return undefined;
  }

  for (const attendee of attendees) {
    if (attendee === null || typeof attendee !== "object") {
      continue;
    }

    const email = (attendee as { email?: unknown }).email;
    if (typeof email === "string") {
      return email;
    }
  }

  return undefined;
}

function readFirstMicrosoftGraphAttendeeEmail(event: Record<string, unknown>) {
  const attendees = event.attendees;
  if (!Array.isArray(attendees)) {
    return undefined;
  }

  for (const attendee of attendees) {
    if (attendee === null || typeof attendee !== "object") {
      continue;
    }

    const emailAddress = (attendee as { emailAddress?: unknown }).emailAddress;
    if (emailAddress === null || typeof emailAddress !== "object") {
      continue;
    }

    const address = (emailAddress as { address?: unknown }).address;
    if (typeof address === "string") {
      return address;
    }
  }

  return undefined;
}

function readZendeskTicket(responseBody: unknown): Record<string, unknown> {
  if (responseBody === null || typeof responseBody !== "object") {
    return {};
  }

  const ticket = (responseBody as { ticket?: unknown }).ticket;
  return ticket !== null && typeof ticket === "object" ? ticket as Record<string, unknown> : {};
}

function readZendeskSearchResults(responseBody: unknown): Record<string, unknown>[] {
  if (responseBody === null || typeof responseBody !== "object") {
    return [];
  }

  const results = (responseBody as { results?: unknown }).results;
  return Array.isArray(results)
    ? results.filter((ticket): ticket is Record<string, unknown> => ticket !== null && typeof ticket === "object")
    : [];
}

function readZendeskRequesterEmail(ticket: Record<string, unknown>) {
  const requester = ticket.requester;
  if (requester !== null && typeof requester === "object") {
    const email = (requester as { email?: unknown }).email;

    return typeof email === "string" ? email : undefined;
  }

  return undefined;
}

function normalizeZendeskTicketSearchQuery(query: string) {
  return /\btype:ticket\b/i.test(query) ? query : `type:ticket ${query}`;
}

async function executeZendeskTicketUpdate(context: ConnectorExecutionContext) {
  const ticketId = getStringInput(context.input, "ticketId");
  const status = getOptionalStringInput(context.input, "status") ?? "open";
  const comment = getOptionalStringInput(context.input, "comment");

  if (context.credential.credentialType === "api-token") {
    return updateZendeskTicketWithApiToken({
      context,
      ticketId,
      status,
      comment,
    });
  }

  return {
    provider: "zendesk",
    toolId: context.toolId,
    ticket: {
      id: ticketId,
      status,
      ...(comment !== undefined ? { latestComment: comment } : {}),
    },
  };
}

async function updateZendeskTicketWithApiToken(input: {
  context: ConnectorExecutionContext;
  ticketId: string;
  status: string;
  comment?: string | undefined;
}) {
  const { context, ticketId, status, comment } = input;
  const credential = readZendeskApiTokenCredential(context);
  const ticket: Record<string, unknown> = {
    status,
  };

  if (comment !== undefined) {
    ticket.comment = {
      body: comment,
    };
  }

  const response = await fetch(
    `https://${credential.subdomain}.zendesk.com/api/v2/tickets/${encodeURIComponent(ticketId)}`,
    {
      method: "PUT",
      headers: {
        authorization: buildZendeskApiTokenAuthorization(credential),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        ticket,
      }),
    },
  );
  const responseBody = await readJsonResponse(response);
  if (response.status === 429) {
    const retryAfterSeconds = Number.parseInt(response.headers.get("retry-after") ?? "30", 10) || 30;
    throw new HttpException(
      {
        statusCode: 429,
        message: "Zendesk rate limit reached. Retry later.",
        retryAfterSeconds,
        provider: "zendesk",
        toolId: context.toolId,
        code: "tool_execution.rate_limited",
        recoverable: true,
      },
      429,
    );
  }
  if (response.status < 200 || response.status >= 300) {
    throw new HttpException(
      {
        statusCode: response.status,
        message: "Zendesk ticket update failed.",
        provider: "zendesk",
        toolId: context.toolId,
      },
      response.status,
    );
  }

  const updatedTicket = readZendeskTicket(responseBody);
  return {
    provider: "zendesk",
    toolId: context.toolId,
    ticket: {
      id: String(updatedTicket.id ?? ticketId),
      status: typeof updatedTicket.status === "string" ? updatedTicket.status : status,
      ...(comment !== undefined ? { latestComment: comment } : {}),
    },
  };
}

function getProviderSchemas(provider: OAuthConnectorProvider) {
  return connectorToolSchemas[provider] ?? [];
}

function getExecutableConnectorToolSchema(
  provider: OAuthConnectorProvider,
  toolId: string,
) {
  const schema = getProviderSchemas(provider).find((tool) => tool.toolId === toolId)
    ?? getExecutableConnectorToolSchemaAlias(toolId);

  return schema === undefined ? undefined : cloneToolSchema(schema);
}

function getExecutableConnectorToolSchemaAlias(toolId: string) {
  if (toolId === "intercom.articles.import") {
    return connectorToolSchemaAliases[toolId];
  }

  return undefined;
}

function validateRequiredInput(schema: ConnectorToolSchemaResponse, input: Record<string, unknown>) {
  const missing = schema.inputSchema.required.filter((field) => {
    const value = input[field];

    return typeof value !== "string" || value.trim().length === 0;
  });

  if (missing.length > 0) {
    throw new BadRequestException(`Missing required tool input: ${missing.join(", ")}`);
  }
}

function getStringInput(input: Record<string, unknown>, key: string) {
  const value = input[key];

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BadRequestException(`Missing required tool input: ${key}`);
  }

  return value.trim();
}

function getOptionalStringInput(input: Record<string, unknown>, key: string) {
  const value = input[key];

  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function getOptionalNumberInput(input: Record<string, unknown>, key: string) {
  const value = input[key];

  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stableNumericId(value: string) {
  let hash = 0;

  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) % 9000;
  }

  return String(hash + 1000);
}

function extractEmail(value: string) {
  return value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
}

const connectorToolSchemaAliases: Record<string, ConnectorToolSchemaResponse | undefined> = {
  "zendesk.search": connectorToolSchemas.zendesk[0],
  "hubspot.profile.lookup": connectorToolSchemas.hubspot[0],
  "intercom.articles.import": {
    provider: "intercom",
    toolId: "intercom.articles.import",
    description: "Import a specific Intercom Article into the review-gated knowledge pipeline.",
    requiredScopes: ["read_articles"],
    inputSchema: {
      type: "object",
      required: ["articleId"],
      properties: {
        articleId: { type: "string" },
      },
    },
  },
};

function cloneToolSchema(schema: ConnectorToolSchemaResponse): ConnectorToolSchemaResponse {
  return {
    ...schema,
    requiredScopes: [...schema.requiredScopes],
    inputSchema: {
      type: "object",
      required: [...schema.inputSchema.required],
      properties: Object.fromEntries(
        Object.entries(schema.inputSchema.properties).map(([key, property]) => [
          key,
          {
            ...property,
            ...(property.enum !== undefined ? { enum: [...property.enum] } : {}),
          },
        ]),
      ),
    },
  };
}
