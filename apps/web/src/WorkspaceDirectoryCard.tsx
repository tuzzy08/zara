import { Users } from "lucide-react";
import type { Workspace } from "@zara/core";
import { Button, Card } from "@zara/ui";

import { WorkspaceSettingsStatusPill } from "./WorkspaceSettingsStatusPill";

export function WorkspaceDirectoryCard({
  activeWorkspaceId,
  selectedWorkspace,
  workspaces,
  onSelectWorkspace,
}: {
  activeWorkspaceId: string;
  selectedWorkspace: Workspace;
  workspaces: Workspace[];
  onSelectWorkspace: (workspaceId: string) => void;
}) {
  return (
    <Card className="surface-card workspace-directory-card">
      <div className="workspace-settings-card-header">
        <div>
          <div className="eyebrow-copy">Workspaces</div>
          <div className="subhead-copy mt-1">Workspace directory</div>
        </div>
        <Users size={16} />
      </div>

      <div className="workspace-directory-list">
        {workspaces.map((workspace) => (
          <Button
            key={workspace.id}
            className={`workspace-directory-item ${workspace.id === selectedWorkspace.id ? "workspace-directory-item-active" : ""}`}
            variant="ghost"
            type="button"
            onClick={() => onSelectWorkspace(workspace.id)}
          >
            <div>
              <div className="panel-title">{workspace.name}</div>
              <div className="panel-meta">{workspace.slug}</div>
            </div>
            <WorkspaceSettingsStatusPill tone={workspace.status === "archived" ? "red" : workspace.id === activeWorkspaceId ? "blue" : "neutral"}>
              {workspace.status === "archived" ? "Archived" : workspace.id === activeWorkspaceId ? "Active" : "Standby"}
            </WorkspaceSettingsStatusPill>
          </Button>
        ))}
      </div>
    </Card>
  );
}
