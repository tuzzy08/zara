import { Archive, CheckCheck, RotateCcw } from "lucide-react";
import type { Workspace } from "@zara/core";

import { WorkspaceSettingsStatusPill } from "./WorkspaceSettingsStatusPill";

export function WorkspaceAccessCard({
  pendingAction,
  selectedWorkspace,
  workspaceName,
  onArchiveWorkspace,
  onRestoreWorkspace,
  onSaveWorkspaceName,
  onWorkspaceNameChange,
}: {
  pendingAction: string | null;
  selectedWorkspace: Workspace;
  workspaceName: string;
  onArchiveWorkspace: () => void;
  onRestoreWorkspace: () => void;
  onSaveWorkspaceName: () => void;
  onWorkspaceNameChange: (name: string) => void;
}) {
  return (
    <section className="surface-card workspace-settings-card">
      <div className="workspace-settings-card-header">
        <div>
          <div className="eyebrow-copy">Workspace access</div>
          <div className="subhead-copy mt-1">{selectedWorkspace.name}</div>
        </div>
        <WorkspaceSettingsStatusPill tone={selectedWorkspace.status === "archived" ? "red" : "blue"}>
          {selectedWorkspace.status === "archived" ? "Archived" : "Active"}
        </WorkspaceSettingsStatusPill>
      </div>

      <div className="workspace-settings-form-grid">
        <label className="workspace-settings-field">
          <span>Workspace name</span>
          <input value={workspaceName} onChange={(event) => onWorkspaceNameChange(event.target.value)} />
        </label>
        <div className="workspace-settings-actions">
          <button className="workflow-button workflow-button-primary" type="button" onClick={onSaveWorkspaceName} disabled={pendingAction !== null}>
            <CheckCheck size={15} />
            <span>Save workspace name</span>
          </button>
          {selectedWorkspace.status === "active" ? (
            <button className="workflow-button" type="button" onClick={onArchiveWorkspace} disabled={pendingAction !== null}>
              <Archive size={15} />
              <span>Archive workspace</span>
            </button>
          ) : (
            <button className="workflow-button" type="button" onClick={onRestoreWorkspace} disabled={pendingAction !== null}>
              <RotateCcw size={15} />
              <span>Restore workspace</span>
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
