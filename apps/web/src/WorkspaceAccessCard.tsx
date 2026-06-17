import { Archive, CheckCheck, RotateCcw } from "lucide-react";
import type { Workspace } from "@zara/core";
import { Button, Card, Field, FieldGroup, FieldLabel, Input } from "@zara/ui";

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
    <Card className="surface-card workspace-settings-card">
      <div className="workspace-settings-card-header">
        <div>
          <div className="eyebrow-copy">Workspace access</div>
          <div className="subhead-copy mt-1">{selectedWorkspace.name}</div>
        </div>
        <WorkspaceSettingsStatusPill tone={selectedWorkspace.status === "archived" ? "red" : "blue"}>
          {selectedWorkspace.status === "archived" ? "Archived" : "Active"}
        </WorkspaceSettingsStatusPill>
      </div>

      <FieldGroup className="workspace-settings-form-grid">
        <Field className="workspace-settings-field">
          <FieldLabel htmlFor="workspace-settings-name">Workspace name</FieldLabel>
          <Input id="workspace-settings-name" value={workspaceName} onChange={(event) => onWorkspaceNameChange(event.target.value)} />
        </Field>
        <div className="workspace-settings-actions">
          <Button className="workflow-button workflow-button-primary" type="button" onClick={onSaveWorkspaceName} disabled={pendingAction !== null}>
            <CheckCheck size={15} />
            <span>Save workspace name</span>
          </Button>
          {selectedWorkspace.status === "active" ? (
            <Button className="workflow-button" variant="outline" type="button" onClick={onArchiveWorkspace} disabled={pendingAction !== null}>
              <Archive size={15} />
              <span>Archive workspace</span>
            </Button>
          ) : (
            <Button className="workflow-button" variant="outline" type="button" onClick={onRestoreWorkspace} disabled={pendingAction !== null}>
              <RotateCcw size={15} />
              <span>Restore workspace</span>
            </Button>
          )}
        </div>
      </FieldGroup>
    </Card>
  );
}
