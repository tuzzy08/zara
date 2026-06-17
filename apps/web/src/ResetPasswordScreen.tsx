import { type FormEvent, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import type { ZaraAuthClient } from "@zara/auth-client";
import { Alert, Button, Card, Field, FieldGroup, FieldLabel, Input } from "@zara/ui";

export function ResetPasswordScreen({
  authClient,
  onComplete,
}: {
  authClient: ZaraAuthClient;
  onComplete: () => void;
}) {
  const location = useLocation();
  const token = new URLSearchParams(location.search).get("token") ?? "";
  const [newPassword, setNewPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Reset Zara Password | Zara Voice Automation";
  }, []);

  const submitReset = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setStatusMessage(null);
    setErrorMessage(null);

    const result = await authClient.resetPassword({
      token,
      newPassword,
    });

    setSubmitting(false);

    if (!result.ok) {
      setErrorMessage(result.message);
      return;
    }

    setStatusMessage("Password updated. Sign in with your new password.");
  };

  return (
    <main className="auth-screen">
      <Card className="auth-card" aria-labelledby="reset-password-title">
        <div className="auth-brand-mark">Z</div>
        <p className="auth-eyebrow">Account recovery</p>
        <h1 id="reset-password-title">Reset your password</h1>
        <p>Choose a new password for your Zara tenant account.</p>
        <form className="auth-form" onSubmit={submitReset}>
          <FieldGroup>
            <Field>
              <FieldLabel>
                <span>New password</span>
                <Input
                  autoComplete="new-password"
                  name="newPassword"
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  required
                />
              </FieldLabel>
            </Field>
          </FieldGroup>
          {errorMessage === null ? null : <Alert className="auth-error" role="alert">{errorMessage}</Alert>}
          {statusMessage === null ? null : <Alert className="auth-success" role="status">{statusMessage}</Alert>}
          <Button className="auth-submit" type="submit" disabled={submitting || token.length === 0}>
            {submitting ? "Updating password" : "Update password"}
          </Button>
        </form>
        <Button className="auth-link-button" type="button" variant="ghost" onClick={onComplete}>
          Return to sign in
        </Button>
      </Card>
    </main>
  );
}
