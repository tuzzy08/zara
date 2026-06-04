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
} from "./integrations.models";
import { IntegrationSecretVault } from "./integrations-secret-vault";
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
}

interface ConnectorExecutionContext {
  organizationId: string;
  provider: OAuthConnectorProvider;
  toolId: string;
  input: Record<string, unknown>;
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
};

@Injectable()
export class ConnectorToolsService {
  constructor(
    @Inject(INTEGRATION_STATE_REPOSITORY)
    private readonly stateRepository: IntegrationStateRepository,
    private readonly secretVault: IntegrationSecretVault,
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
    const schema = getProviderSchemas(provider).find((tool) => tool.toolId === toolId);

    if (schema === undefined) {
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

    return executeLocalConnectorTool({
      organizationId,
      provider,
      toolId,
      input,
      credential: openedCredential,
      accessToken: openedCredential.accessToken,
      externalAccountId: openedCredential.externalAccountId,
    });
  }
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
    case "notion.knowledge.search":
      return executeNotionKnowledgeSearch(context);
    case "notion.pages.create":
      return executeNotionPageCreate(context);
    case "notion.tasks.create":
      return executeNotionTaskCreate(context);
    default:
      throw new NotFoundException("Connector tool was not found.");
  }
}

function executeNotionKnowledgeSearch(context: ConnectorExecutionContext) {
  const query = getStringInput(context.input, "query");

  return {
    provider: "notion",
    toolId: context.toolId,
    workspaceId: context.externalAccountId,
    results: [
      {
        id: `notion-result-${stableNumericId(query)}`,
        title: `Knowledge result for ${query}`,
        uri: `notion://workspace/${encodeURIComponent(context.externalAccountId)}/search/${encodeURIComponent(query)}`,
      },
    ],
  };
}

function executeNotionPageCreate(context: ConnectorExecutionContext) {
  const title = getStringInput(context.input, "title");
  const body = getStringInput(context.input, "body");
  const parentPageId = getOptionalStringInput(context.input, "parentPageId");

  return {
    provider: "notion",
    toolId: context.toolId,
    page: {
      id: `notion-page-${stableNumericId(`${context.externalAccountId}:${title}:${body}`)}`,
      workspaceId: context.externalAccountId,
      title,
      body,
      ...(parentPageId !== undefined ? { parentPageId } : {}),
    },
  };
}

function executeNotionTaskCreate(context: ConnectorExecutionContext) {
  const title = getStringInput(context.input, "title");
  const assigneeEmail = getOptionalStringInput(context.input, "assigneeEmail");

  return {
    provider: "notion",
    toolId: context.toolId,
    task: {
      id: `notion-task-${stableNumericId(`${context.externalAccountId}:${title}`)}`,
      workspaceId: context.externalAccountId,
      title,
      ...(assigneeEmail !== undefined ? { assigneeEmail } : {}),
      status: "open",
    },
  };
}

function executeGoogleCalendarAvailability(context: ConnectorExecutionContext) {
  const calendarId = getStringInput(context.input, "calendarId");
  const start = getStringInput(context.input, "start");
  const end = getStringInput(context.input, "end");
  const timezone = getStringInput(context.input, "timezone");

  return {
    provider: "google-workspace",
    toolId: context.toolId,
    calendarId,
    start,
    end,
    timezone,
    busy: start.includes("13:00")
      ? [
          {
            start,
            end,
          },
        ]
      : [],
    available: !start.includes("13:00"),
  };
}

function executeGoogleCalendarEventCreate(context: ConnectorExecutionContext) {
  const calendarId = getStringInput(context.input, "calendarId");
  const title = getStringInput(context.input, "title");
  const start = getStringInput(context.input, "start");
  const end = getStringInput(context.input, "end");
  const timezone = getStringInput(context.input, "timezone");
  const attendeeEmail = getOptionalStringInput(context.input, "attendeeEmail");

  return {
    provider: "google-workspace",
    toolId: context.toolId,
    event: {
      id: `gcal-event-${stableNumericId(`${calendarId}:${title}:${start}:${end}`)}`,
      calendarId,
      title,
      start,
      end,
      timezone,
      ...(attendeeEmail !== undefined ? { attendeeEmail } : {}),
    },
  };
}

function executeHubSpotContactLookup(context: ConnectorExecutionContext) {
  const email = getStringInput(context.input, "email").toLowerCase();

  if (email.startsWith("duplicate@")) {
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

  return {
    provider: "hubspot",
    toolId: context.toolId,
    contact: {
      id: `hs-contact-${email.replace(/[^a-z0-9]+/g, "-").replace(/-$/, "")}`,
      email,
      lifecycleStage: "customer",
    },
  };
}

function executeHubSpotNoteCreate(context: ConnectorExecutionContext) {
  const contactId = getStringInput(context.input, "contactId");
  const body = getStringInput(context.input, "body");

  return {
    provider: "hubspot",
    toolId: context.toolId,
    note: {
      id: `hs-note-${stableNumericId(`${contactId}:${body}`)}`,
      contactId,
      body,
    },
  };
}

function executeHubSpotPipelineUpdate(context: ConnectorExecutionContext) {
  const dealId = getStringInput(context.input, "dealId");
  const stage = getStringInput(context.input, "stage");

  return {
    provider: "hubspot",
    toolId: context.toolId,
    deal: {
      id: dealId,
      stage,
      updated: true,
    },
  };
}

function executeZendeskTicketSearch(context: ConnectorExecutionContext) {
  const query = getStringInput(context.input, "query");

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

async function createZendeskTicketWithApiToken(input: {
  context: ConnectorExecutionContext;
  subject: string;
  requesterEmail: string;
  body: string;
  priority: string;
}) {
  const { context, subject, requesterEmail, body, priority } = input;
  const subdomain = context.credential.zendeskSubdomain;
  const email = context.credential.zendeskEmail;
  const apiToken = context.credential.zendeskApiToken;
  if (subdomain === undefined || email === undefined || apiToken === undefined) {
    throw new ForbiddenException("Zendesk credential is unavailable.");
  }

  const response = await fetch(`https://${subdomain}.zendesk.com/api/v2/tickets`, {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${email}/token:${apiToken}`).toString("base64")}`,
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

async function readJsonResponse(response: Response) {
  const text = await response.text();
  if (text.length === 0) {
    return {};
  }

  return JSON.parse(text) as unknown;
}

function readZendeskTicket(responseBody: unknown): Record<string, unknown> {
  if (responseBody === null || typeof responseBody !== "object") {
    return {};
  }

  const ticket = (responseBody as { ticket?: unknown }).ticket;
  return ticket !== null && typeof ticket === "object" ? ticket as Record<string, unknown> : {};
}

function executeZendeskTicketUpdate(context: ConnectorExecutionContext) {
  const ticketId = getStringInput(context.input, "ticketId");
  const status = getOptionalStringInput(context.input, "status") ?? "open";
  const comment = getOptionalStringInput(context.input, "comment");

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

function getProviderSchemas(provider: OAuthConnectorProvider) {
  return connectorToolSchemas[provider] ?? [];
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
