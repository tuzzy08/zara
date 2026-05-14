import { useEffect, useMemo, useState } from "react";

import { Archive, CheckCheck, RotateCcw, Shield, UserMinus, UserPlus, Users } from "lucide-react";

import {
  archiveWorkspace,
  renameWorkspace,
  restoreWorkspace,
  revokeWorkspaceMembership,
  setWorkspaceMembershipRole,
  type TenantRole,
  type Workspace,
  type WorkspaceAuditAction,
  type WorkspaceAuditEntry,
  type WorkspaceMembership,
} from "@zara/core";

import type { TenantDirectoryUser } from "./workspaceState";
import { tenantId } from "./workspaceState";

export function WorkspaceSettingsScreen({
  activeWorkspaceId,
  workspaces,
  memberships,
  auditEntries,
  directoryUsers,
  onActiveWorkspaceChange,
  onWorkspacesChange,
  onMembershipsChange,
  onAppendAuditEntry,
  showToast,
}: {
  activeWorkspaceId: string;
  workspaces: Workspace[];
  memberships: WorkspaceMembership[];
  auditEntries: WorkspaceAuditEntry[];
  directoryUsers: TenantDirectoryUser[];
  onActiveWorkspaceChange: (workspaceId: string) => void;
  onWorkspacesChange: (workspaces: Workspace[]) => void;
  onMembershipsChange: (memberships: WorkspaceMembership[]) => void;
  onAppendAuditEntry: (entry: {
    workspaceId: string;
    action: WorkspaceAuditAction;
    summary: string;
  }) => void;
  showToast: (message: string) => void;
}) {
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState(activeWorkspaceId);
  const [workspaceName, setWorkspaceName] = useState("");
  const [grantUserId, setGrantUserId] = useState("");
  const [grantRole, setGrantRole] = useState<TenantRole>("viewer");

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

    const workspace = workspaces.find((candidate) => candidate.id === workspaceId);

    setSelectedWorkspaceId(workspaceId);

    if (workspace !== undefined) {
      onAppendAuditEntry({
        workspaceId,
        action: "workspace.accessed",
        summary: `Opened workspace settings for ${workspace.name}.`,
      });
    }
  };

  const saveWorkspaceName = () => {
    try {
      const nextWorkspaces = renameWorkspace({
        workspaces,
        workspaceId: selectedWorkspace.id,
        tenantId,
        nextName: workspaceName,
      });
      const nextWorkspace = nextWorkspaces.find((workspace) => workspace.id === selectedWorkspace.id) ?? selectedWorkspace;

      onWorkspacesChange(nextWorkspaces);
      onAppendAuditEntry({
        workspaceId: selectedWorkspace.id,
        action: "workspace.renamed",
        summary: `Renamed workspace to ${nextWorkspace.name}.`,
      });
      showToast(`Saved ${nextWorkspace.name}.`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Workspace name could not be saved.");
    }
  };

  const archiveSelectedWorkspace = () => {
    try {
      const nextWorkspaces = archiveWorkspace({
        workspaces,
        workspaceId: selectedWorkspace.id,
        tenantId,
        activeSessionCount: 0,
      });

      onWorkspacesChange(nextWorkspaces);
      onAppendAuditEntry({
        workspaceId: selectedWorkspace.id,
        action: "workspace.archived",
        summary: `Archived workspace ${selectedWorkspace.name}.`,
      });

      if (selectedWorkspace.id === activeWorkspaceId) {
        const fallbackWorkspaceId =
          nextWorkspaces.find((workspace) => workspace.status === "active")?.id ?? selectedWorkspace.id;

        onActiveWorkspaceChange(fallbackWorkspaceId);
      }

      showToast(`${selectedWorkspace.name} archived.`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Workspace could not be archived.");
    }
  };

  const restoreSelectedWorkspace = () => {
    try {
      const nextWorkspaces = restoreWorkspace({
        workspaces,
        workspaceId: selectedWorkspace.id,
        tenantId,
      });
      const restoredWorkspace =
        nextWorkspaces.find((workspace) => workspace.id === selectedWorkspace.id) ?? selectedWorkspace;

      onWorkspacesChange(nextWorkspaces);
      onAppendAuditEntry({
        workspaceId: selectedWorkspace.id,
        action: "workspace.restored",
        summary: `Restored workspace ${restoredWorkspace.name}.`,
      });
      showToast(`${restoredWorkspace.name} restored.`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Workspace could not be restored.");
    }
  };

  const grantWorkspaceRole = () => {
    if (grantUserId.length === 0) {
      return;
    }

    const user = directoryUsers.find((candidate) => candidate.id === grantUserId);

    try {
      const nextMemberships = setWorkspaceMembershipRole({
        memberships,
        workspaceId: selectedWorkspace.id,
        tenantId,
        userId: grantUserId,
        role: grantRole,
      });

      onMembershipsChange(nextMemberships);
      onAppendAuditEntry({
        workspaceId: selectedWorkspace.id,
        action: "membership.granted",
        summary: `Granted ${grantRole} access to ${user?.name ?? grantUserId}.`,
      });
      showToast(`Granted ${grantRole} access to ${user?.name ?? grantUserId}.`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Workspace role could not be granted.");
    }
  };

  const updateWorkspaceRole = (userId: string, role: TenantRole) => {
    const user = directoryUsers.find((candidate) => candidate.id === userId);
    const existingMembership = selectedMembers.find((membership) => membership.userId === userId);

    if (existingMembership?.role === role) {
      return;
    }

    try {
      const nextMemberships = setWorkspaceMembershipRole({
        memberships,
        workspaceId: selectedWorkspace.id,
        tenantId,
        userId,
        role,
      });

      onMembershipsChange(nextMemberships);
      onAppendAuditEntry({
        workspaceId: selectedWorkspace.id,
        action: "membership.role_changed",
        summary: `Changed ${user?.name ?? userId} to ${role}.`,
      });
      showToast(`Updated ${user?.name ?? userId} to ${role}.`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Workspace role could not be updated.");
    }
  };

  const revokeAccess = (userId: string) => {
    const user = directoryUsers.find((candidate) => candidate.id === userId);

    try {
      const nextMemberships = revokeWorkspaceMembership({
        memberships,
        workspaceId: selectedWorkspace.id,
        tenantId,
        userId,
      });

      onMembershipsChange(nextMemberships);
      onAppendAuditEntry({
        workspaceId: selectedWorkspace.id,
        action: "membership.revoked",
        summary: `Revoked access for ${user?.name ?? userId}.`,
      });
      showToast(`Revoked access for ${user?.name ?? userId}.`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Workspace access could not be revoked.");
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
                <button className="workflow-button workflow-button-primary" type="button" onClick={saveWorkspaceName}>
                  <CheckCheck size={15} />
                  <span>Save workspace name</span>
                </button>
                {selectedWorkspace.status === "active" ? (
                  <button className="workflow-button" type="button" onClick={archiveSelectedWorkspace}>
                    <Archive size={15} />
                    <span>Archive workspace</span>
                  </button>
                ) : (
                  <button className="workflow-button" type="button" onClick={restoreSelectedWorkspace}>
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
                disabled={availableUsers.length === 0}
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
                          onChange={(event) => updateWorkspaceRole(membership.userId, event.target.value as TenantRole)}
                        >
                          {tenantRoleOrder.map((role) => (
                            <option key={role} value={role}>
                              {formatTenantRole(role)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button className="workflow-button" type="button" onClick={() => revokeAccess(membership.userId)}>
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

function getUserLabel(directoryUsers: TenantDirectoryUser[], userId: string) {
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

function StatusPill({
  children,
  tone,
}: {
  children: string;
  tone: "neutral" | "blue" | "red";
}) {
  return <span className={`status-pill status-pill-${tone}`}>{children}</span>;
}
