import { MailPlus, UserPlus, XCircle } from "lucide-react";
import type { ZaraInvitation } from "@zara/auth-client";
import type { TenantRole } from "@zara/core";
import { Button, Card, Field, FieldGroup, FieldLabel, Input, Select } from "@zara/ui";

import { formatInvitationStatus, formatTenantRole, tenantRoleOrder } from "./workspaceSettingsFormatting";
import { WorkspaceSettingsStatusPill } from "./WorkspaceSettingsStatusPill";

export function WorkspaceInvitationsCard({
  inviteEmail,
  inviteTenantRole,
  inviteWorkspaceRole,
  pendingAction,
  visibleInvitations,
  onInviteEmailChange,
  onInviteTenantRoleChange,
  onInviteWorkspaceRoleChange,
  onRevokeInvitation,
  onSendInvitation,
}: {
  inviteEmail: string;
  inviteTenantRole: TenantRole;
  inviteWorkspaceRole: TenantRole;
  pendingAction: string | null;
  visibleInvitations: ZaraInvitation[];
  onInviteEmailChange: (email: string) => void;
  onInviteTenantRoleChange: (role: TenantRole) => void;
  onInviteWorkspaceRoleChange: (role: TenantRole) => void;
  onRevokeInvitation: (invitation: ZaraInvitation) => void;
  onSendInvitation: () => void;
}) {
  return (
    <Card className="surface-card workspace-settings-card">
      <div className="workspace-settings-card-header">
        <div>
          <div className="eyebrow-copy">Invitations</div>
          <div className="subhead-copy mt-1">Invite teammate</div>
        </div>
        <MailPlus size={16} />
      </div>

      <FieldGroup className="workspace-members-toolbar subtle-panel">
        <Field className="workspace-settings-field">
          <FieldLabel htmlFor="workspace-invite-email">Invite email</FieldLabel>
          <Input id="workspace-invite-email" value={inviteEmail} onChange={(event) => onInviteEmailChange(event.target.value)} />
        </Field>
        <Field className="workspace-settings-field">
          <FieldLabel htmlFor="workspace-invite-tenant-role">Tenant role</FieldLabel>
          <Select id="workspace-invite-tenant-role" value={inviteTenantRole} onChange={(event) => onInviteTenantRoleChange(event.target.value as TenantRole)}>
            {tenantRoleOrder.map((role) => (
              <option key={role} value={role}>
                {formatTenantRole(role)}
              </option>
            ))}
          </Select>
        </Field>
        <Field className="workspace-settings-field">
          <FieldLabel htmlFor="workspace-invite-workspace-role">Workspace role</FieldLabel>
          <Select id="workspace-invite-workspace-role" value={inviteWorkspaceRole} onChange={(event) => onInviteWorkspaceRoleChange(event.target.value as TenantRole)}>
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
          disabled={pendingAction !== null || inviteEmail.trim().length === 0}
          onClick={onSendInvitation}
        >
          <UserPlus size={15} />
          <span>Send invitation</span>
        </Button>
      </FieldGroup>

      <div className="workspace-member-list">
        {visibleInvitations.map((invitation) => (
          <div key={invitation.id} className="subtle-panel workspace-member-row">
            <div>
              <div className="panel-title">{invitation.email}</div>
              <div className="panel-meta">
                {formatTenantRole(invitation.role)} tenant - {invitation.workspaceAccess === null ? "No workspace" : `${formatTenantRole(invitation.workspaceAccess.role)} workspace`}
              </div>
            </div>
            <div className="workspace-member-controls">
              <WorkspaceSettingsStatusPill tone={invitation.status === "revoked" ? "red" : invitation.status === "accepted" ? "blue" : "neutral"}>
                {formatInvitationStatus(invitation.status)}
              </WorkspaceSettingsStatusPill>
              {invitation.status === "pending" ? (
                <Button
                  className="workflow-button"
                  variant="outline"
                  type="button"
                  disabled={pendingAction !== null}
                  onClick={() => onRevokeInvitation(invitation)}
                >
                  <XCircle size={15} />
                  <span>{`Revoke invitation for ${invitation.email}`}</span>
                </Button>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
