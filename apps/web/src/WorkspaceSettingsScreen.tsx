import { useEffect, useMemo, useReducer } from "react";

import type { ZaraAuthClient, ZaraInvitation, ZaraInvitationWorkspaceAccess, ZaraSessionMetadata } from "@zara/auth-client";

import {
  type TenantRole,
  type Workspace,
  type WorkspaceAuditEntry,
  type WorkspaceDirectoryUser,
  type WorkspaceMembership,
} from "@zara/core";

import { WorkspaceAccessCard } from "./WorkspaceAccessCard";
import { WorkspaceAccountSecurityCard } from "./WorkspaceAccountSecurityCard";
import { WorkspaceAuditCard } from "./WorkspaceAuditCard";
import { WorkspaceDirectoryCard } from "./WorkspaceDirectoryCard";
import { WorkspaceInvitationsCard } from "./WorkspaceInvitationsCard";
import { WorkspaceMembersCard } from "./WorkspaceMembersCard";
import { getUserLabel, tenantRoleOrder } from "./workspaceSettingsFormatting";

interface WorkspaceSettingsState {
  grantRole: TenantRole;
  grantUserId: string;
  inviteEmail: string;
  inviteTenantRole: TenantRole;
  inviteWorkspaceRole: TenantRole;
  pendingAction: string | null;
  selectedWorkspaceDraftId: string;
  sessions: ZaraSessionMetadata[];
  workspaceNameDraft: {
    name: string;
    workspaceId: string;
  };
}

type WorkspaceSettingsAction =
  | { type: "select-workspace"; workspaceId: string }
  | { type: "set-grant-user"; userId: string }
  | { type: "set-grant-role"; role: TenantRole }
  | { type: "set-invite-email"; email: string }
  | { type: "set-invite-tenant-role"; role: TenantRole }
  | { type: "set-invite-workspace-role"; role: TenantRole }
  | { type: "set-sessions"; sessions: ZaraSessionMetadata[] }
  | { type: "remove-session"; sessionId: string }
  | { type: "set-pending-action"; pendingAction: string | null }
  | { type: "sync-workspace-name"; workspaceId: string; name: string }
  | { type: "set-workspace-name"; workspaceId: string; name: string };

const initialWorkspaceSettingsState: WorkspaceSettingsState = {
  grantRole: "viewer",
  grantUserId: "",
  inviteEmail: "",
  inviteTenantRole: "operator",
  inviteWorkspaceRole: "operator",
  pendingAction: null,
  selectedWorkspaceDraftId: "",
  sessions: [],
  workspaceNameDraft: {
    name: "",
    workspaceId: "",
  },
};

function workspaceSettingsReducer(
  state: WorkspaceSettingsState,
  action: WorkspaceSettingsAction,
): WorkspaceSettingsState {
  switch (action.type) {
    case "select-workspace":
      return { ...state, selectedWorkspaceDraftId: action.workspaceId };
    case "set-grant-user":
      return { ...state, grantUserId: action.userId };
    case "set-grant-role":
      return { ...state, grantRole: action.role };
    case "set-invite-email":
      return { ...state, inviteEmail: action.email };
    case "set-invite-tenant-role":
      return { ...state, inviteTenantRole: action.role };
    case "set-invite-workspace-role":
      return { ...state, inviteWorkspaceRole: action.role };
    case "set-sessions":
      return { ...state, sessions: action.sessions };
    case "remove-session":
      return {
        ...state,
        sessions: state.sessions.filter((session) => session.id !== action.sessionId),
      };
    case "set-pending-action":
      return { ...state, pendingAction: action.pendingAction };
    case "sync-workspace-name":
      return {
        ...state,
        workspaceNameDraft: {
          name: action.name,
          workspaceId: action.workspaceId,
        },
      };
    case "set-workspace-name":
      return {
        ...state,
        workspaceNameDraft: {
          name: action.name,
          workspaceId: action.workspaceId,
        },
      };
  }
}

interface WorkspaceSettingsScreenProps {
  authClient: ZaraAuthClient;
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
}

function useWorkspaceSettingsModel({
  authClient,
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
}: WorkspaceSettingsScreenProps) {
  const [settingsState, dispatchSettings] = useReducer(workspaceSettingsReducer, initialWorkspaceSettingsState);
  const {
    grantRole,
    grantUserId,
    inviteEmail,
    inviteTenantRole,
    inviteWorkspaceRole,
    pendingAction,
    selectedWorkspaceDraftId,
    sessions,
    workspaceNameDraft,
  } = settingsState;
  const selectedWorkspaceId = workspaces.some((workspace) => workspace.id === selectedWorkspaceDraftId)
    ? selectedWorkspaceDraftId
    : activeWorkspaceId;

  const selectedWorkspace =
    workspaces.find((workspace) => workspace.id === selectedWorkspaceId)
    ?? workspaces.find((workspace) => workspace.id === activeWorkspaceId)
    ?? workspaces[0]
    ?? null;
  const selectedWorkspaceNameKey = selectedWorkspace?.id ?? "";
  const selectedWorkspaceName = selectedWorkspace?.name ?? "";
  if (workspaceNameDraft.workspaceId !== selectedWorkspaceNameKey) {
    dispatchSettings({
      type: "sync-workspace-name",
      name: selectedWorkspaceName,
      workspaceId: selectedWorkspaceNameKey,
    });
  }
  const workspaceName =
    workspaceNameDraft.workspaceId === selectedWorkspaceNameKey ? workspaceNameDraft.name : selectedWorkspaceName;
  const setWorkspaceName = (name: string) => {
    dispatchSettings({
      type: "set-workspace-name",
      name,
      workspaceId: selectedWorkspaceNameKey,
    });
  };
  const setPendingAction = (pendingAction: string | null) => {
    dispatchSettings({ type: "set-pending-action", pendingAction });
  };
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
  const effectiveGrantUserId = availableUsers.some((user) => user.id === grantUserId)
    ? grantUserId
    : availableUsers[0]?.id ?? "";
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
    let cancelled = false;

    void authClient.listSessions()
      .then((result) => {
        if (cancelled) {
          return;
        }

        if (!result.ok) {
          showToast(result.message);
          return;
        }

        dispatchSettings({ type: "set-sessions", sessions: result.sessions });
      })
      .catch((error) => {
        if (!cancelled) {
          showToast(error instanceof Error ? error.message : "Account sessions could not be loaded.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [authClient, showToast]);

  if (selectedWorkspace === null) {
    return null;
  }

  const handleWorkspaceSelection = (workspaceId: string) => {
    if (workspaceId === selectedWorkspaceId) {
      return;
    }

    dispatchSettings({ type: "select-workspace", workspaceId });
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
    if (effectiveGrantUserId.length === 0) {
      return;
    }

    const user = directoryUsers.find((candidate) => candidate.id === effectiveGrantUserId);
    setPendingAction("grant");

    try {
      await onGrantWorkspaceRole(selectedWorkspace.id, effectiveGrantUserId, grantRole);
      showToast(`Granted ${grantRole} access to ${user?.name ?? effectiveGrantUserId}.`);
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
      dispatchSettings({ type: "set-invite-email", email: "" });
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

  const sendVerificationEmail = async () => {
    setPendingAction("verify-email");

    try {
      const result = await authClient.requestEmailVerification({
        callbackURL: `${window.location.origin}/settings`,
      });

      if (!result.ok) {
        throw new Error(result.message);
      }

      showToast("Verification email sent.");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Verification email could not be sent.");
    } finally {
      setPendingAction(null);
    }
  };

  const revokeSession = async (session: ZaraSessionMetadata) => {
    setPendingAction(`session:${session.id}`);

    try {
      const result = await authClient.revokeSession({
        sessionId: session.id,
      });

      if (!result.ok) {
        throw new Error(result.message);
      }

      const nextSessions = await authClient.listSessions();

      if (nextSessions.ok) {
        dispatchSettings({ type: "set-sessions", sessions: nextSessions.sessions });
      } else {
        dispatchSettings({ type: "remove-session", sessionId: session.id });
      }

      showToast("Session revoked.");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Session could not be revoked.");
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

  return {
    activeWorkspaceId,
    availableUsers,
    directoryUsers,
    dispatchSettings,
    effectiveGrantUserId,
    grantRole,
    grantWorkspaceRole,
    handleWorkspaceSelection,
    inviteEmail,
    inviteTenantRole,
    inviteWorkspaceRole,
    pendingAction,
    revokeAccess,
    revokeInvitation,
    revokeSession,
    saveWorkspaceName,
    selectedAuditEntries,
    selectedMembers,
    selectedWorkspace,
    sendInvitation,
    sendVerificationEmail,
    sessions,
    archiveSelectedWorkspace,
    restoreSelectedWorkspace,
    updateWorkspaceRole,
    visibleInvitations,
    workspaceName,
    workspaces,
    setWorkspaceName,
  };
}

export function WorkspaceSettingsScreen(props: WorkspaceSettingsScreenProps) {
  const model = useWorkspaceSettingsModel(props);

  if (model === null) {
    return null;
  }

  return (
    <div className="workspace-settings-page">
      <div className="workspace-settings-grid">
        <WorkspaceDirectoryCard
          activeWorkspaceId={model.activeWorkspaceId}
          selectedWorkspace={model.selectedWorkspace}
          workspaces={model.workspaces}
          onSelectWorkspace={model.handleWorkspaceSelection}
        />

        <div className="workspace-settings-main">
          <WorkspaceAccountSecurityCard
            pendingAction={model.pendingAction}
            sessions={model.sessions}
            onRevokeSession={(session) => void model.revokeSession(session)}
            onSendVerificationEmail={() => void model.sendVerificationEmail()}
          />

          <WorkspaceAccessCard
            pendingAction={model.pendingAction}
            selectedWorkspace={model.selectedWorkspace}
            workspaceName={model.workspaceName}
            onArchiveWorkspace={() => void model.archiveSelectedWorkspace()}
            onRestoreWorkspace={() => void model.restoreSelectedWorkspace()}
            onSaveWorkspaceName={() => void model.saveWorkspaceName()}
            onWorkspaceNameChange={model.setWorkspaceName}
          />

          <WorkspaceMembersCard
            availableUsers={model.availableUsers}
            directoryUsers={model.directoryUsers}
            effectiveGrantUserId={model.effectiveGrantUserId}
            grantRole={model.grantRole}
            pendingAction={model.pendingAction}
            selectedMembers={model.selectedMembers}
            onGrantRole={() => void model.grantWorkspaceRole()}
            onGrantRoleChange={(role) => model.dispatchSettings({ type: "set-grant-role", role })}
            onGrantUserChange={(userId) => model.dispatchSettings({ type: "set-grant-user", userId })}
            onRevokeAccess={(userId) => void model.revokeAccess(userId)}
            onUpdateWorkspaceRole={(userId, role) => void model.updateWorkspaceRole(userId, role)}
          />

          <WorkspaceInvitationsCard
            inviteEmail={model.inviteEmail}
            inviteTenantRole={model.inviteTenantRole}
            inviteWorkspaceRole={model.inviteWorkspaceRole}
            pendingAction={model.pendingAction}
            visibleInvitations={model.visibleInvitations}
            onInviteEmailChange={(email) => model.dispatchSettings({ type: "set-invite-email", email })}
            onInviteTenantRoleChange={(role) => model.dispatchSettings({ type: "set-invite-tenant-role", role })}
            onInviteWorkspaceRoleChange={(role) => model.dispatchSettings({ type: "set-invite-workspace-role", role })}
            onRevokeInvitation={(invitation) => void model.revokeInvitation(invitation)}
            onSendInvitation={() => void model.sendInvitation()}
          />

          <WorkspaceAuditCard selectedAuditEntries={model.selectedAuditEntries} />
        </div>
      </div>
    </div>
  );
}
