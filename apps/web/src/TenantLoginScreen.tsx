import { type FormEvent, useEffect, useReducer, useRef, useState } from "react";
import { NavLink, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";
import { verifyPlatformMfa, type ZaraAuthClient } from "@zara/auth-client";
import { Alert, Button, Card, Field, FieldGroup, FieldLabel, Input } from "@zara/ui";

interface TenantLoginState {
  name: string;
  organizationName: string;
  email: string;
  password: string;
  confirmPassword: string;
  submitting: boolean;
  resetSubmitting: boolean;
  statusMessage: string | null;
  errorMessage: string | null;
}

type TenantLoginAction =
  | { type: "set-field"; field: "name" | "organizationName" | "email" | "password" | "confirmPassword"; value: string }
  | { type: "submit-start" }
  | { type: "submit-finish" }
  | { type: "reset-start" }
  | { type: "reset-finish" }
  | { type: "set-status"; message: string | null }
  | { type: "set-error"; message: string | null };

const initialTenantLoginState: TenantLoginState = {
  name: "",
  organizationName: "",
  email: "",
  password: "",
  confirmPassword: "",
  submitting: false,
  resetSubmitting: false,
  statusMessage: null,
  errorMessage: null,
};

function tenantLoginReducer(state: TenantLoginState, action: TenantLoginAction): TenantLoginState {
  switch (action.type) {
    case "set-field":
      return { ...state, [action.field]: action.value };
    case "submit-start":
      return { ...state, submitting: true, statusMessage: null, errorMessage: null };
    case "submit-finish":
      return { ...state, submitting: false };
    case "reset-start":
      return { ...state, resetSubmitting: true, statusMessage: null, errorMessage: null };
    case "reset-finish":
      return { ...state, resetSubmitting: false };
    case "set-status":
      return { ...state, statusMessage: action.message };
    case "set-error":
      return { ...state, errorMessage: action.message };
  }
}

export function TenantLoginScreen({
  authClient,
  mode,
  onAuthChanged,
}: {
  authClient: ZaraAuthClient;
  mode: "signin" | "signup";
  onAuthChanged: () => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const isSignupSuccess = location.pathname === "/signup/success";
  const successState = location.state as { email?: unknown } | null;
  const successEmail = typeof successState?.email === "string" ? successState.email : null;
  const [searchParams] = useSearchParams();
  // This selects the form action only. The API still verifies the credentials and email.
  const resumeSignup = searchParams.get("resume") === "true";
  const [requiresMfa, setRequiresMfa] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [code, setCode] = useState("");
  const verificationPending = useRef(false);
  const [loginState, dispatchLogin] = useReducer(tenantLoginReducer, initialTenantLoginState);
  const {
    email,
    errorMessage,
    name,
    organizationName,
    password,
    confirmPassword,
    resetSubmitting,
    statusMessage,
    submitting,
  } = loginState;
  const isSignup = mode === "signup";

  useEffect(() => {
    document.title = isSignupSuccess ? "Check Your Email | Zara Voice Automation" : isSignup
      ? resumeSignup ? "Continue Zara Signup | Zara Voice Automation" : "Create Zara Account | Zara Voice Automation"
      : "Zara Tenant Login | Zara Voice Automation";
  }, [isSignup, isSignupSuccess, resumeSignup]);

  const submitAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSignup && password !== confirmPassword) {
      dispatchLogin({ type: "set-error", message: "Passwords do not match." });
      return;
    }
    dispatchLogin({ type: "submit-start" });
    setShowPassword(false);
    setShowConfirmPassword(false);

    const result = isSignup
      ? await authClient.signUpEmail({
        email,
        password,
        name,
        organizationName,
        resume: resumeSignup,
        callbackURL: `${window.location.origin}/signup/verified`,
      })
      : await authClient.signInEmail({
        email,
        password,
        callbackURL: `${window.location.origin}/login`,
      });

    dispatchLogin({ type: "submit-finish" });

    if (!result.ok) {
      dispatchLogin({ type: "set-error", message: result.message });
      return;
    }

    if (result.verificationRequired) {
      dispatchLogin({ type: "set-field", field: "password", value: "" });
      dispatchLogin({ type: "set-field", field: "confirmPassword", value: "" });
      navigate("/signup/success", { replace: true, state: { email: email.trim().toLowerCase() } });
      return;
    }

    if (result.twoFactorRedirect) {
      dispatchLogin({ type: "set-field", field: "password", value: "" });
      setRequiresMfa(true);
      return;
    }

    if (isSignup) {
      navigate("/", { replace: true });
    }
    onAuthChanged();
  };

  const requestPasswordReset = async () => {
    const normalizedEmail = email.trim().toLowerCase();

    if (normalizedEmail.length === 0) {
      dispatchLogin({ type: "set-error", message: "Enter your email before requesting a reset link." });
      return;
    }

    dispatchLogin({ type: "reset-start" });

    const result = await authClient.requestPasswordReset({
      email: normalizedEmail,
      redirectTo: `${window.location.origin}/reset-password`,
    });

    dispatchLogin({ type: "reset-finish" });

    if (!result.ok) {
      dispatchLogin({ type: "set-error", message: result.message });
      return;
    }

    dispatchLogin({ type: "set-status", message: "If that account exists, a reset link has been sent." });
  };

  const title = isSignup ? resumeSignup ? "Continue your Zara signup" : "Create your Zara account" : "Sign in to Zara";
  const submitLabel = isSignup
    ? resumeSignup ? "Continue after verification" : "Create account"
    : "Sign in";
  const submittingLabel = isSignup ? resumeSignup ? "Continuing signup" : "Creating account" : "Signing in";

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (verificationPending.current || !/^\d{6}$/.test(code)) return;
    verificationPending.current = true;
    dispatchLogin({ type: "submit-start" });
    try {
      const result = await verifyPlatformMfa(code);
      if (!result.ok) {
        dispatchLogin({ type: "set-error", message: "Verification failed. Use a new authenticator code and try again." });
        return;
      }
      onAuthChanged();
    } finally {
      setCode("");
      verificationPending.current = false;
      dispatchLogin({ type: "submit-finish" });
    }
  }

  if (isSignupSuccess) return <main className="auth-screen">
    <Card className="auth-card" aria-labelledby="signup-success-title">
      <div className="auth-brand-mark">Z</div>
      <p className="auth-eyebrow">Email verification</p>
      <h1 id="signup-success-title">Check your email</h1>
      {successEmail === null
        ? <p>Open the verification email from your signup to continue setup.</p>
        : <p>We sent a verification email to <strong className="auth-email-address">{successEmail}</strong>.</p>}
      <p>Open the email and select the verification link. After verification, select Continue setup to open your dashboard. Your signup details are saved.</p>
      <p>You must verify your email before you can sign in. If you cannot find the message, check your spam folder.</p>
      <div className="auth-form">
        <NavLink className="auth-submit" to="/signup/verified">Check verification</NavLink>
      </div>
      <p>Need another email? <NavLink to="/signup?resume=true">Continue an existing signup</NavLink> to request a new link.</p>
      <p className="auth-switch">Wrong email? <NavLink to="/signup">Create a new account</NavLink></p>
      <p className="auth-switch">Already finished setup? <NavLink to="/login">Sign in</NavLink></p>
    </Card>
  </main>;

  if (requiresMfa) return <main className="auth-screen">
    <Card className="auth-card" aria-labelledby="tenant-mfa-title">
      <h1 id="tenant-mfa-title">Verify your sign-in</h1>
      <p>Enter a current six-digit code from your authenticator app.</p>
      <form className="auth-form" onSubmit={verifyCode}>
        <Field><FieldLabel htmlFor="tenant-mfa-code">Authenticator code</FieldLabel>
          <Input id="tenant-mfa-code" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}"
            maxLength={6} value={code} disabled={submitting} required onChange={(event) => setCode(event.target.value)} /></Field>
        {errorMessage === null ? null : <Alert role="alert">{errorMessage}</Alert>}
        <Button className="auth-submit" type="submit" disabled={submitting || !/^\d{6}$/.test(code)}>Verify code</Button>
      </form>
    </Card>
  </main>;

  return (
    <main className="auth-screen">
      <Card className="auth-card" aria-labelledby="tenant-login-title">
        <div className="auth-brand-mark">Z</div>
        <p className="auth-eyebrow">Tenant workspace</p>
        <h1 id="tenant-login-title">{title}</h1>
        <p>{isSignup && resumeSignup
          ? "Use the email and password from your existing signup. Verify your email before you continue."
          : "Access workflows, calls, sandbox runs, memory, integrations, and workspace settings for your tenant."}</p>
        <form className="auth-form" onSubmit={submitAuth}>
          <FieldGroup>
            {isSignup
              ? (
                <Field>
                  <FieldLabel>
                    <span>Name</span>
                    <Input
                      autoComplete="name"
                      name="name"
                      type="text"
                      value={name}
                      onChange={(event) => dispatchLogin({ type: "set-field", field: "name", value: event.target.value })}
                      required
                    />
                  </FieldLabel>
                </Field>
              )
              : null}
            {isSignup
              ? (
                <Field>
                  <FieldLabel>
                    <span>Organization name</span>
                    <Input
                      autoComplete="organization"
                      name="organizationName"
                      type="text"
                      value={organizationName}
                      onChange={(event) => dispatchLogin({ type: "set-field", field: "organizationName", value: event.target.value })}
                      required
                    />
                  </FieldLabel>
                </Field>
              )
              : null}
            <Field>
              <FieldLabel>
                <span>Email</span>
                <Input
                  autoComplete="email"
                  inputMode="email"
                  name="email"
                  type="email"
                  value={email}
                  onChange={(event) => dispatchLogin({ type: "set-field", field: "email", value: event.target.value })}
                  required
                />
              </FieldLabel>
            </Field>
            <Field>
              <FieldLabel htmlFor="tenant-password">Password</FieldLabel>
              <div className="auth-password-control">
                <Input
                  id="tenant-password"
                  autoComplete={isSignup ? "new-password" : "current-password"}
                  name="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => dispatchLogin({ type: "set-field", field: "password", value: event.target.value })}
                  required
                />
                <Button className="auth-password-toggle" type="button" variant="ghost" size="icon"
                  aria-label={showPassword ? "Hide password" : "Show password"} aria-controls="tenant-password"
                  onClick={() => setShowPassword((visible) => !visible)}>
                  {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
                </Button>
              </div>
            </Field>
            {isSignup ? (
              <Field>
                <FieldLabel htmlFor="tenant-confirm-password">Confirm password</FieldLabel>
                <div className="auth-password-control">
                  <Input
                    id="tenant-confirm-password"
                    autoComplete="new-password"
                    name="confirmPassword"
                    type={showConfirmPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(event) => dispatchLogin({ type: "set-field", field: "confirmPassword", value: event.target.value })}
                    required
                  />
                  <Button className="auth-password-toggle" type="button" variant="ghost" size="icon"
                    aria-label={showConfirmPassword ? "Hide confirm password" : "Show confirm password"} aria-controls="tenant-confirm-password"
                    onClick={() => setShowConfirmPassword((visible) => !visible)}>
                    {showConfirmPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
                  </Button>
                </div>
              </Field>
            ) : null}
          </FieldGroup>
          {errorMessage === null ? null : <Alert className="auth-error" role="alert">{errorMessage}</Alert>}
          {statusMessage === null ? null : <Alert className="auth-success" role="status">{statusMessage}</Alert>}
          <Button className="auth-submit" type="submit" disabled={submitting}>
            {submitting ? submittingLabel : submitLabel}
          </Button>
        </form>
        {isSignup ? null : (
          <Button
            className="auth-link-button"
            type="button"
            variant="ghost"
            disabled={resetSubmitting}
            onClick={() => void requestPasswordReset()}
          >
            {resetSubmitting ? "Sending reset link" : "Send reset link"}
          </Button>
        )}
        {isSignup ? (
          <p className="auth-switch">
            {resumeSignup ? <NavLink to="/signup" onClick={() => {
              dispatchLogin({ type: "set-error", message: null });
              dispatchLogin({ type: "set-status", message: null });
            }}>Create a new account</NavLink> : <NavLink to="/signup?resume=true">Continue an existing signup</NavLink>}
          </p>
        ) : null}
        <p className="auth-switch">
          {isSignup ? "Already have an account?" : "Need an account?"}{" "}
          <NavLink to={isSignup ? "/login" : "/signup"}>
            {isSignup ? "Sign in" : "Create one"}
          </NavLink>
        </p>
      </Card>
    </main>
  );
}
