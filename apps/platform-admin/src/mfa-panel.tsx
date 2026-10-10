import { useRef, useState, type FormEvent } from "react";
import QRCode from "react-qr-code";
import { enablePlatformMfa, verifyPlatformMfa } from "@zara/auth-client";
import { Button, Field, FieldLabel, Input } from "@zara/ui";

export function MfaPanel({ allowSetup = false, onVerified }: { allowSetup?: boolean; onVerified: () => void }) {
  const [setup, setSetup] = useState(false);
  const [enrollment, setEnrollment] = useState<{ totpURI: string; backupCodes: string[] } | null>(null);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const inFlight = useRef(false);

  async function enroll(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current || !password) return;
    inFlight.current = true; setBusy(true); setMessage("");
    try {
      const result = await enablePlatformMfa(password);
      if (!result.ok) { setMessage("Setup failed. Check your password and connection before you try again."); return; }
      setEnrollment(result); setSaved(false);
    } catch { setMessage("Setup result is unknown. Check your connection before you try again."); }
    finally { setPassword(""); inFlight.current = false; setBusy(false); }
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current || !/^\d{6}$/.test(code) || (enrollment !== null && !saved)) return;
    inFlight.current = true; setBusy(true); setMessage("");
    try {
      const result = await verifyPlatformMfa(code);
      if (!result.ok) { setMessage("Verification failed. Use a new authenticator code and try again."); return; }
      setEnrollment(null); setPassword(""); setSetup(false); setSaved(false);
      setMessage("Code verified. Loading your current session.");
      onVerified();
    } catch { setMessage("Verification failed. Check your connection and use a new code."); }
    finally { setCode(""); inFlight.current = false; setBusy(false); }
  }

  return <section className="mfa-panel" aria-label="MFA">
    <h2>Authenticator verification</h2>
    <p>Enter a current six-digit code from your authenticator app. Staff approval lasts 15 minutes.</p>
    {allowSetup && !setup ? <>
      <p>If you have not set up MFA, add an authenticator first. Do not use setup to replace an existing authenticator.</p>
      <Button type="button" onClick={() => setSetup(true)}>Set up authenticator</Button>
    </> : null}
    {setup && enrollment === null ? <form className="auth-form" onSubmit={enroll}>
      <Field><FieldLabel htmlFor="mfa-password">Current password</FieldLabel>
        <Input id="mfa-password" type="password" autoComplete="current-password" value={password} disabled={busy}
          onChange={(event) => setPassword(event.target.value)} required /></Field>
      <Button type="submit" disabled={busy || !password}>Create setup code</Button>
    </form> : null}
    {enrollment ? <div className="mfa-enrollment">
      <p>Scan this code with your authenticator app. Keep this page and these codes private.</p>
      <QRCode value={enrollment.totpURI} size={192} role="img" aria-label="Authenticator setup QR code" />
      <details><summary>Enter a setup key instead</summary><code>{new URL(enrollment.totpURI).searchParams.get("secret")}</code></details>
      <h3>Backup codes</h3><p>Save these codes in a private place before you continue. Each code can be used once.</p>
      <ul>{enrollment.backupCodes.map((backupCode) => <li key={backupCode}><code>{backupCode}</code></li>)}</ul>
      <label><input type="checkbox" checked={saved} disabled={busy} onChange={(event) => setSaved(event.target.checked)} /> I saved my backup codes.</label>
    </div> : null}
    {(!setup || enrollment !== null) ? <form className="auth-form" onSubmit={verify}>
      <Field><FieldLabel htmlFor="mfa-code">Authenticator code</FieldLabel>
        <Input id="mfa-code" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6}
          value={code} disabled={busy} onChange={(event) => setCode(event.target.value)} required /></Field>
      <Button type="submit" disabled={busy || !/^\d{6}$/.test(code) || (enrollment !== null && !saved)}>Verify code</Button>
    </form> : null}
    {message ? <p role="status">{message}</p> : null}
  </section>;
}
