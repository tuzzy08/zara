import { MailPlus, UserPlus, XCircle } from "lucide-react";
import type { ZaraInvitation } from "@zara/auth-client";
import type { TenantRole } from "@zara/core";

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
    <section className="surface-card workspace-settings-card">
      <div className="workspace-settings-card-header">
        <div>
          <div className="eyebrow-copy">Invitations</div>
          <div className="subhead-copy mt-1">Invite teammate</div>
        </div>
        <MailPlus size={16} />
      </div>

      <div className="workspace-members-toolbar subtle-panel">
        <label className="workspace-settings-field">
          <span>Invite email</span>
          <input value={inviteEmail} onChange={(event) => onInviteEmailChange(event.target.value)} />
        </label>
        <label className="workspace-settings-field">
          <span>Tenant role</span>
          <select value={inviteTenantRole} onChange={(event) => onInviteTenantRoleChange(event.target.value as TenantRole)}>
            {tenantRoleOrder.map((role) => (
              <option key={role} value={role}>
                {formatTenantRole(role)}
              </option>
            ))}
          </select>
        </label>
        <label className="workspace-settings-field">
          <span>Workspace role</span>
          <select value={inviteWorkspaceRole} onChange={(event) => onInviteWorkspaceRoleChange(event.target.value as TenantRole)}>
            {tenantRoleOrder.map((role) => (
              <option key={role} value={role}>
                {formatTenantRole(role)}
              </option>
            ))}
          </select>
        </label>
        <button
          className="workflow-button workflow-button-primary"
          type="button"
          disabled={pendingAction !== null || inviteEmail.trim().length === 0}
          onClick={onSendInvitation}
        >
          <UserPlus size={15} />
          <span>Send invitation</span>
        </button>
      </div>

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
                <button
                  className="workflow-button"
                  type="button"
                  disabled={pendingAction !== null}
                  onClick={() => onRevokeInvitation(invitation)}
                >
                  <XCircle size={15} />
                  <span>{`Revoke invitation for ${invitation.email}`}</span>
                </button>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
