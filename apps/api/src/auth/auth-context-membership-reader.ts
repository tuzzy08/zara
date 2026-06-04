import type { TenantRole } from "@zara/core";

interface Queryable {
  query: (
    sql: string,
    values: unknown[],
  ) => Promise<{ rows: MembershipRow[] }>;
}

interface MembershipReaderInput {
  activeOrganizationId: string;
  userId: string;
}

interface MembershipRow {
  organizationId: string;
  organizationName: string;
  role: string;
}

export interface AuthContextOrganization {
  id: string;
  name: string;
  role: TenantRole;
}

export interface AuthContextMembership {
  organizationId: string;
  organizationName: string;
  role: TenantRole;
}

export interface AuthContextMembershipContext {
  activeOrganization: AuthContextOrganization | null;
  memberships: AuthContextMembership[];
}

export class PostgresAuthContextMembershipReader {
  constructor(private readonly database: Queryable) {}

  async readMembershipContext(input: MembershipReaderInput): Promise<AuthContextMembershipContext> {
    const result = await this.database.query(
      `
        select
          organization.id as "organizationId",
          organization.name as "organizationName",
          member.role as "role"
        from "member" member
        inner join "organization" organization
          on organization.id = member."organizationId"
        where member."userId" = $1
        order by organization."createdAt" asc, organization.id asc
      `,
      [input.userId],
    );
    const memberships = normalizeMembershipRows(result.rows);
    const activeMembership = memberships.find(
      (membership) => membership.organizationId === input.activeOrganizationId,
    ) ?? null;

    return {
      activeOrganization: activeMembership === null
        ? null
        : {
            id: activeMembership.organizationId,
            name: activeMembership.organizationName,
            role: activeMembership.role,
          },
      memberships,
    };
  }
}

function normalizeMembershipRows(rows: MembershipRow[]): AuthContextMembership[] {
  return rows.flatMap((row) => {
    const role = normalizeTenantRole(row.role);

    if (role === null || row.organizationId.length === 0 || row.organizationName.length === 0) {
      return [];
    }

    return [{
      organizationId: row.organizationId,
      organizationName: row.organizationName,
      role,
    }];
  });
}

function normalizeTenantRole(value: unknown): TenantRole | null {
  switch (value) {
    case "owner":
    case "admin":
    case "builder":
    case "operator":
    case "viewer":
      return value;
    default:
      return null;
  }
}
