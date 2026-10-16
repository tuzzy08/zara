import { useEffect, useRef, useState } from "react";
import { NavLink, useSearchParams } from "react-router-dom";
import { completeTenantSignup, getTenantSignupVerification } from "@zara/auth-client";
import { Alert, Button, Card } from "@zara/ui";

export function SignupVerifiedScreen({ onComplete }: { onComplete: () => void }) {
  const [searchParams] = useSearchParams();
  const linkFailed = searchParams.has("error");
  const [verification, setVerification] = useState<Awaited<ReturnType<typeof getTenantSignupVerification>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);

  useEffect(() => {
    document.title = "Email Verification | Zara Voice Automation";
    if (linkFailed) return;
    let active = true;
    void getTenantSignupVerification().then((result) => { if (active) setVerification(result); });
    return () => { active = false; };
  }, [linkFailed]);

  async function continueSetup() {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    const result = await completeTenantSignup();
    if (result.ok) onComplete();
    else setError(result.message);
    submitting.current = false;
    setBusy(false);
  }

  const confirmed = !linkFailed && verification?.ok === true;
  const pending = !linkFailed && verification === null;
  return <main className="auth-screen">
    <Card className="auth-card" aria-labelledby="email-verified-title">
      <div className="auth-brand-mark">Z</div>
      <p className="auth-eyebrow">Email verification</p>
      <h1 id="email-verified-title">{confirmed ? "Email verified" : pending ? "Checking verification" : "Verification not confirmed"}</h1>
      {confirmed ? <>
        <p><strong className="auth-email-address">{verification.email}</strong> is verified.</p>
        <p>Continue to finish your organization setup and open your dashboard. Your signup details are saved.</p>
        {error ? <Alert role="alert">{error}</Alert> : null}
        <div className="auth-form">
          <Button className="auth-submit" onClick={() => void continueSetup()} disabled={busy}>
            {busy ? "Preparing your dashboard" : "Continue setup"}
          </Button>
        </div>
      </> : pending ? <p role="status">Please wait while we check your account.</p> : <>
        <p>{linkFailed ? "This verification link is invalid or has expired." : verification && !verification.ok ? verification.message : "Open the verification link in your email."}</p>
        <p>If you already used the link in another browser, sign in to continue.</p>
        <p className="auth-switch"><NavLink to="/login">Sign in</NavLink></p>
      </>}
    </Card>
  </main>;
}
