import { useEffect, useMemo, useState } from "react";

import { Archive, CheckCheck, MailPlus, RotateCcw, Shield, UserMinus, UserPlus, Users, XCircle } from "lucide-react";
import type { ZaraInvitation, ZaraInvitationWorkspaceAccess } from "@zara/auth-client";

import {
  type TenantRole,
  type Workspace,
  type WorkspaceAuditAction,
  type WorkspaceAuditEntry,
  type WorkspaceDirectoryUser,
  type WorkspaceMembership,
} from "@zara/core";

export function WorkspaceSettingsScreen({
  activeWorkspaceId,
  workspaces,
  memberships,
  auditEntries,
  directoryUsers,
  invitations,
  onRenameWorkspace,
  onArchiveWorkspace,
  onRestoreWorkspace,
  onGrantWorkspaceRole,
  onUpdateWorkspaceRole,
  onRevokeWorkspaceRole,
  onCreateInvitation,
  onRevokeInvitation,
  showToast,
}: {
  activeWorkspaceId: string;
  workspaces: Workspace[];
  memberships: WorkspaceMembership[];
  auditEntries: WorkspaceAuditEntry[];
  directoryUsers: WorkspaceDirectoryUser[];
  invitations: ZaraInvitation[];
  onRenameWorkspace: (workspaceId: string, nextName: string) => Promise<void>;
  onArchiveWorkspace: (workspaceId: string) => Promise<void>;
  onRestoreWorkspace: (workspaceId: string) => Promise<void>;
  onGrantWorkspaceRole: (workspaceId: string, userId: string, role: TenantRole) => Promise<void>;
  onUpdateWorkspaceRole: (workspaceId: string, userId: string, role: TenantRole) => Promise<void>;
  onRevokeWorkspaceRole: (workspaceId: string, userId: string) => Promise<void>;
  onCreateInvitation: (input: {
    email: string;
    role: TenantRole;
    workspaceAccess: ZaraInvitationWorkspaceAccess | null;
  }) => Promise<void>;
  onRevokeInvitation: (invitationId: string) => Promise<void>;
  showToast: (message: string) => void;
}) {
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState(activeWorkspaceId);
  const [workspaceName, setWorkspaceName] = useState("");
  const [grantUserId, setGrantUserId] = useState("");
  const [grantRole, setGrantRole] = useState<TenantRole>("viewer");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteTenantRole, setInviteTenantRole] = useState<TenantRole>("operator");
  const [inviteWorkspaceRole, setInviteWorkspaceRole] = useState<TenantRole>("operator");
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  const selectedWorkspace =
    workspaces.find((workspace) => workspace.id === selectedWorkspaceId)
    ?? workspaces.find((workspace) => workspace.id === activeWorkspaceId)
    ?? workspaces[0]
    ?? null;
  const selectedMembers = useMemo(
    () =>
      memberships
        .filter((membership) => membership.workspaceId === selectedWorkspace?.id)
        .sort((left, right) => {
          const roleOrder = tenantRoleOrder.indexOf(left.role) - tenantRoleOrder.indexOf(right.role);

          if (roleOrder !== 0) {
            return roleOrder;
          }

          return getUserLabel(directoryUsers, left.userId).localeCompare(getUserLabel(directoryUsers, right.userId));
        }),
    [directoryUsers, memberships, selectedWorkspace?.id],
  );
  const availableUsers = useMemo(
    () =>
      directoryUsers.filter(
        (user) => selectedMembers.some((membership) => membership.userId === user.id) === false,
      ),
    [directoryUsers, selectedMembers],
  );
  const selectedAuditEntries = useMemo(
    () =>
      auditEntries
        .filter((entry) => entry.workspaceId === selectedWorkspace?.id)
        .sort((left, right) => right.at.localeCompare(left.at)),
    [auditEntries, selectedWorkspace?.id],
  );
  const visibleInvitations = useMemo(
    () =>
      invitations
        .filter((invitation) =>
          invitation.workspaceAccess === null ||
          invitation.workspaceAccess.workspaceId === selectedWorkspace?.id,
        )
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    [invitations, selectedWorkspace?.id],
  );

  useEffect(() => {
    if (selectedWorkspace === null) {
      return;
    }

    setWorkspaceName(selectedWorkspace.name);
  }, [selectedWorkspace]);

  useEffect(() => {
    if (workspaces.some((workspace) => workspace.id === selectedWorkspaceId)) {
      return;
    }

    setSelectedWorkspaceId(activeWorkspaceId);
  }, [activeWorkspaceId, selectedWorkspaceId, workspaces]);

  useEffect(() => {
    if (availableUsers.some((user) => user.id === grantUserId)) {
      return;
    }

    setGrantUserId(availableUsers[0]?.id ?? "");
  }, [availableUsers, grantUserId]);

  if (selectedWorkspace === null) {
    return null;
  }

  const handleWorkspaceSelection = (workspaceId: string) => {
    if (workspaceId === selectedWorkspaceId) {
      return;
    }

    setSelectedWorkspaceId(workspaceId);
  };

  const saveWorkspaceName = async () => {
    setPendingAction("rename");

    try {
      await onRenameWorkspace(selectedWorkspace.id, workspaceName);
      showToast(`Saved ${workspaceName.trim()}.`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Workspace name could not be saved.");
    } finally {
      setPendingAction(null);
    }
  };

  const archiveSelectedWorkspace = async () => {
    setPendingAction("archive");

    try {
      await onArchiveWorkspace(selectedWorkspace.id);
      showToast(`${selectedWorkspace.name} archived.`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Workspace could not be archived.");
    } finally {
      setPendingAction(null);
    }
  };

  const restoreSelectedWorkspace = async () => {
    setPendingAction("restore");

    try {
      await onRestoreWorkspace(selectedWorkspace.id);
      showToast(`${selectedWorkspace.name} restored.`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Workspace could not be restored.");
    } finally {
      setPendingAction(null);
    }
  };

  const grantWorkspaceRole = async () => {
    if (grantUserId.length === 0) {
      return;
    }

    const user = directoryUsers.find((candidate) => candidate.id === grantUserId);
    setPendingAction("grant");

    try {
      await onGrantWorkspaceRole(selectedWorkspace.id, grantUserId, grantRole);
      showToast(`Granted ${grantRole} access to ${user?.name ?? grantUserId}.`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Workspace role could not be granted.");
    } finally {
      setPendingAction(null);
    }
  };

  const sendInvitation = async () => {
    const email = inviteEmail.trim().toLowerCase();

    if (email.length === 0) {
      showToast("Enter a teammate email.");
      return;
    }

    setPendingAction("invite");

    try {
      await onCreateInvitation({
        email,
        role: inviteTenantRole,
        workspaceAccess: {
          workspaceId: selectedWorkspace.id,
          role: inviteWorkspaceRole,
        },
      });
      setInviteEmail("");
      showToast(`Invitation sent to ${email}.`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Invitation could not be sent.");
    } finally {
      setPendingAction(null);
    }
  };

  const revokeInvitation = async (invitation: ZaraInvitation) => {
    setPendingAction(`revoke-invite:${invitation.id}`);

    try {
      await onRevokeInvitation(invitation.id);
      showToast(`Revoked invitation for ${invitation.email}.`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Invitation could not be revoked.");
    } finally {
      setPendingAction(null);
    }
  };

  const updateWorkspaceRole = async (userId: string, role: TenantRole) => {
    const user = directoryUsers.find((candidate) => candidate.id === userId);
    const existingMembership = selectedMembers.find((membership) => membership.userId === userId);

    if (existingMembership?.role === role) {
      return;
    }

    setPendingAction(`role:${userId}`);

    try {
      await onUpdateWorkspaceRole(selectedWorkspace.id, userId, role);
      showToast(`Updated ${user?.name ?? userId} to ${role}.`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Workspace role could not be updated.");
    } finally {
      setPendingAction(null);
    }
  };

  const revokeAccess = async (userId: string) => {
    const user = directoryUsers.find((candidate) => candidate.id === userId);
    setPendingAction(`revoke:${userId}`);

    try {
      await onRevokeWorkspaceRole(selectedWorkspace.id, userId);
      showToast(`Revoked access for ${user?.name ?? userId}.`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Workspace access could not be revoked.");
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <div className="workspace-settings-page">
      <div className="workspace-settings-grid">
        <section className="surface-card workspace-directory-card">
          <div className="workspace-settings-card-header">
            <div>
              <div className="eyebrow-copy">Workspaces</div>
              <div className="subhead-copy mt-1">Workspace directory</div>
            </div>
            <Users size={16} />
          </div>

          <div className="workspace-directory-list">
            {workspaces.map((workspace) => (
              <button
                key={workspace.id}
                className={`workspace-directory-item ${workspace.id === selectedWorkspace.id ? "workspace-directory-item-active" : ""}`}
                type="button"
                onClick={() => handleWorkspaceSelection(workspace.id)}
              >
                <div>
                  <div className="panel-title">{workspace.name}</div>
                  <div className="panel-meta">{workspace.slug}</div>
                </div>
                <StatusPill tone={workspace.status === "archived" ? "red" : workspace.id === activeWorkspaceId ? "blue" : "neutral"}>
                  {workspace.status === "archived" ? "Archived" : workspace.id === activeWorkspaceId ? "Active" : "Standby"}
                </StatusPill>
              </button>
            ))}
          </div>
        </section>

        <div className="workspace-settings-main">
          <section className="surface-card workspace-settings-card">
            <div className="workspace-settings-card-header">
              <div>
                <div className="eyebrow-copy">Workspace access</div>
                <div className="subhead-copy mt-1">{selectedWorkspace.name}</div>
              </div>
              <StatusPill tone={selectedWorkspace.status === "archived" ? "red" : "blue"}>
                {selectedWorkspace.status === "archived" ? "Archived" : "Active"}
              </StatusPill>
            </div>

            <div className="workspace-settings-form-grid">
              <label className="workspace-settings-field">
                <span>Workspace name</span>
                <input value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} />
              </label>
              <div className="workspace-settings-actions">
                <button className="workflow-button workflow-button-primary" type="button" onClick={saveWorkspaceName} disabled={pendingAction !== null}>
                  <CheckCheck size={15} />
                  <span>Save workspace name</span>
                </button>
                {selectedWorkspace.status === "active" ? (
                  <button className="workflow-button" type="button" onClick={archiveSelectedWorkspace} disabled={pendingAction !== null}>
                    <Archive size={15} />
                    <span>Archive workspace</span>
                  </button>
                ) : (
                  <button className="workflow-button" type="button" onClick={restoreSelectedWorkspace} disabled={pendingAction !== null}>
                    <RotateCcw size={15} />
                    <span>Restore workspace</span>
                  </button>
                )}
              </div>
            </div>
          </section>

          <section className="surface-card workspace-settings-card">
            <div className="workspace-settings-card-header">
              <div>
                <div className="eyebrow-copy">Members</div>
                <div className="subhead-copy mt-1">Workspace roles</div>
              </div>
              <Shield size={16} />
            </div>

            <div className="workspace-members-toolbar subtle-panel">
              <label className="workspace-settings-field">
                <span>Available teammate</span>
                <select value={grantUserId} onChange={(event) => setGrantUserId(event.target.value)}>
                  {availableUsers.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="workspace-settings-field">
                <span>Grant role</span>
                <select value={grantRole} onChange={(event) => setGrantRole(event.target.value as TenantRole)}>
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
                disabled={availableUsers.length === 0 || pendingAction !== null}
                onClick={grantWorkspaceRole}
              >
                <UserPlus size={15} />
                <span>Grant workspace role</span>
              </button>
            </div>

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
                        <select
                          aria-label={`Role for ${user?.name ?? membership.userId}`}
                          value={membership.role}
                          disabled={pendingAction !== null}
                          onChange={(event) => updateWorkspaceRole(membership.userId, event.target.value as TenantRole)}
                        >
                          {tenantRoleOrder.map((role) => (
                            <option key={role} value={role}>
                              {formatTenantRole(role)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button className="workflow-button" type="button" disabled={pendingAction !== null} onClick={() => revokeAccess(membership.userId)}>
                        <UserMinus size={15} />
                        <span>{`Revoke access for ${user?.name ?? membership.userId}`}</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

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
                <input value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} />
              </label>
              <label className="workspace-settings-field">
                <span>Tenant role</span>
                <select value={inviteTenantRole} onChange={(event) => setInviteTenantRole(event.target.value as TenantRole)}>
                  {tenantRoleOrder.map((role) => (
                    <option key={role} value={role}>
                      {formatTenantRole(role)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="workspace-settings-field">
                <span>Workspace role</span>
                <select value={inviteWorkspaceRole} onChange={(event) => setInviteWorkspaceRole(event.target.value as TenantRole)}>
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
                onClick={sendInvitation}
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
                    <StatusPill tone={invitation.status === "revoked" ? "red" : invitation.status === "accepted" ? "blue" : "neutral"}>
                      {formatInvitationStatus(invitation.status)}
                    </StatusPill>
                    {invitation.status === "pending" ? (
                      <button
                        className="workflow-button"
                        type="button"
                        disabled={pendingAction !== null}
                        onClick={() => revokeInvitation(invitation)}
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

          <section className="surface-card workspace-settings-card">
            <div className="workspace-settings-card-header">
              <div>
                <div className="eyebrow-copy">Audit</div>
                <div className="subhead-copy mt-1">Audit trail</div>
              </div>
              <span className="panel-meta">{selectedAuditEntries.length} entries</span>
            </div>

            <div className="workspace-audit-list">
              {selectedAuditEntries.map((entry) => (
                <article key={entry.id} className="subtle-panel workspace-audit-row">
                  <div className="panel-title">{entry.summary}</div>
                  <div className="panel-meta">
                    {formatAuditAction(entry.action)} - {entry.actorUserId} - {formatAuditTime(entry.at)}
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

const tenantRoleOrder: TenantRole[] = ["owner", "admin", "builder", "operator", "viewer"];

function getUserLabel(directoryUsers: WorkspaceDirectoryUser[], userId: string) {
  return directoryUsers.find((user) => user.id === userId)?.name ?? userId;
}

function formatTenantRole(role: TenantRole) {
  switch (role) {
    case "owner":
      return "Owner";
    case "admin":
      return "Admin";
    case "builder":
      return "Builder";
    case "operator":
      return "Operator";
    default:
      return "Viewer";
  }
}

function formatAuditAction(action: WorkspaceAuditAction) {
  switch (action) {
    case "workspace.accessed":
      return "Access";
    case "workspace.renamed":
      return "Rename";
    case "workspace.archived":
      return "Archive";
    case "workspace.restored":
      return "Restore";
    case "membership.granted":
      return "Grant";
    case "membership.role_changed":
      return "Role";
    default:
      return "Revoke";
  }
}

function formatAuditTime(value: string) {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatInvitationStatus(status: ZaraInvitation["status"]) {
  switch (status) {
    case "accepted":
      return "Accepted";
    case "revoked":
      return "Revoked";
    default:
      return "Pending";
  }
}

function StatusPill({
  children,
  tone,
}: {
  children: string;
  tone: "neutral" | "blue" | "red";
}) {
  return <span className={`status-pill status-pill-${tone}`}>{children}</span>;
}
