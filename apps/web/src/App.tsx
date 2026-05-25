import { type FormEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import {
  Bot,
  Cable,
  ChevronDown,
  CreditCard,
  GitBranchPlus,
  HardDrive,
  LayoutGrid,
  MemoryStick,
  MoonStar,
  PhoneCall,
  Search,
  Settings,
  SunMedium,
  UserCircle2,
  AudioLines,
  Plus,
} from "lucide-react";
import { NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { tenantAuthClient, type ZaraAuthClient } from "@zara/auth-client";
import {
  createWorkspace as buildWorkspace,
  renameWorkspace as renameWorkspaceModel,
  revokeWorkspaceMembership as revokeWorkspaceMembershipModel,
  setWorkspaceMembershipRole as setWorkspaceMembershipRoleModel,
  slugifyWorkspaceName,
  validateWorkspaceCreate,
  type TenantRole,
  type WorkspaceDirectoryUser,
} from "@zara/core";

import { SandboxScreen } from "./SandboxScreen";
import { TelephonyScreen } from "./TelephonyScreen";
import { TenantBillingScreen, TenantIntegrationsScreen, TenantMemoryScreen } from "./TenantPages";
import { WorkflowBuilderScreen } from "./WorkflowBuilder";
import { WorkspaceSettingsScreen } from "./WorkspaceSettingsScreen";
import {
  createInitialWorkspaceState,
  loadActiveWorkspaceId,
  resolveActiveWorkspaceId,
  saveActiveWorkspaceId,
  tenantId,
} from "./workspaceState";
import {
  archiveWorkspaceViaApi,
  createWorkspaceViaApi,
  fetchWorkspaceState,
  markWorkspaceAccessedViaApi,
  renameWorkspaceViaApi,
  restoreWorkspaceViaApi,
  revokeWorkspaceMembershipViaApi,
  setWorkspaceMembershipRoleViaApi,
  type WorkspaceStateResponse,
} from "./workspaceApi";

type Theme = "light" | "dark";

const primaryNavigation = [
  { label: "Agents", path: "/", icon: Bot },
  { label: "Workflows", path: "/workflows", icon: GitBranchPlus },
  { label: "Sandbox", path: "/sandbox", icon: HardDrive },
  { label: "Calls", path: "/calls", icon: PhoneCall },
] as const;

const secondaryNavigation = [
  { label: "Integrations", path: "/integrations", icon: Cable },
  { label: "Memory", path: "/memory", icon: MemoryStick },
  { label: "Billing", path: "/billing", icon: CreditCard },
  { label: "Settings", path: "/settings", icon: Settings },
] as const;

interface AppProps {
  authClient?: ZaraAuthClient;
}

export function App({ authClient = tenantAuthClient }: AppProps = {}) {
  const [authRevision, setAuthRevision] = useState(0);
  const authSnapshot = authClient.useSession();
  const location = useLocation();
  const initialWorkspaceState = useMemo(() => createInitialWorkspaceState(), []);
  const [theme, setTheme] = useState<Theme>(() => getInitialTheme());
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [createWorkspaceOpen, setCreateWorkspaceOpen] = useState(false);
  const [workspaceName, setWorkspaceName] = useState("");
  const [directoryUsers, setDirectoryUsers] = useState<WorkspaceDirectoryUser[]>(() => initialWorkspaceState.directoryUsers);
  const [workspaces, setWorkspaces] = useState(() => initialWorkspaceState.workspaces);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState(() => loadActiveWorkspaceId(initialWorkspaceState.workspaces));
  const [workspaceMemberships, setWorkspaceMemberships] = useState(() => initialWorkspaceState.memberships);
  const [workspaceAuditEntries, setWorkspaceAuditEntries] = useState(() => initialWorkspaceState.auditEntries);
  const [shellToast, setShellToast] = useState<string | null>(null);
  const profileMenuRef = useRef<HTMLDivElement | null>(null);
  const workspaceMenuRef = useRef<HTMLDivElement | null>(null);
  const workspaceRequestIdRef = useRef(0);
  const activeWorkspace =
    workspaces.find((workspace) => workspace.id === activeWorkspaceId)
    ?? workspaces.find((workspace) => workspace.status === "active")
    ?? workspaces[0]!;

  const refreshAuth = useCallback(() => {
    setAuthRevision((current) => current + 1);
  }, []);

  void authRevision;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem("zara-theme", theme);
  }, [theme]);

  useEffect(() => {
    saveActiveWorkspaceId(activeWorkspaceId);
  }, [activeWorkspaceId]);

  useEffect(() => {
    if (shellToast === null) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => setShellToast(null), 2600);

    return () => window.clearTimeout(timeoutId);
  }, [shellToast]);

  useLayoutEffect(() => {
    const applyViewportMode = () => {
      const visualWidth = Math.round(window.visualViewport?.width ?? window.innerWidth);
      const cssViewportWidth = Math.max(window.innerWidth, visualWidth);
      const desktopPointer =
        typeof window.matchMedia === "function"
          ? window.matchMedia("(hover: hover) and (pointer: fine)").matches
          : false;
      const compressedDesktopViewport = desktopPointer && window.outerWidth > cssViewportWidth * 1.35;

      document.documentElement.dataset.shellDesktop = compressedDesktopViewport ? "true" : "false";
      document.documentElement.style.setProperty(
        "--shell-viewport-width",
        compressedDesktopViewport ? `${window.outerWidth}px` : "100vw",
      );
    };

    applyViewportMode();
    window.addEventListener("resize", applyViewportMode);
    window.visualViewport?.addEventListener("resize", applyViewportMode);

    return () => {
      window.removeEventListener("resize", applyViewportMode);
      window.visualViewport?.removeEventListener("resize", applyViewportMode);
      document.documentElement.style.removeProperty("--shell-viewport-width");
      delete document.documentElement.dataset.shellDesktop;
    };
  }, []);

  useEffect(() => {
    if (!profileMenuOpen) {
      return undefined;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!profileMenuRef.current?.contains(event.target as Node)) {
        setProfileMenuOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setProfileMenuOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [profileMenuOpen]);

  useEffect(() => {
    if (!workspaceMenuOpen) {
      return undefined;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!workspaceMenuRef.current?.contains(event.target as Node)) {
        setWorkspaceMenuOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [workspaceMenuOpen]);

  const themeToggleLabel = useMemo(() => (theme === "dark" ? "Light mode" : "Dark mode"), [theme]);
  const activeWorkspaces = useMemo(
    () => workspaces.filter((workspace) => workspace.status === "active"),
    [workspaces],
  );

  const showToast = useCallback((message: string) => {
    setShellToast(message);
  }, []);

  const applyWorkspaceState = useCallback((state: WorkspaceStateResponse) => {
    setDirectoryUsers(state.directoryUsers);
    setWorkspaces(state.workspaces);
    setWorkspaceMemberships(state.memberships);
    setWorkspaceAuditEntries(state.auditEntries);
  }, []);

  const resolveLatestWorkspaceState = useCallback(async (request: () => Promise<WorkspaceStateResponse>) => {
    const requestId = ++workspaceRequestIdRef.current;
    const state = await request();

    if (requestId !== workspaceRequestIdRef.current) {
      return null;
    }

    applyWorkspaceState(state);
    return state;
  }, [applyWorkspaceState]);

  useEffect(() => {
    let cancelled = false;

    void resolveLatestWorkspaceState(() => fetchWorkspaceState(tenantId))
      .then((state) => {
        if (cancelled || state === null) {
          return;
        }

        setActiveWorkspaceId((current) => resolveActiveWorkspaceId(state.workspaces, current));
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setShellToast(error instanceof Error ? error.message : "Workspace state could not be loaded.");
      });

    return () => {
      cancelled = true;
    };
  }, [resolveLatestWorkspaceState]);

  const activateWorkspace = async (workspaceId: string) => {
    const previousWorkspaceId = activeWorkspaceId;

    if (workspaceId === previousWorkspaceId) {
      setWorkspaceMenuOpen(false);
      return;
    }

    setActiveWorkspaceId(workspaceId);
    setWorkspaceMenuOpen(false);

    try {
      const state = await resolveLatestWorkspaceState(() => markWorkspaceAccessedViaApi({
        organizationId: tenantId,
        workspaceId,
        actorUserId: "user-ops-lead",
      }));

      if (state === null) {
        return;
      }

      setActiveWorkspaceId((current) => resolveActiveWorkspaceId(state.workspaces, current));
    } catch (error) {
      setActiveWorkspaceId(previousWorkspaceId);
      showToast(error instanceof Error ? error.message : "Workspace switch could not be saved.");
    }
  };

  const createWorkspace = async () => {
    const trimmedWorkspaceName = workspaceName.trim();
    const validation = validateWorkspaceCreate({
      tenantId,
      name: trimmedWorkspaceName,
      existingWorkspaces: workspaces,
    });

    if (!validation.ok) {
      showToast(validation.message);
      return;
    }

    const previousWorkspaces = workspaces;
    const previousActiveWorkspaceId = activeWorkspaceId;
    const optimisticWorkspace = buildWorkspace({
      id: `workspace-${slugifyWorkspaceName(trimmedWorkspaceName)}`,
      tenantId,
      name: trimmedWorkspaceName,
      slug: slugifyWorkspaceName(trimmedWorkspaceName),
      createdBy: "user-ops-lead",
    });

    setWorkspaces((current) => [...current, optimisticWorkspace]);
    setActiveWorkspaceId(optimisticWorkspace.id);
    setWorkspaceName("");
    setCreateWorkspaceOpen(false);
    setWorkspaceMenuOpen(false);

    try {
      const state = await resolveLatestWorkspaceState(() => createWorkspaceViaApi({
        organizationId: tenantId,
        name: trimmedWorkspaceName,
        actorUserId: "user-ops-lead",
      }));

      if (state === null) {
        return;
      }
      const createdWorkspace =
        state.workspaces.find((workspace) => workspace.slug === slugifyWorkspaceName(trimmedWorkspaceName))
        ?? state.workspaces.at(-1);

      if (createdWorkspace !== undefined) {
        setActiveWorkspaceId(createdWorkspace.id);
      }

      showToast(`${createdWorkspace?.name ?? "Workspace"} created.`);
    } catch (error) {
      setWorkspaces(previousWorkspaces);
      setActiveWorkspaceId(previousActiveWorkspaceId);
      showToast(error instanceof Error ? error.message : "Workspace could not be created.");
    }
  };

  const renameWorkspace = async (workspaceId: string, nextName: string) => {
    const previousWorkspaces = workspaces;
    const nextWorkspaces = renameWorkspaceModel({
      workspaces,
      workspaceId,
      tenantId,
      nextName,
    });

    setWorkspaces(nextWorkspaces);

    try {
      const state = await resolveLatestWorkspaceState(() => renameWorkspaceViaApi({
        organizationId: tenantId,
        workspaceId,
        actorUserId: "user-ops-lead",
        nextName,
      }));

      if (state === null) {
        return;
      }

      setActiveWorkspaceId((current) => resolveActiveWorkspaceId(state.workspaces, current));
    } catch (error) {
      setWorkspaces(previousWorkspaces);
      throw error;
    }
  };

  const archiveWorkspace = async (workspaceId: string) => {
    const state = await resolveLatestWorkspaceState(() => archiveWorkspaceViaApi({
      organizationId: tenantId,
      workspaceId,
      actorUserId: "user-ops-lead",
      activeSessionCount: 0,
    }));

    if (state === null) {
      return;
    }

    setActiveWorkspaceId((current) =>
      current === workspaceId ? resolveActiveWorkspaceId(state.workspaces) : resolveActiveWorkspaceId(state.workspaces, current),
    );
  };

  const restoreWorkspace = async (workspaceId: string) => {
    const state = await resolveLatestWorkspaceState(() => restoreWorkspaceViaApi({
      organizationId: tenantId,
      workspaceId,
      actorUserId: "user-ops-lead",
    }));

    if (state === null) {
      return;
    }

    setActiveWorkspaceId((current) => resolveActiveWorkspaceId(state.workspaces, current));
  };

  const setWorkspaceRole = async (workspaceId: string, userId: string, role: TenantRole) => {
    const previousMemberships = workspaceMemberships;
    const nextMemberships = setWorkspaceMembershipRoleModel({
      memberships: workspaceMemberships,
      workspaceId,
      tenantId,
      userId,
      role,
    });

    setWorkspaceMemberships(nextMemberships);

    try {
      if (await resolveLatestWorkspaceState(() => setWorkspaceMembershipRoleViaApi({
        organizationId: tenantId,
        workspaceId,
        userId,
        role,
        actorUserId: "user-ops-lead",
      })) === null) {
        return;
      }
    } catch (error) {
      setWorkspaceMemberships(previousMemberships);
      throw error;
    }
  };

  const revokeWorkspaceRole = async (workspaceId: string, userId: string) => {
    const previousMemberships = workspaceMemberships;
    const nextMemberships = revokeWorkspaceMembershipModel({
      memberships: workspaceMemberships,
      workspaceId,
      tenantId,
      userId,
    });

    setWorkspaceMemberships(nextMemberships);

    try {
      if (await resolveLatestWorkspaceState(() => revokeWorkspaceMembershipViaApi({
        organizationId: tenantId,
        workspaceId,
        userId,
        actorUserId: "user-ops-lead",
      })) === null) {
        return;
      }
    } catch (error) {
      setWorkspaceMemberships(previousMemberships);
      throw error;
    }
  };

  if (authSnapshot.isPending) {
    return <AuthLoadingScreen />;
  }

  if (authSnapshot.data === null) {
    return (
      <TenantLoginScreen
        authClient={authClient}
        mode={location.pathname === "/signup" ? "signup" : "signin"}
        onAuthChanged={refreshAuth}
      />
    );
  }

  const currentOrganization = authSnapshot.data.organization;

  if (currentOrganization === null) {
    return <TenantAccessRequiredScreen authClient={authClient} onAuthChanged={refreshAuth} />;
  }

  const currentSession = authSnapshot.data;

  return (
    <div className="shell-app">
      <header className="shell-topbar">
        <div className="shell-topbar-inner">
          <div className="shell-brand-strip">
            <button className="shell-mobile-nav" type="button">
              <LayoutGrid size={15} />
              <span>Navigation</span>
            </button>
            <div className="shell-brand">
              <AudioLines size={26} />
              <span>ZARA AI</span>
            </div>
          </div>

          <div className="shell-topbar-search">
            <Search size={15} className="shell-topbar-search-icon" />
            <span>Search workflows, calls, or organizations</span>
          </div>

          <div className="shell-topbar-actions">
            <div className="profile-menu" ref={profileMenuRef}>
              <button
                aria-expanded={profileMenuOpen}
                aria-haspopup="menu"
                aria-label="Open profile menu"
                className="profile-trigger"
                type="button"
                onClick={() => setProfileMenuOpen((current) => !current)}
              >
                <UserCircle2 size={18} />
                <div className="profile-trigger-text">
                  <span className="profile-trigger-name">{currentSession.user.name}</span>
                  <span className="profile-trigger-role">{currentOrganization.name}</span>
                </div>
                <ChevronDown size={15} />
              </button>

              {profileMenuOpen ? (
                <div className="profile-panel" role="menu">
                  <div className="profile-panel-section">
                    <div className="profile-panel-label">Preference</div>
                    <button
                      className="profile-panel-action"
                      role="menuitem"
                      type="button"
                      onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
                    >
                      {theme === "dark" ? <SunMedium size={15} /> : <MoonStar size={15} />}
                      <span>{themeToggleLabel}</span>
                    </button>
                  </div>
                  <div className="profile-panel-section">
                    <div className="profile-panel-label">Session</div>
                    <button
                      className="profile-panel-action"
                      role="menuitem"
                      type="button"
                      onClick={async () => {
                        const result = await authClient.signOut();
                        if (!result.ok) {
                          showToast(result.message);
                          return;
                        }

                        setProfileMenuOpen(false);
                        refreshAuth();
                      }}
                    >
                      <UserCircle2 size={15} />
                      <span>Sign out</span>
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </header>

      <div className="shell-body shell-frame w-full">
        <aside className="shell-sidebar" aria-label="Primary">
          <div className="shell-sidebar-top">
            <div className="tenant-summary workspace-switcher" ref={workspaceMenuRef}>
              {/* <div className="tenant-summary-row">
                <span>Environment</span>
                <span className="tenant-summary-badge">Production</span>
              </div> */}
              <button
                className="tenant-summary-body workspace-switcher-trigger"
                type="button"
                aria-label="Switch workspace"
                aria-expanded={workspaceMenuOpen}
                aria-haspopup="menu"
                onClick={() => setWorkspaceMenuOpen((current) => !current)}
              >
                <div className="tenant-summary-mark">Z</div>
                <div>
                  <div className="tenant-summary-title">West Africa operations</div>
                  <div className="tenant-summary-meta">{activeWorkspace.name}</div>
                </div>
                <ChevronDown size={15} />
              </button>
              {workspaceMenuOpen ? (
                <div className="workspace-menu-panel" role="menu">
                  <div className="profile-panel-label">Workspace</div>
                  {activeWorkspaces.map((workspace) => (
                    <button
                      key={workspace.id}
                      className="workspace-menu-item"
                      role="menuitem"
                      type="button"
                      onClick={() => activateWorkspace(workspace.id)}
                    >
                      <span>{workspace.name}</span>
                      {workspace.id === activeWorkspaceId ? <span className="workspace-menu-active">Active</span> : null}
                    </button>
                  ))}
                  {createWorkspaceOpen ? (
                    <div className="workspace-create-panel">
                      <label className="workspace-create-label">
                        <span>Workspace name</span>
                        <input value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} />
                      </label>
                      <button className="workflow-button workflow-button-primary" type="button" disabled={workspaceName.trim().length === 0} onClick={createWorkspace}>
                        Create
                      </button>
                    </div>
                  ) : (
                    <button className="workspace-menu-item workspace-menu-create" type="button" onClick={() => setCreateWorkspaceOpen(true)}>
                      <Plus size={14} />
                      <span>Create workspace</span>
                    </button>
                  )}
                </div>
              ) : null}
            </div>

            <nav aria-label="Tenant" className="space-y-7">
              <NavSection title="Build" items={primaryNavigation} />
              <NavSection title="Operate" items={secondaryNavigation} />
            </nav>
          </div>

        </aside>

        <div className="shell-main">
          <main className="shell-scroll-region px-4 py-5 md:px-6 md:py-6" data-testid="shell-scroll-region">
            <div className="shell-scroll-content">
            <Routes>
              <Route path="/" element={<DashboardScreen workspaceName={activeWorkspace.name} organizationName={currentOrganization.name} />} />
              <Route
                path="/workflows"
                element={
                  <WorkflowBuilderScreen
                    activeWorkspaceId={activeWorkspaceId}
                    workspaces={workspaces}
                  />
                }
              />
              <Route path="/sandbox" element={<SandboxScreen activeWorkspaceId={activeWorkspaceId} workspaces={workspaces} showToast={showToast} />} />
              <Route path="/calls" element={<TelephonyScreen activeWorkspaceId={activeWorkspaceId} workspaces={workspaces} showToast={showToast} />} />
              <Route path="/integrations" element={<TenantIntegrationsScreen organizationId={tenantId} activeWorkspaceId={activeWorkspaceId} showToast={showToast} />} />
              <Route path="/memory" element={<TenantMemoryScreen organizationId={tenantId} activeWorkspaceId={activeWorkspaceId} showToast={showToast} />} />
              <Route path="/billing" element={<TenantBillingScreen organizationId={tenantId} activeWorkspaceId={activeWorkspaceId} showToast={showToast} />} />
              <Route
                path="/settings"
                element={
                  <WorkspaceSettingsScreen
                    activeWorkspaceId={activeWorkspaceId}
                    workspaces={workspaces}
                    memberships={workspaceMemberships}
                    auditEntries={workspaceAuditEntries}
                    directoryUsers={directoryUsers}
                    onRenameWorkspace={renameWorkspace}
                    onArchiveWorkspace={archiveWorkspace}
                    onRestoreWorkspace={restoreWorkspace}
                    onGrantWorkspaceRole={setWorkspaceRole}
                    onUpdateWorkspaceRole={setWorkspaceRole}
                    onRevokeWorkspaceRole={revokeWorkspaceRole}
                    showToast={showToast}
                  />
                }
              />
            </Routes>
            </div>
          </main>
        </div>
      </div>
      {shellToast !== null ? (
        <div className="workflow-toast" role="status" aria-live="polite">
          {shellToast}
        </div>
      ) : null}
    </div>
  );
}

function AuthLoadingScreen() {
  return (
    <main className="auth-screen" aria-busy="true">
      <section className="auth-card">
        <div className="auth-brand-mark">Z</div>
        <p className="auth-eyebrow">Session</p>
        <h1>Checking your Zara session</h1>
        <p>Confirming secure access before opening the tenant workspace.</p>
      </section>
    </main>
  );
}

function TenantAccessRequiredScreen({
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

function TenantLoginScreen({
  authClient,
  mode,
  onAuthChanged,
}: {
  authClient: ZaraAuthClient;
  mode: "signin" | "signup";
  onAuthChanged: () => void;
}) {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const isSignup = mode === "signup";

  const submitAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setErrorMessage(null);

    const result = isSignup
      ? await authClient.signUpEmail({
        email,
        password,
        name,
        organizationName,
        callbackURL: "/",
      })
      : await authClient.signInEmail({
        email,
        password,
        callbackURL: window.location.pathname,
      });

    setSubmitting(false);

    if (!result.ok) {
      setErrorMessage(result.message);
      return;
    }

    if (isSignup) {
      navigate("/", { replace: true });
    }
    onAuthChanged();
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
                  onChange={(event) => setName(event.target.value)}
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
                  onChange={(event) => setOrganizationName(event.target.value)}
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
              onChange={(event) => setEmail(event.target.value)}
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
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          {errorMessage === null ? null : <p className="auth-error" role="alert">{errorMessage}</p>}
          <button className="auth-submit" type="submit" disabled={submitting}>
            {submitting ? submittingLabel : submitLabel}
          </button>
        </form>
        <p className="auth-switch">
          {isSignup ? "Already have an account?" : "Need an account?"}{" "}
          <NavLink to={isSignup ? "/" : "/signup"}>
            {isSignup ? "Sign in" : "Create one"}
          </NavLink>
        </p>
      </section>
    </main>
  );
}

function DashboardScreen({
  workspaceName,
  organizationName,
}: {
  workspaceName: string;
  organizationName: string;
}) {
  const workspaceSections = [...primaryNavigation, ...secondaryNavigation].filter((item) => item.path !== "/");

  return (
    <div className="dashboard-page">
      <section className="dashboard-heading">
        <div className="eyebrow-copy">{organizationName}</div>
        <h1 className="headline-copy mt-1">Operations</h1>
        <p className="body-copy mt-3">Workspace: {workspaceName}</p>
      </section>

      <nav className="dashboard-section-list" aria-label="Workspace sections">
        {workspaceSections.map((item) => {
          const Icon = item.icon;

          return (
            <NavLink
              key={item.path}
              to={item.path}
              className="dashboard-section-link"
              aria-label={`Open ${item.label} section`}
            >
              <Icon size={17} />
              <span>{item.label}</span>
              <ChevronDown size={15} aria-hidden="true" />
            </NavLink>
          );
        })}
      </nav>
    </div>
  );
}

function NavSection({
  title,
  items,
}: {
  title: string;
  items: ReadonlyArray<{
    label: string;
    path: string;
    icon: typeof LayoutGrid;
  }>;
}) {
  return (
    <div>
      <div className="nav-section-title">{title}</div>
      <div className="space-y-0.5">
        {items.map((item) => {
          const Icon = item.icon;

          return (
            <NavLink
              key={item.label}
              end={item.path === "/"}
              to={item.path}
              className={({ isActive }) => ["nav-link", isActive ? "nav-link-active" : ""].filter(Boolean).join(" ")}
            >
              <Icon size={16} />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </div>
    </div>
  );
}

function getInitialTheme(): Theme {
  if (typeof window === "undefined") {
    return "light";
  }

  const storedTheme = window.localStorage.getItem("zara-theme");

  if (storedTheme === "light" || storedTheme === "dark") {
    return storedTheme;
  }

  return "light";
}
