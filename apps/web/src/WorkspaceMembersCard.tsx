import { Shield, UserMinus, UserPlus } from "lucide-react";
import type { TenantRole, WorkspaceDirectoryUser, WorkspaceMembership } from "@zara/core";
import { Button, Card, Field, FieldGroup, FieldLabel, Select } from "@zara/ui";

import { formatTenantRole, tenantRoleOrder } from "./workspaceSettingsFormatting";

export function WorkspaceMembersCard({
  availableUsers,
  directoryUsers,
  effectiveGrantUserId,
  grantRole,
  pendingAction,
  selectedMembers,
  onGrantRole,
  onGrantRoleChange,
  onGrantUserChange,
  onRevokeAccess,
  onUpdateWorkspaceRole,
}: {
  availableUsers: WorkspaceDirectoryUser[];
  directoryUsers: WorkspaceDirectoryUser[];
  effectiveGrantUserId: string;
  grantRole: TenantRole;
  pendingAction: string | null;
  selectedMembers: WorkspaceMembership[];
  onGrantRole: () => void;
  onGrantRoleChange: (role: TenantRole) => void;
  onGrantUserChange: (userId: string) => void;
  onRevokeAccess: (userId: string) => void;
  onUpdateWorkspaceRole: (userId: string, role: TenantRole) => void;
}) {
  return (
    <Card className="surface-card workspace-settings-card">
      <div className="workspace-settings-card-header">
        <div>
          <div className="eyebrow-copy">Members</div>
          <div className="subhead-copy mt-1">Workspace roles</div>
        </div>
        <Shield size={16} />
      </div>

      <FieldGroup className="workspace-members-toolbar subtle-panel">
        <Field className="workspace-settings-field">
          <FieldLabel htmlFor="workspace-available-teammate">Available teammate</FieldLabel>
          <Select id="workspace-available-teammate" value={effectiveGrantUserId} onChange={(event) => onGrantUserChange(event.target.value)}>
            {availableUsers.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field className="workspace-settings-field">
          <FieldLabel htmlFor="workspace-grant-role">Grant role</FieldLabel>
          <Select id="workspace-grant-role" value={grantRole} onChange={(event) => onGrantRoleChange(event.target.value as TenantRole)}>
            {tenantRoleOrder.map((role) => (
              <option key={role} value={role}>
                {formatTenantRole(role)}
              </option>
            ))}
          </Select>
        </Field>
        <Button
          className="workflow-button workflow-button-primary"
          type="button"
          disabled={availableUsers.length === 0 || pendingAction !== null}
          onClick={onGrantRole}
        >
          <UserPlus size={15} />
          <span>Grant workspace role</span>
        </Button>
      </FieldGroup>

      <div className="workspace-member-list">
        {selectedMembers.map((membership) => {
          const user = directoryUsers.find((candidate) => candidate.id === membership.userId);

          return (
            <div key={`${membership.workspaceId}:${membership.userId}`} className="subtle-panel workspace-member-row">
              <div>
                <div className="panel-title">{user?.name ?? membership.userId}</div>
                <div className="panel-meta">{user?.title ?? "Workspace teammate"}</div>
              </div>
              <div className="workspace-member-controls">
                <label className="workspace-inline-field">
                  <span className="sr-only">{`Role for ${user?.name ?? membership.userId}`}</span>
                  <Select
                    aria-label={`Role for ${user?.name ?? membership.userId}`}
                    value={membership.role}
                    disabled={pendingAction !== null}
                    onChange={(event) => onUpdateWorkspaceRole(membership.userId, event.target.value as TenantRole)}
                  >
                    {tenantRoleOrder.map((role) => (
                      <option key={role} value={role}>
                        {formatTenantRole(role)}
                      </option>
                    ))}
                  </Select>
                </label>
                <Button className="workflow-button" variant="outline" type="button" disabled={pendingAction !== null} onClick={() => onRevokeAccess(membership.userId)}>
                  <UserMinus size={15} />
                  <span>{`Revoke access for ${user?.name ?? membership.userId}`}</span>
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
