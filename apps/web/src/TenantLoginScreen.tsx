import { type FormEvent, useEffect, useReducer } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import type { ZaraAuthClient } from "@zara/auth-client";

interface TenantLoginState {
  name: string;
  organizationName: string;
  email: string;
  password: string;
  submitting: boolean;
  resetSubmitting: boolean;
  statusMessage: string | null;
  errorMessage: string | null;
}

type TenantLoginAction =
  | { type: "set-field"; field: "name" | "organizationName" | "email" | "password"; value: string }
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
  const [loginState, dispatchLogin] = useReducer(tenantLoginReducer, initialTenantLoginState);
  const {
    email,
    errorMessage,
    name,
    organizationName,
    password,
    resetSubmitting,
    statusMessage,
    submitting,
  } = loginState;
  const isSignup = mode === "signup";

  useEffect(() => {
    document.title = isSignup
      ? "Create Zara Account | Zara Voice Automation"
      : "Zara Tenant Login | Zara Voice Automation";
  }, [isSignup]);

  const submitAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    dispatchLogin({ type: "submit-start" });

    const result = isSignup
      ? await authClient.signUpEmail({
        email,
        password,
        name,
        organizationName,
      })
      : await authClient.signInEmail({
        email,
        password,
      });

    dispatchLogin({ type: "submit-finish" });

    if (!result.ok) {
      dispatchLogin({ type: "set-error", message: result.message });
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

  const title = isSignup ? "Create your Zara account" : "Sign in to Zara";
  const submitLabel = isSignup ? "Create account" : "Sign in";
  const submittingLabel = isSignup ? "Creating account" : "Signing in";

  return (
    <main className="auth-screen">
      <section className="auth-card" aria-labelledby="tenant-login-title">
        <div className="auth-brand-mark">Z</div>
        <p className="auth-eyebrow">Tenant workspace</p>
        <h1 id="tenant-login-title">{title}</h1>
        <p>Access workflows, calls, sandbox runs, memory, integrations, and workspace settings for your tenant.</p>
        <form className="auth-form" onSubmit={submitAuth}>
          {isSignup
            ? (
              <label>
                <span>Name</span>
                <input
                  autoComplete="name"
                  name="name"
                  type="text"
                  value={name}
                  onChange={(event) => dispatchLogin({ type: "set-field", field: "name", value: event.target.value })}
                  required
                />
              </label>
            )
            : null}
          {isSignup
            ? (
              <label>
                <span>Organization name</span>
                <input
                  autoComplete="organization"
                  name="organizationName"
                  type="text"
                  value={organizationName}
                  onChange={(event) => dispatchLogin({ type: "set-field", field: "organizationName", value: event.target.value })}
                  required
                />
              </label>
            )
            : null}
          <label>
            <span>Email</span>
            <input
              autoComplete="email"
              inputMode="email"
              name="email"
              type="email"
              value={email}
              onChange={(event) => dispatchLogin({ type: "set-field", field: "email", value: event.target.value })}
              required
            />
          </label>
          <label>
            <span>Password</span>
            <input
              autoComplete="current-password"
              name="password"
              type="password"
              value={password}
              onChange={(event) => dispatchLogin({ type: "set-field", field: "password", value: event.target.value })}
              required
            />
          </label>
          {errorMessage === null ? null : <p className="auth-error" role="alert">{errorMessage}</p>}
          {statusMessage === null ? null : <p className="auth-success" role="status">{statusMessage}</p>}
          <button className="auth-submit" type="submit" disabled={submitting}>
            {submitting ? submittingLabel : submitLabel}
          </button>
        </form>
        {isSignup ? null : (
          <button
            className="auth-link-button"
            type="button"
            disabled={resetSubmitting}
            onClick={() => void requestPasswordReset()}
          >
            {resetSubmitting ? "Sending reset link" : "Send reset link"}
          </button>
        )}
        <p className="auth-switch">
          {isSignup ? "Already have an account?" : "Need an account?"}{" "}
          <NavLink to={isSignup ? "/login" : "/signup"}>
            {isSignup ? "Sign in" : "Create one"}
          </NavLink>
        </p>
      </section>
    </main>
  );
}
