import { MailPlus, ShieldCheck, XCircle } from "lucide-react";
import type { ZaraSessionMetadata } from "@zara/auth-client";
import { Button, Card } from "@zara/ui";

import { formatSessionTime } from "./workspaceSettingsFormatting";
import { WorkspaceSettingsStatusPill } from "./WorkspaceSettingsStatusPill";

export function WorkspaceAccountSecurityCard({
  pendingAction,
  sessions,
  onRevokeSession,
  onSendVerificationEmail,
}: {
  pendingAction: string | null;
  sessions: ZaraSessionMetadata[];
  onRevokeSession: (session: ZaraSessionMetadata) => void;
  onSendVerificationEmail: () => void;
}) {
  return (
    <Card className="surface-card workspace-settings-card">
      <div className="workspace-settings-card-header">
        <div>
          <div className="eyebrow-copy">Account</div>
          <div className="subhead-copy mt-1">Account security</div>
        </div>
        <ShieldCheck size={16} />
      </div>

      <div className="workspace-members-toolbar subtle-panel">
        <Button
          className="workflow-button workflow-button-primary"
          type="button"
          disabled={pendingAction !== null}
          onClick={onSendVerificationEmail}
        >
          <MailPlus size={15} />
          <span>Send verification email</span>
        </Button>
      </div>

      <div className="workspace-member-list">
        {sessions.map((session) => {
          const sessionLabel = session.userAgent ?? "Unknown device";

          return (
            <div key={session.id} className="subtle-panel workspace-member-row">
              <div>
                <div className="panel-title">{sessionLabel}</div>
                <div className="panel-meta">{`Expires ${formatSessionTime(session.expiresAt)}`}</div>
              </div>
              <div className="workspace-member-controls">
                {session.current ? <WorkspaceSettingsStatusPill tone="blue">Current</WorkspaceSettingsStatusPill> : null}
                {session.current ? null : (
                  <Button
                    className="workflow-button"
                    variant="outline"
                    type="button"
                    disabled={pendingAction !== null}
                    onClick={() => onRevokeSession(session)}
                  >
                    <XCircle size={15} />
                    <span>{`Revoke session for ${sessionLabel}`}</span>
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
