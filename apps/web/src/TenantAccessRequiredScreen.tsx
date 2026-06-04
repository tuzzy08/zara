import { useState } from "react";
import type { ZaraAuthClient } from "@zara/auth-client";

export function TenantAccessRequiredScreen({
  authClient,
  onAuthChanged,
}: {
  authClient: ZaraAuthClient;
  onAuthChanged: () => void;
}) {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  return (
    <main className="auth-screen">
      <section className="auth-card">
        <div className="auth-brand-mark">Z</div>
        <p className="auth-eyebrow">Organization required</p>
        <h1>Tenant access required</h1>
        <p>Your account is signed in, but it is not attached to an active Zara tenant organization.</p>
        {errorMessage === null ? null : <p className="auth-error" role="alert">{errorMessage}</p>}
        <button
          className="auth-submit"
          type="button"
          onClick={async () => {
            const result = await authClient.signOut();
            if (!result.ok) {
              setErrorMessage(result.message);
              return;
            }

            onAuthChanged();
          }}
        >
          Return to sign in
        </button>
      </section>
    </main>
  );
}
