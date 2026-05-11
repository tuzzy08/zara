import { Injectable } from "@nestjs/common";
import type { TenantRole } from "@zara/core";

import {
  type ZaraOrganizationMembership,
  type ZaraOrganizationPermissionRequest,
  type ZaraOrganizationSession,
  zaraOrganizationRoles,
} from "../organization-model";

export interface OrganizationPermissionCheck {
  organizationId: string;
  permissions: ZaraOrganizationPermissionRequest;
}

@Injectable()
export class OrganizationAccessService {
  listOrganizationIds(session: ZaraOrganizationSession) {
    return session.memberships.map((membership) => membership.organizationId);
  }

  getActiveMembership(session: ZaraOrganizationSession): ZaraOrganizationMembership {
    if (!session.activeOrganizationId) {
      throw new Error("Active organization is required in the session");
    }

    const activeMembership = session.memberships.find(
      (membership) => membership.organizationId === session.activeOrganizationId,
    );

    if (!activeMembership) {
      throw new Error("Active organization membership is missing from the session");
    }

    return activeMembership;
  }

  canAccessOrganizationResource(
    session: ZaraOrganizationSession,
    check: OrganizationPermissionCheck,
  ) {
    return this.runAuthorization(session, check).success;
  }

  assertCanAccessOrganizationResource(
    session: ZaraOrganizationSession,
    check: OrganizationPermissionCheck,
  ) {
    const result = this.runAuthorization(session, check);

    if (!result.success) {
      throw new Error(result.error);
    }
  }

  private runAuthorization(
    session: ZaraOrganizationSession,
    check: OrganizationPermissionCheck,
  ) {
    const activeMembership = this.getActiveMembership(session);

    if (activeMembership.organizationId !== check.organizationId) {
      return {
        success: false as const,
        error: "Active organization does not match the requested organization",
      };
    }

    return authorizeForRole(activeMembership.role, check.permissions);
  }
}

function authorizeForRole(role: TenantRole, permissions: ZaraOrganizationPermissionRequest) {
  switch (role) {
    case "owner":
      return zaraOrganizationRoles.owner.authorize(permissions);
    case "admin":
      return zaraOrganizationRoles.admin.authorize(permissions);
    case "builder":
      return zaraOrganizationRoles.builder.authorize(permissions);
    case "operator":
      return zaraOrganizationRoles.operator.authorize(permissions);
    case "viewer":
      return zaraOrganizationRoles.viewer.authorize(permissions);
  }
}
