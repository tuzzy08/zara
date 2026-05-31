import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { tenantRoles, type TenantRole } from "@zara/core";

import { WorkspacesService } from "../workspaces/workspaces.service";
import {
  AuthInvitationsGateway,
  type AuthInvitationsHttpRequest,
  type AuthInvitationsHttpResponse,
  type AuthInvitationsSessionGateway,
  type AuthOperationFailure,
} from "./auth-invitations.gateway";

type InvitationStatus = "pending" | "accepted" | "revoked";
type InvitationAuditAction =
  | "invitation.created"
  | "invitation.accepted"
  | "invitation.revoked"
  | "workspace_access.granted";

export interface InvitationAuditEntry {
  action: InvitationAuditAction;
  actorUserId: string;
  at: string;
  summary: string;
}

export interface InvitationWorkspaceAccess {
  workspaceId: string;
  role: TenantRole;
}

export interface ProductInvitation {
  id: string;
  email: string;
  organizationId: string;
  role: TenantRole;
  status: InvitationStatus;
  inviterId: string;
  expiresAt: string;
  createdAt: string;
  workspaceAccess: InvitationWorkspaceAccess | null;
  audit: InvitationAuditEntry[];
}

export interface AuthenticatedInvitationUser {
  id: string;
  email: string;
  name: string;
}

export interface AuthInvitationsResponse {
  ok: true;
  invitation: ProductInvitation;
}

export interface AuthInvitationAcceptResponse {
  ok: true;
  invitation: ProductInvitation;
  user: AuthenticatedInvitationUser;
  activeOrganization: {
    id: string;
    name: string;
    role: TenantRole;
  };
  activeWorkspace: {
    id: string;
    name: string;
  } | null;
}

interface InvitationRecord extends ProductInvitation {}

@Injectable()
export class AuthInvitationsService {
  private readonly records = new Map<string, InvitationRecord>();

  constructor(
    private readonly gateway: AuthInvitationsGateway,
    private readonly workspacesService: WorkspacesService,
  ) {}

  async create(
    request: AuthInvitationsHttpRequest,
    response: AuthInvitationsHttpResponse,
    input: unknown,
  ): Promise<AuthInvitationsResponse> {
    const normalizedInput = normalizeCreateInput(input);
    const session = this.gateway.createSession(request, response);
    const actor = await requireAuthenticatedUser(session);

    if (normalizedInput.workspaceAccess !== null) {
      this.requireActiveWorkspace(normalizedInput.organizationId, normalizedInput.workspaceAccess.workspaceId);
    }

    const invitationResult = await session.createInvitation({
      organizationId: normalizedInput.organizationId,
      email: normalizedInput.email,
      role: normalizedInput.role,
      ...(normalizedInput.workspaceAccess === null
        ? {}
        : {
            workspaceId: normalizedInput.workspaceAccess.workspaceId,
            workspaceRole: normalizedInput.workspaceAccess.role,
          }),
    });

    if (!invitationResult.ok) {
      throw mapInvitationFailure(invitationResult, "create");
    }

    const invitation = normalizeInvitation(invitationResult.body, normalizedInput.workspaceAccess);
    const record: InvitationRecord = {
      ...invitation,
      status: "pending",
      audit: [
        buildAuditEntry({
          action: "invitation.created",
          actorUserId: actor.id,
          summary: `Created invitation for ${invitation.email}.`,
        }),
      ],
    };

    this.records.set(record.id, record);

    return {
      ok: true,
      invitation: cloneInvitation(record),
    };
  }

  async list(
    request: AuthInvitationsHttpRequest,
    response: AuthInvitationsHttpResponse,
    organizationId: string,
  ) {
    const normalizedOrganizationId = organizationId.trim();

    if (normalizedOrganizationId.length === 0) {
      throw new BadRequestException(invitationError("organization_required", "Choose a tenant organization.", false));
    }

    const session = this.gateway.createSession(request, response);
    const invitationsResult = await session.listInvitations({ organizationId: normalizedOrganizationId });

    if (!invitationsResult.ok) {
      throw mapInvitationFailure(invitationsResult, "list");
    }

    return {
      ok: true,
      invitations: invitationsResult.body.map((rawInvitation) => {
        const raw = normalizeInvitation(rawInvitation, null);
        const existing = this.records.get(raw.id);
        const record = existing ?? {
          ...raw,
          status: mapProviderStatus(stringValue(asRecord(rawInvitation)["status"])),
          audit: [],
        };

        return cloneInvitation(record);
      }),
    };
  }

  async revoke(
    request: AuthInvitationsHttpRequest,
    response: AuthInvitationsHttpResponse,
    invitationId: string,
  ): Promise<AuthInvitationsResponse> {
    const normalizedInvitationId = normalizeInvitationId(invitationId);
    const session = this.gateway.createSession(request, response);
    const actor = await requireAuthenticatedUser(session);
    const revokeResult = await session.cancelInvitation({ invitationId: normalizedInvitationId });

    if (!revokeResult.ok) {
      throw mapInvitationFailure(revokeResult, "revoke");
    }

    const rawInvitation = normalizeInvitation(revokeResult.body, this.records.get(normalizedInvitationId)?.workspaceAccess ?? null);
    const existingRecord = this.records.get(rawInvitation.id);
    const record: InvitationRecord = {
      ...rawInvitation,
      status: "revoked",
      audit: [
        buildAuditEntry({
          action: "invitation.revoked",
          actorUserId: actor.id,
          summary: `Revoked invitation for ${rawInvitation.email}.`,
        }),
        ...(existingRecord?.audit ?? []),
      ],
    };

    this.records.set(record.id, record);

    return {
      ok: true,
      invitation: cloneInvitation(record),
    };
  }

  async accept(
    request: AuthInvitationsHttpRequest,
    response: AuthInvitationsHttpResponse,
    invitationId: string,
    input: unknown,
  ): Promise<AuthInvitationAcceptResponse> {
    const normalizedInvitationId = normalizeInvitationId(invitationId);
    const normalizedInput = normalizeAcceptInput(input);
    const session = this.gateway.createSession(request, response);
    const user = await authenticateRecipient(session, normalizedInput);
    const existingRecord = this.records.get(normalizedInvitationId);

    assertInvitationCanBeAccepted(existingRecord);

    const acceptResult = await session.acceptInvitation({ invitationId: normalizedInvitationId });

    if (!acceptResult.ok) {
      throw mapAcceptFailure(acceptResult, existingRecord);
    }

    const acceptedPayload = asRecord(acceptResult.body);
    const rawInvitationValue = acceptedPayload["invitation"];
    const member = asRecord(acceptedPayload["member"]);
    const rawInvitation = normalizeInvitation(rawInvitationValue, existingRecord?.workspaceAccess ?? null);
    const role = normalizeTenantRole(member["role"]) ?? rawInvitation.role;
    const acceptedAudit = [
      buildAuditEntry({
        action: "invitation.accepted",
        actorUserId: user.id,
        summary: `Accepted invitation for ${rawInvitation.email}.`,
      }),
      ...(existingRecord?.audit ?? []),
    ];
    const activeWorkspace = rawInvitation.workspaceAccess === null
      ? null
      : this.grantWorkspaceAccess({
          organizationId: rawInvitation.organizationId,
          userId: user.id,
          actorUserId: user.id,
          workspaceAccess: rawInvitation.workspaceAccess,
        });
    const nextAudit = rawInvitation.workspaceAccess === null
      ? acceptedAudit
      : [
          buildAuditEntry({
            action: "workspace_access.granted",
            actorUserId: user.id,
            summary: `Granted ${rawInvitation.workspaceAccess.role} access to ${rawInvitation.workspaceAccess.workspaceId}.`,
          }),
          ...acceptedAudit,
        ];
    const record: InvitationRecord = {
      ...rawInvitation,
      status: "accepted",
      role,
      audit: nextAudit,
    };
    const organizationName = await resolveOrganizationName(session, rawInvitation.organizationId);

    this.records.set(record.id, record);

    return {
      ok: true,
      invitation: cloneInvitation(record),
      user,
      activeOrganization: {
        id: rawInvitation.organizationId,
        name: organizationName,
        role,
      },
      activeWorkspace,
    };
  }

  private requireActiveWorkspace(organizationId: string, workspaceId: string) {
    const workspace = this.workspacesService.getWorkspaceState(organizationId).workspaces.find(
      (candidate) => candidate.id === workspaceId && candidate.tenantId === organizationId,
    );

    if (workspace === undefined || workspace.status !== "active") {
      throw new BadRequestException(invitationError(
        "invitation_workspace_unavailable",
        "Choose an active workspace in the invited tenant.",
        false,
      ));
    }
  }

  private grantWorkspaceAccess(input: {
    organizationId: string;
    userId: string;
    actorUserId: string;
    workspaceAccess: InvitationWorkspaceAccess;
  }) {
    try {
      const state = this.workspacesService.setMembershipRole({
        organizationId: input.organizationId,
        workspaceId: input.workspaceAccess.workspaceId,
        userId: input.userId,
        role: input.workspaceAccess.role,
        actorUserId: input.actorUserId,
      });
      const workspace = state.workspaces.find((candidate) => candidate.id === input.workspaceAccess.workspaceId);

      return workspace === undefined
        ? null
        : {
            id: workspace.id,
            name: workspace.name,
          };
    } catch (error) {
      throw new ConflictException({
        ...invitationError(
          "invitation_workspace_access_failed",
          error instanceof Error ? error.message : "Invitation was accepted but workspace access could not be granted.",
          true,
        ),
        invitation: {
          status: "accepted",
          workspaceAccess: input.workspaceAccess,
        },
      });
    }
  }
}

function normalizeCreateInput(input: unknown) {
  const record = asRecord(input);
  const organizationId = stringValue(record["organizationId"]).trim();
  const email = stringValue(record["email"]).trim().toLowerCase();
  const role = requireTenantRole(record["role"], "role");
  const workspaceAccess = normalizeWorkspaceAccess(record["workspaceAccess"]);

  if (organizationId.length === 0) {
    throw new BadRequestException(invitationError("organization_required", "Choose a tenant organization.", false));
  }

  if (email.length === 0) {
    throw new BadRequestException(invitationError("invitation_email_required", "Enter the teammate email to invite.", false));
  }

  return {
    organizationId,
    email,
    role,
    workspaceAccess,
  };
}

function normalizeAcceptInput(input: unknown) {
  const record = asRecord(input);
  const email = stringValue(record["email"]).trim().toLowerCase();
  const password = stringValue(record["password"]);
  const name = stringValue(record["name"]).trim();

  if (email.length === 0 && password.length === 0 && name.length === 0) {
    return null;
  }

  if (email.length === 0 || password.length === 0) {
    throw new BadRequestException(invitationError(
      "invitation_auth_required",
      "Sign in or provide an email and password to accept this invitation.",
      false,
    ));
  }

  return {
    email,
    password,
    name: name || email,
  };
}

function normalizeWorkspaceAccess(value: unknown): InvitationWorkspaceAccess | null {
  const record = asRecord(value);
  const workspaceId = stringValue(record["workspaceId"]).trim();

  if (workspaceId.length === 0) {
    return null;
  }

  return {
    workspaceId,
    role: requireTenantRole(record["role"], "workspaceAccess.role"),
  };
}

function normalizeInvitation(value: unknown, fallbackWorkspaceAccess: InvitationWorkspaceAccess | null): ProductInvitation {
  const record = asRecord(value);
  const id = stringValue(record["id"]);
  const email = stringValue(record["email"]).toLowerCase();
  const organizationId = stringValue(record["organizationId"]);
  const role = requireTenantRole(record["role"], "role");
  const inviterId = stringValue(record["inviterId"]);
  const expiresAt = dateValue(record["expiresAt"]);
  const createdAt = dateValue(record["createdAt"]);
  const workspaceId = stringValue(record["workspaceId"]);
  const workspaceRole = normalizeTenantRole(record["workspaceRole"]);

  if (
    id.length === 0 ||
    email.length === 0 ||
    organizationId.length === 0 ||
    inviterId.length === 0 ||
    expiresAt.length === 0 ||
    createdAt.length === 0
  ) {
    throw new ConflictException(invitationError(
      "invitation_provider_payload_invalid",
      "The auth provider returned an incomplete invitation payload.",
      true,
    ));
  }

  return {
    id,
    email,
    organizationId,
    role,
    status: mapProviderStatus(stringValue(record["status"])),
    inviterId,
    expiresAt,
    createdAt,
    workspaceAccess: workspaceId.length > 0 && workspaceRole !== null
      ? {
          workspaceId,
          role: workspaceRole,
        }
      : fallbackWorkspaceAccess,
    audit: [],
  };
}

async function authenticateRecipient(
  session: AuthInvitationsSessionGateway,
  input: ReturnType<typeof normalizeAcceptInput>,
): Promise<AuthenticatedInvitationUser> {
  const sessionResult = await session.getSession();
  const currentUser = sessionResult.ok ? normalizeUser(asRecord(sessionResult.body)["user"]) : null;

  if (currentUser !== null) {
    return currentUser;
  }

  if (input === null) {
    throw new UnauthorizedException(invitationError(
      "invitation_auth_required",
      "Sign in or provide an email and password to accept this invitation.",
      false,
    ));
  }

  const signupResult = await session.signUpEmail({
    email: input.email,
    password: input.password,
    name: input.name,
  });

  if (signupResult.ok) {
    return normalizeRequiredUser(signupResult.body);
  }

  const signinResult = await session.signInEmail({
    email: input.email,
    password: input.password,
  });

  if (signinResult.ok) {
    return normalizeRequiredUser(signinResult.body);
  }

  throw new UnauthorizedException(invitationError(
    "invitation_auth_failed",
    signupResult.message,
    false,
  ));
}

async function requireAuthenticatedUser(session: AuthInvitationsSessionGateway) {
  const sessionResult = await session.getSession();
  const user = sessionResult.ok ? normalizeUser(asRecord(sessionResult.body)["user"]) : null;

  if (user === null) {
    throw new UnauthorizedException(invitationError(
      "invitation_auth_required",
      "Sign in before managing invitations.",
      false,
    ));
  }

  return user;
}

async function resolveOrganizationName(session: AuthInvitationsSessionGateway, organizationId: string) {
  const organizationResult = await session.getFullOrganization({ organizationId });

  if (!organizationResult.ok) {
    return organizationId;
  }

  return stringValue(asRecord(organizationResult.body)["name"]) || organizationId;
}

function assertInvitationCanBeAccepted(record: InvitationRecord | undefined) {
  if (record === undefined) {
    return;
  }

  if (record.status === "revoked") {
    throw new GoneException(invitationError("invitation_revoked", "This invitation has been revoked.", false));
  }

  if (record.status === "accepted") {
    throw new ConflictException(invitationError("invitation_already_accepted", "This invitation has already been accepted.", false));
  }

  if (new Date(record.expiresAt).getTime() <= Date.now()) {
    throw new GoneException(invitationError("invitation_expired", "This invitation has expired.", false));
  }
}

function mapAcceptFailure(
  failure: AuthOperationFailure,
  record: InvitationRecord | undefined,
) {
  if (record?.status === "revoked") {
    return new GoneException(invitationError("invitation_revoked", "This invitation has been revoked.", false));
  }

  if (record?.status === "accepted") {
    return new ConflictException(invitationError("invitation_already_accepted", "This invitation has already been accepted.", false));
  }

  if (record !== undefined && new Date(record.expiresAt).getTime() <= Date.now()) {
    return new GoneException(invitationError("invitation_expired", "This invitation has expired.", false));
  }

  if (failure.status === 403) {
    return new ForbiddenException(invitationError(
      "invitation_email_mismatch",
      "Sign in with the invited email address to accept this invitation.",
      false,
    ));
  }

  return mapInvitationFailure(failure, "accept");
}

function mapInvitationFailure(failure: AuthOperationFailure, action: "create" | "list" | "revoke" | "accept") {
  if (failure.status === 401) {
    return new UnauthorizedException(invitationError("invitation_auth_required", failure.message, false));
  }

  if (failure.status === 403) {
    return new ForbiddenException(invitationError("invitation_forbidden", failure.message, false));
  }

  if (
    action === "revoke" &&
    failure.status === 400 &&
    failure.message.toLowerCase().includes("member")
  ) {
    return new ForbiddenException(invitationError("invitation_forbidden", failure.message, false));
  }

  if (action === "accept" && failure.status === 400 && failure.message.toLowerCase().includes("not found")) {
    return new GoneException(invitationError("invitation_expired", "This invitation is no longer available.", false));
  }

  if (failure.status === 400) {
    return new BadRequestException(invitationError("invitation_invalid", failure.message, false));
  }

  return new ConflictException(invitationError("invitation_provider_failed", failure.message, true));
}

function normalizeInvitationId(value: string) {
  const invitationId = value.trim();

  if (invitationId.length === 0) {
    throw new BadRequestException(invitationError("invitation_required", "Choose an invitation.", false));
  }

  return invitationId;
}

function normalizeRequiredUser(value: unknown) {
  const user = normalizeUser(asRecord(value)["user"]);

  if (user === null) {
    throw new ConflictException(invitationError(
      "invitation_user_payload_invalid",
      "Authentication completed without a usable user payload.",
      true,
    ));
  }

  return user;
}

function normalizeUser(value: unknown): AuthenticatedInvitationUser | null {
  const user = asRecord(value);
  const id = stringValue(user["id"]);
  const email = stringValue(user["email"]);
  const name = stringValue(user["name"]) || email;

  if (id.length === 0 || email.length === 0) {
    return null;
  }

  return {
    id,
    email,
    name,
  };
}

function requireTenantRole(value: unknown, fieldName: string): TenantRole {
  const role = normalizeTenantRole(value);

  if (role === null) {
    throw new BadRequestException(invitationError(
      "invitation_role_invalid",
      `${fieldName} must be one of: ${tenantRoles.join(", ")}.`,
      false,
    ));
  }

  return role;
}

function normalizeTenantRole(value: unknown): TenantRole | null {
  return tenantRoles.includes(value as TenantRole) ? value as TenantRole : null;
}

function mapProviderStatus(value: string): InvitationStatus {
  if (value === "accepted") {
    return "accepted";
  }

  if (value === "canceled" || value === "revoked") {
    return "revoked";
  }

  return "pending";
}

function buildAuditEntry(input: {
  action: InvitationAuditAction;
  actorUserId: string;
  summary: string;
}): InvitationAuditEntry {
  return {
    action: input.action,
    actorUserId: input.actorUserId,
    at: new Date().toISOString(),
    summary: input.summary,
  };
}

function invitationError(code: string, message: string, recoverable: boolean) {
  return {
    ok: false,
    code,
    recoverable,
    message,
  };
}

function cloneInvitation(invitation: ProductInvitation): ProductInvitation {
  return {
    ...invitation,
    workspaceAccess: invitation.workspaceAccess === null
      ? null
      : {
          ...invitation.workspaceAccess,
        },
    audit: invitation.audit.map((entry) => ({ ...entry })),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function dateValue(value: unknown) {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return typeof value === "string" ? value : "";
}
