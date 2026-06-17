import type { WorkspaceAuditEntry } from "@zara/core";
import { Badge, Card } from "@zara/ui";

import { formatAuditAction, formatAuditTime } from "./workspaceSettingsFormatting";

export function WorkspaceAuditCard({ selectedAuditEntries }: { selectedAuditEntries: WorkspaceAuditEntry[] }) {
  return (
    <Card className="surface-card workspace-settings-card">
      <div className="workspace-settings-card-header">
        <div>
          <div className="eyebrow-copy">Audit</div>
          <div className="subhead-copy mt-1">Audit trail</div>
        </div>
        <Badge className="panel-meta" variant="secondary">{selectedAuditEntries.length} entries</Badge>
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
    </Card>
  );
}
