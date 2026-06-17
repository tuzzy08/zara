import { useState } from "react";
import type { ZaraAuthClient, ZaraAuthContext } from "@zara/auth-client";
import { Alert, Badge, Button, Card } from "@zara/ui";

export function TenantOrganizationChooserScreen({
  authClient,
  memberships,
  onAuthChanged,
}: {
  authClient: ZaraAuthClient;
  memberships: ZaraAuthContext["memberships"];
  onAuthChanged: () => void;
}) {
  const [selectedOrganizationId, setSelectedOrganizationId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  return (
    <main className="auth-screen">
      <Card className="auth-card" aria-labelledby="tenant-organization-title">
        <div className="auth-brand-mark">Z</div>
        <p className="auth-eyebrow">Tenant selection</p>
        <h1 id="tenant-organization-title">Choose a tenant</h1>
        <p>Select the tenant organization you want to operate in. Zara will open the workspace you can access for that tenant.</p>
        <menu className="tenant-choice-list">
          {memberships.map((membership) => (
            <Button
              key={membership.organizationId}
              aria-label={`Choose ${membership.organizationName}`}
              className="tenant-choice-button"
              variant="ghost"
              type="button"
              disabled={selectedOrganizationId !== null}
              onClick={async () => {
                setSelectedOrganizationId(membership.organizationId);
                setErrorMessage(null);

                const result = await authClient.selectOrganization({
                  organizationId: membership.organizationId,
                });

                if (!result.ok) {
                  setSelectedOrganizationId(null);
                  setErrorMessage(result.message);
                  return;
                }

                onAuthChanged();
              }}
            >
              <span>{membership.organizationName}</span>
              <Badge variant="secondary">{membership.role}</Badge>
            </Button>
          ))}
        </menu>
        {errorMessage === null ? null : <Alert className="auth-error" role="alert">{errorMessage}</Alert>}
      </Card>
    </main>
  );
}
