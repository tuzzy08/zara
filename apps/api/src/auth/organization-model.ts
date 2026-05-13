import type { TenantRole } from "@zara/core";
import { organization } from "better-auth/plugins";
import { createAccessControl, type Role } from "better-auth/plugins/access";
import { defaultStatements } from "better-auth/plugins/organization/access";

export const zaraOrganizationStatements = {
  ...defaultStatements,
  workflow: ["read", "write", "publish"],
  monitoring: ["read"],
  integration: ["read", "write"],
  telephony: ["read", "write"],
} as const;

export type ZaraOrganizationResource = keyof typeof zaraOrganizationStatements;
export type ZaraOrganizationPermissionRequest = {
  [TResource in ZaraOrganizationResource]?: Array<
    (typeof zaraOrganizationStatements)[TResource][number]
  >;
};

export interface ZaraOrganizationMembership {
  organizationId: string;
  role: TenantRole;
}

export interface ZaraOrganizationSession {
  userId: string;
  activeOrganizationId: string | null;
  memberships: ZaraOrganizationMembership[];
}

export const zaraOrganizationAccessControl = createAccessControl(zaraOrganizationStatements);

export const zaraOrganizationRoles = {
  owner: zaraOrganizationAccessControl.newRole({
    organization: ["update", "delete"],
    member: ["create", "update", "delete"],
    invitation: ["create", "cancel"],
    team: ["create", "update", "delete"],
    ac: ["create", "read", "update", "delete"],
    workflow: ["read", "write", "publish"],
    monitoring: ["read"],
    integration: ["read", "write"],
    telephony: ["read", "write"],
  }),
  admin: zaraOrganizationAccessControl.newRole({
    organization: ["update"],
    member: ["create", "update", "delete"],
    invitation: ["create", "cancel"],
    team: ["create", "update", "delete"],
    ac: ["read", "update"],
    workflow: ["read", "write", "publish"],
    monitoring: ["read"],
    integration: ["read", "write"],
    telephony: ["read", "write"],
  }),
  builder: zaraOrganizationAccessControl.newRole({
    workflow: ["read", "write", "publish"],
    monitoring: ["read"],
    integration: ["read"],
    telephony: ["read"],
  }),
  operator: zaraOrganizationAccessControl.newRole({
    workflow: ["read"],
    monitoring: ["read"],
    integration: ["read"],
    telephony: ["read", "write"],
  }),
  viewer: zaraOrganizationAccessControl.newRole({
    workflow: ["read"],
    monitoring: ["read"],
    integration: ["read"],
    telephony: ["read"],
  }),
} satisfies Record<TenantRole, Role>;

export const zaraOrganizationPlugin = organization({
  ac: zaraOrganizationAccessControl,
  roles: zaraOrganizationRoles,
  allowUserToCreateOrganization: true,
});
