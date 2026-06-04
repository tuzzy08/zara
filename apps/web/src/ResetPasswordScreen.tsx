import { type FormEvent, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import type { ZaraAuthClient } from "@zara/auth-client";

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
      <section className="auth-card" aria-labelledby="reset-password-title">
        <div className="auth-brand-mark">Z</div>
        <p className="auth-eyebrow">Account recovery</p>
        <h1 id="reset-password-title">Reset your password</h1>
        <p>Choose a new password for your Zara tenant account.</p>
        <form className="auth-form" onSubmit={submitReset}>
          <label>
            <span>New password</span>
            <input
              autoComplete="new-password"
              name="newPassword"
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              required
            />
          </label>
          {errorMessage === null ? null : <p className="auth-error" role="alert">{errorMessage}</p>}
          {statusMessage === null ? null : <p className="auth-success" role="status">{statusMessage}</p>}
          <button className="auth-submit" type="submit" disabled={submitting || token.length === 0}>
            {submitting ? "Updating password" : "Update password"}
          </button>
        </form>
        <button className="auth-link-button" type="button" onClick={onComplete}>
          Return to sign in
        </button>
      </section>
    </main>
  );
}
