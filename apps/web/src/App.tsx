import { type FormEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import {
  Activity,
  ArrowRight,
  BadgeCheck,
  Bot,
  Cable,
  ChevronDown,
  CreditCard,
  DatabaseZap,
  GitBranchPlus,
  HardDrive,
  LayoutGrid,
  MemoryStick,
  MoonStar,
  PhoneCall,
  Search,
  Settings,
  ShieldCheck,
  SunMedium,
  UserCircle2,
  AudioLines,
  Plus,
} from "lucide-react";
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { tenantAuthClient, type ZaraAuthClient, type ZaraAuthContext } from "@zara/auth-client";
import {
  createWorkspace as buildWorkspace,
  renameWorkspace as renameWorkspaceModel,
  revokeWorkspaceMembership as revokeWorkspaceMembershipModel,
  setWorkspaceMembershipRole as setWorkspaceMembershipRoleModel,
  slugifyWorkspaceName,
  validateWorkspaceCreate,
  type TenantRole,
  type WorkspaceAuditEntry,
  type WorkspaceDirectoryUser,
  type WorkspaceMembership,
} from "@zara/core";

import { SandboxScreen } from "./SandboxScreen";
import { TelephonyScreen } from "./TelephonyScreen";
import { TenantBillingScreen, TenantIntegrationsScreen, TenantMemoryScreen } from "./TenantPages";
import { fetchIntegrationConnections, fetchToolGrants, type IntegrationConnection, type ToolGrant } from "./tenantIntegrationsApi";
import { fetchTenantBillingState, type TenantBillingState } from "./tenantBillingApi";
import { fetchTenantMemoryExport, type TenantMemoryExport } from "./tenantMemoryApi";
import { fetchTelephonyState, type TelephonyStateResponse } from "./telephonyApi";
import { WorkflowBuilderScreen } from "./WorkflowBuilder";
import { WorkspaceSettingsScreen } from "./WorkspaceSettingsScreen";
import { loadPublishedWorkflowVersionsForWorkspace } from "./workflowSandboxRegistry";
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
  const navigate = useNavigate();
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
  const [authContext, setAuthContext] = useState<ZaraAuthContext | null>(null);
  const [authContextLoading, setAuthContextLoading] = useState(false);
  const [shellToast, setShellToast] = useState<string | null>(null);
  const profileMenuRef = useRef<HTMLDivElement | null>(null);
  const workspaceMenuRef = useRef<HTMLDivElement | null>(null);
  const workspaceRequestIdRef = useRef(0);
  const currentSession = authSnapshot.data;
  const currentUser = currentSession?.user ?? null;
  const currentOrganization = currentSession?.organization ?? null;
  const activeOrganizationId = currentOrganization?.id ?? tenantId;
  const activeActorUserId = currentUser?.id ?? "user-ops-lead";
  const activeWorkspace =
    workspaces.find((workspace) => workspace.id === activeWorkspaceId)
    ?? workspaces.find((workspace) => workspace.status === "active")
    ?? workspaces[0]!;

  const refreshAuth = useCallback(() => {
    setAuthRevision((current) => current + 1);
  }, []);

  void authRevision;

  useEffect(() => {
    let cancelled = false;

    if (authSnapshot.data === null) {
      setAuthContext(null);
      setAuthContextLoading(false);
      return undefined;
    }

    setAuthContextLoading(true);

    void authClient.getContext()
      .then((context) => {
        if (!cancelled) {
          setAuthContext(context);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setAuthContext(null);
          setShellToast(error instanceof Error ? error.message : "Tenant context could not be loaded.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setAuthContextLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [authClient, authRevision, authSnapshot.data, currentOrganization?.id]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem("zara-theme", theme);
  }, [theme]);

  useEffect(() => {
    if (currentOrganization === null) {
      return;
    }

    saveActiveWorkspaceId(activeWorkspaceId, activeOrganizationId);
  }, [activeOrganizationId, activeWorkspaceId, currentOrganization]);

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

    if (currentOrganization === null || currentUser === null) {
      return undefined;
    }

    void resolveLatestWorkspaceState(() => fetchWorkspaceState(activeOrganizationId))
      .then((state) => {
        if (cancelled || state === null) {
          return;
        }

        setActiveWorkspaceId((current) => resolveActiveWorkspaceId(state.workspaces, current, {
          organizationId: activeOrganizationId,
          memberships: state.memberships,
          userId: currentUser.id,
        }));
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
  }, [activeOrganizationId, currentOrganization, currentUser, resolveLatestWorkspaceState]);

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
        organizationId: activeOrganizationId,
        workspaceId,
        actorUserId: activeActorUserId,
      }));

      if (state === null) {
        return;
      }

      setActiveWorkspaceId((current) => resolveActiveWorkspaceId(state.workspaces, current, {
        organizationId: activeOrganizationId,
        memberships: state.memberships,
        userId: activeActorUserId,
      }));
    } catch (error) {
      setActiveWorkspaceId(previousWorkspaceId);
      showToast(error instanceof Error ? error.message : "Workspace switch could not be saved.");
    }
  };

  const createWorkspace = async () => {
    const trimmedWorkspaceName = workspaceName.trim();
    const validation = validateWorkspaceCreate({
      tenantId: activeOrganizationId,
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
      tenantId: activeOrganizationId,
      name: trimmedWorkspaceName,
      slug: slugifyWorkspaceName(trimmedWorkspaceName),
      createdBy: activeActorUserId,
    });

    setWorkspaces((current) => [...current, optimisticWorkspace]);
    setActiveWorkspaceId(optimisticWorkspace.id);
    setWorkspaceName("");
    setCreateWorkspaceOpen(false);
    setWorkspaceMenuOpen(false);

    try {
      const state = await resolveLatestWorkspaceState(() => createWorkspaceViaApi({
        organizationId: activeOrganizationId,
        name: trimmedWorkspaceName,
        actorUserId: activeActorUserId,
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
      tenantId: activeOrganizationId,
      nextName,
    });

    setWorkspaces(nextWorkspaces);

    try {
      const state = await resolveLatestWorkspaceState(() => renameWorkspaceViaApi({
        organizationId: activeOrganizationId,
        workspaceId,
        actorUserId: activeActorUserId,
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
      organizationId: activeOrganizationId,
      workspaceId,
      actorUserId: activeActorUserId,
      activeSessionCount: 0,
    }));

    if (state === null) {
      return;
    }

    setActiveWorkspaceId((current) =>
      current === workspaceId
        ? resolveActiveWorkspaceId(state.workspaces, undefined, {
            organizationId: activeOrganizationId,
            memberships: state.memberships,
            userId: activeActorUserId,
          })
        : resolveActiveWorkspaceId(state.workspaces, current, {
            organizationId: activeOrganizationId,
            memberships: state.memberships,
            userId: activeActorUserId,
          }),
    );
  };

  const restoreWorkspace = async (workspaceId: string) => {
    const state = await resolveLatestWorkspaceState(() => restoreWorkspaceViaApi({
      organizationId: activeOrganizationId,
      workspaceId,
      actorUserId: activeActorUserId,
    }));

    if (state === null) {
      return;
    }

    setActiveWorkspaceId((current) => resolveActiveWorkspaceId(state.workspaces, current, {
      organizationId: activeOrganizationId,
      memberships: state.memberships,
      userId: activeActorUserId,
    }));
  };

  const setWorkspaceRole = async (workspaceId: string, userId: string, role: TenantRole) => {
    const previousMemberships = workspaceMemberships;
    const nextMemberships = setWorkspaceMembershipRoleModel({
      memberships: workspaceMemberships,
      workspaceId,
      tenantId: activeOrganizationId,
      userId,
      role,
    });

    setWorkspaceMemberships(nextMemberships);

    try {
      if (await resolveLatestWorkspaceState(() => setWorkspaceMembershipRoleViaApi({
        organizationId: activeOrganizationId,
        workspaceId,
        userId,
        role,
        actorUserId: activeActorUserId,
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
      tenantId: activeOrganizationId,
      userId,
    });

    setWorkspaceMemberships(nextMemberships);

    try {
      if (await resolveLatestWorkspaceState(() => revokeWorkspaceMembershipViaApi({
        organizationId: activeOrganizationId,
        workspaceId,
        userId,
        actorUserId: activeActorUserId,
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
    if (location.pathname === "/") {
      return <MarketingLandingPageMockup />;
    }

    return (
      <TenantLoginScreen
        authClient={authClient}
        mode={location.pathname === "/signup" ? "signup" : "signin"}
        onAuthChanged={refreshAuth}
      />
    );
  }

  if (currentOrganization === null) {
    if (authContextLoading) {
      return <AuthLoadingScreen />;
    }

    if (authContext !== null && authContext.memberships.length > 1) {
      return (
        <TenantOrganizationChooserScreen
          authClient={authClient}
          memberships={authContext.memberships}
          onAuthChanged={refreshAuth}
        />
      );
    }

    return <TenantAccessRequiredScreen authClient={authClient} onAuthChanged={refreshAuth} />;
  }

  if (currentSession === null) {
    return <AuthLoadingScreen />;
  }

  if (location.pathname === "/login" || location.pathname === "/signup") {
    return <Navigate to="/" replace />;
  }

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
                        navigate("/", { replace: true });
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
              <Route
                path="/"
                element={
                  <DashboardScreen
                    organizationId={activeOrganizationId}
                    activeWorkspaceId={activeWorkspaceId}
                    workspaceName={activeWorkspace.name}
                    organizationName={currentOrganization.name}
                    memberships={workspaceMemberships}
                    auditEntries={workspaceAuditEntries}
                  />
                }
              />
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
              <Route path="/integrations" element={<TenantIntegrationsScreen organizationId={activeOrganizationId} activeWorkspaceId={activeWorkspaceId} showToast={showToast} />} />
              <Route path="/memory" element={<TenantMemoryScreen organizationId={activeOrganizationId} activeWorkspaceId={activeWorkspaceId} showToast={showToast} />} />
              <Route path="/billing" element={<TenantBillingScreen organizationId={activeOrganizationId} activeWorkspaceId={activeWorkspaceId} showToast={showToast} />} />
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

function MarketingLandingPageMockup() {
  useEffect(() => {
    document.title = "Zara Voice Automation | Managed AI Phone Agents";

    const description =
      "Zara designs, builds, and manages AI phone agents that answer calls, qualify leads, book appointments, update CRMs, and hand off to humans with context.";
    let descriptionMeta = document.querySelector<HTMLMetaElement>("meta[name='description']");

    if (descriptionMeta === null) {
      descriptionMeta = document.createElement("meta");
      descriptionMeta.name = "description";
      document.head.append(descriptionMeta);
    }

    descriptionMeta.content = description;
  }, []);

  const serviceCards = [
    ["AI Receptionist", "24/7 call answering with natural conversations and intelligent routing.", "receptionist"],
    ["Lead Qualification", "Qualify callers, capture key details, and surface high-intent opportunities.", "qualification"],
    ["Appointment Scheduling", "Check availability, book, reschedule, and send automated confirmations.", "calendar"],
    ["Support Triage", "Resolve common issues, route complex cases, and escalate with full context.", "support"],
  ] as const;

  const trustIndustries = [
    ["Home Services", "homeServices"],
    ["Healthcare", "headset"],
    ["Real Estate", "property"],
    ["Legal", "audit"],
    ["E-commerce", "support"],
    ["Financial Services", "growth"],
  ] as const;

  const useCases = [
    ["Never miss a call", "Answer instantly, day or night, even during peak call volumes.", "receptionist"],
    ["Convert more leads", "Qualify, nurture, and capture intent while the caller is engaged.", "qualification"],
    ["Fill your calendar", "Book more jobs and meetings with real-time availability.", "calendar"],
    ["Handoff with context", "When humans step in, they get the full story from the start.", "headset"],
  ] as const;

  const processSteps = [
    ["1", "Discover", "We learn your business, call flows, and goals."],
    ["2", "Design", "We design your agent, workflows, and integrations."],
    ["3", "Build & Test", "We build, test, and refine for real-world conversations."],
    ["4", "Launch", "We launch with confidence and monitor performance."],
    ["5", "Optimize", "We continuously optimize for better results."],
  ] as const;

  const outcomeCards = [
    ["65%+", "More calls answered", "Capture more opportunities that used to go to voicemail.", "receptionist"],
    ["30-50%", "Higher conversion", "Qualify and convert more high-intent callers.", "qualification"],
    ["2-3x", "More booked jobs", "Fill your calendar with qualified appointments.", "calendar"],
    ["40%+", "Lower cost per lead", "Automate top-of-funnel without sacrificing quality.", "growth"],
    ["4.9/5", "Caller satisfaction", "Natural conversations people actually like.", "support"],
  ] as const;

  const pricingCards = [
    ["Launch", "$2.5k", "setup", "For one phone line and a focused call flow.", ["AI receptionist", "Lead capture", "Calendar booking", "CRM handoff"], "Book launch plan"],
    ["Growth", "$4.5k", "setup", "For growing teams with qualification and routing.", ["Multi-step qualification", "Support triage", "Workflow reporting", "Weekly optimization"], "Book growth plan"],
    ["Scale", "Custom", "monthly", "For multi-location or regulated operations.", ["Custom integrations", "Advanced analytics", "SLA reviews", "Dedicated success manager"], "Talk to strategy"],
  ] as const;

  return (
    <main className="marketing-page marketing-page-mockup">
      <div className="agency-page-frame">
        <header className="marketing-nav">
          <NavLink className="marketing-brand" to="/" aria-label="Zara Voice Automation home">
            <MarketingLogo />
          </NavLink>
          <nav className="marketing-nav-links" aria-label="Landing">
            <a href="#services">Services</a>
            <a href="#use-cases">Use cases</a>
            <a href="#process">Process</a>
            <a href="#results">Results</a>
            <a href="#pricing">Pricing</a>
            <a href="#footer">About</a>
          </nav>
          <div className="marketing-nav-actions">
            <NavLink className="marketing-signin-button" to="/login">Sign in</NavLink>
            <NavLink className="marketing-dark-button" to="/signup">Book strategy call <ArrowRight size={14} /></NavLink>
            <a className="marketing-link-button" href="#workflow">See workflows <ArrowRight size={14} /></a>
          </div>
        </header>

        <section className="marketing-hero" aria-labelledby="marketing-hero-title">
          <div className="marketing-hero-copy">
            <div className="marketing-eyebrow"><span /> AI PHONE AGENTS</div>
            <h1 id="marketing-hero-title">
              <span>AI phone agents,</span>
              <span>built and managed</span>
            </h1>
            <p>
              Zara designs, builds, tests, and manages AI phone agents that answer calls,
              qualify leads, book appointments, route issues, and hand off to humans with context.
            </p>
            <div className="marketing-hero-actions">
              <NavLink className="marketing-dark-button marketing-hero-cta" to="/signup">
                Book strategy call <ArrowRight size={15} />
              </NavLink>
              <a className="marketing-light-button" href="#workflow">
                See workflows <ArrowRight size={15} />
              </a>
            </div>
          </div>

          <div className="agency-hero-visual" aria-label="Voice routing workflow mockup">
            <HeroStudioBackdrop />
            <HeroRoutingSvg />
            <GlassCallCard />
            <GlassRoutingCard />
            <GlassBookingCard />
            <GlassCrmCard />
            <GlassHandoffCard />
          </div>

          <div className="hero-proof-chips" aria-label="Proof points">
            {[
              ["Industry specialists", "receptionist"],
              ["Fast time to value", "growth"],
              ["Secure & compliant", "audit"],
            ].map(([label, icon]) => (
              <span key={label}>
                <MarketingVectorIcon name={icon as MarketingIconName} label={`${label} icon`} />
                {label}
              </span>
            ))}
          </div>
        </section>

        <section className="marketing-trust-row" aria-label="Trusted industries">
          <p>TRUSTED BY BUSINESSES THAT CAN'T AFFORD MISSED CALLS</p>
          <div>
            {trustIndustries.map(([label, icon]) => (
              <span key={label}>
                <MarketingVectorIcon name={icon as MarketingIconName} label={`${label} icon`} />
                {label}
              </span>
            ))}
          </div>
        </section>

        <section id="services" className="marketing-section">
          <div className="marketing-section-heading">
            <span className="marketing-eyebrow"><span /> SERVICES</span>
            <h2>Everything we handle</h2>
          </div>
          <div className="marketing-card-grid">
            {serviceCards.map(([title, copy, icon]) => (
              <article className="marketing-service-card" key={title}>
                <MarketingVectorIcon name={icon} label={`${title} service icon`} />
                <h3>{title}</h3>
                <p>{copy}</p>
                <a href="#workflow" aria-label={`Learn more about ${title}`}><ArrowRight size={14} /></a>
              </article>
            ))}
          </div>
        </section>

        <section id="use-cases" className="use-case-section">
          <div className="marketing-section-heading">
            <span className="marketing-eyebrow"><span /> USE CASES</span>
            <h2>Built for high-impact conversations</h2>
          </div>
          <div className="use-case-grid">
            {useCases.map(([title, copy, icon]) => (
              <article className="use-case-card" key={title}>
                <MarketingVectorIcon name={icon} label={`${title} icon`} />
                <h3>{title}</h3>
                <p>{copy}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="workflow" className="marketing-workflow-section">
          <span className="marketing-eyebrow"><span /> WORKFLOW PROOF</span>
          <h2>From hello to handoff, seamlessly</h2>
          <div className="workflow-proof-board">
            {[
              ["Incoming call", "(415) 555-0198", "San Francisco, CA"],
              ["AI Receptionist", "Hi! How can I help you?", "I need to book a cleaning this weekend."],
              ["Qualify & Capture", "Service needed", "Deep clean"],
              ["Book & Confirm", "May 27, 2026", "10:30 AM"],
              ["CRM Update", "New lead created", "Status New"],
              ["Human Handoff", "Alex Johnson", "Context attached"],
            ].map(([title, primary, secondary], index) => (
              <article className="workflow-proof-node" key={title}>
                <strong>{title}</strong>
                <span>{primary}</span>
                <small>{secondary}</small>
                {index === 0 ? <div className="mini-wave" aria-hidden="true"><span /><span /><span /><span /></div> : null}
              </article>
            ))}
          </div>
          <div className="workflow-stat-strip">
            <div><strong>100%</strong><span>Calls answered</span></div>
            <div><strong>&lt; 2s</strong><span>Average response</span></div>
            <div><strong>92%</strong><span>Containment rate</span></div>
            <div><strong>4.9/5</strong><span>Caller satisfaction</span></div>
          </div>
        </section>

        <section id="process" className="process-section">
          <div className="marketing-section-heading">
            <span className="marketing-eyebrow"><span /> PROCESS</span>
            <h2>A proven implementation process</h2>
          </div>
          <div className="marketing-process">
            {processSteps.map(([step, title, copy]) => (
              <article key={step}>
                <span>{step}</span>
                <h3>{title}</h3>
                <p>{copy}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="results" className="marketing-section marketing-results-section">
          <div className="marketing-section-heading">
            <span className="marketing-eyebrow"><span /> RESULTS</span>
            <h2>Measurable outcomes that matter</h2>
          </div>
          <div className="results-card-grid">
            {outcomeCards.map(([value, title, copy, icon]) => (
              <article className="result-card" key={title}>
                <MarketingVectorIcon name={icon as MarketingIconName} label={`${title} result icon`} />
                <strong>{value}</strong>
                <h3>{title}</h3>
                <p>{copy}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="pricing" className="marketing-section marketing-pricing-section">
          <div className="marketing-section-heading">
            <span className="marketing-eyebrow"><span /> PRICING</span>
            <h2>Simple packages for managed voice agents</h2>
          </div>
          <div className="marketing-pricing-grid">
            {pricingCards.map(([name, price, cadence, copy, bullets, cta], index) => (
              <article className={index === 1 ? "pricing-card pricing-card-featured" : "pricing-card"} key={name}>
                <div>
                  <h3>{name}</h3>
                  <p>{copy}</p>
                </div>
                <div className="pricing-card-price">
                  <strong>{price}</strong>
                  <span>{cadence}</span>
                </div>
                <ul>
                  {bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}
                </ul>
                <NavLink className={index === 1 ? "marketing-dark-button" : "marketing-light-button"} to="/signup">
                  {cta} <ArrowRight size={14} />
                </NavLink>
              </article>
            ))}
          </div>
        </section>

        <section id="cta" className="marketing-final-cta">
          <div>
            <h2>Ready to transform your phone into a growth engine?</h2>
            <p>Let's design an AI phone agent tailored to your business.</p>
          </div>
          <div>
            <NavLink className="marketing-dark-button" to="/signup">Book strategy call <ArrowRight size={15} /></NavLink>
            <a className="marketing-light-button" href="#workflow">See workflows <ArrowRight size={15} /></a>
          </div>
        </section>

        <footer id="footer" className="marketing-footer">
          <div className="footer-brand">
            <MarketingLogo />
            <p>AI phone agents that answer, qualify, book, and resolve so you can focus on growth.</p>
            <small>(c) 2026 Zara Voice Automation</small>
          </div>
          <nav aria-label="Footer">
            <div>
              <strong>Services</strong>
              <a href="#services">AI Receptionist</a>
              <a href="#services">Lead Qualification</a>
              <a href="#services">Appointment Scheduling</a>
              <a href="#services">Support Triage</a>
              <a href="#services">Integrations</a>
            </div>
            <div>
              <strong>Use cases</strong>
              <a href="#use-cases">Home Services</a>
              <a href="#use-cases">Healthcare</a>
              <a href="#use-cases">Real Estate</a>
              <a href="#use-cases">Legal</a>
              <a href="#use-cases">E-commerce</a>
            </div>
            <div>
              <strong>Company</strong>
              <a href="#footer">About</a>
              <a href="#results">Case Studies</a>
              <a href="#footer">Careers</a>
              <a href="#footer">Partners</a>
              <a href="#footer">Security</a>
            </div>
            <div className="footer-build">
              <strong>Let's build your agent</strong>
              <p>Book a strategy call and see your workflow.</p>
              <NavLink to="/signup">Book strategy call <ArrowRight size={14} /></NavLink>
            </div>
          </nav>
        </footer>
      </div>
    </main>
  );
}

function HeroStudioBackdrop() {
  return (
    <div className="hero-studio-backdrop" aria-hidden="true">
      <div className="studio-window"><span /><span /><span /></div>
      <div className="studio-light-beams"><span /><span /><span /></div>
      <div className="studio-reflection studio-reflection-cyan" />
      <div className="studio-reflection studio-reflection-pink" />
      <div className="studio-desk-plane" />
      <div className="studio-plant"><span /><span /><span /><span /><span /></div>
    </div>
  );
}

function HeroRoutingSvg() {
  return (
    <svg className="hero-routing-svg" aria-hidden="true" viewBox="0 0 570 330" preserveAspectRatio="none">
      <defs>
        <linearGradient id="hero-route-cyan" x1="250" y1="86" x2="510" y2="248" gradientUnits="userSpaceOnUse">
          <stop stopColor="#ecfffd" stopOpacity="0.2" />
          <stop offset="0.22" stopColor="#57e9df" stopOpacity="1" />
          <stop offset="0.66" stopColor="#4edbd3" stopOpacity="0.95" />
          <stop offset="1" stopColor="#ff89ad" stopOpacity="0.9" />
        </linearGradient>
        <filter id="hero-route-glow" x="-20%" y="-80%" width="140%" height="260%">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <path className="hero-route-path hero-route-path-main" d="M254 122H294C302 122 304 108 310 108" />
      <path className="hero-route-path hero-route-path-main" d="M254 154H294V236H310" />
      <path className="hero-route-path hero-route-path-soft" d="M294 128V236" />
      <path className="hero-route-path hero-route-path-soft" d="M294 156H310" />
      <path className="hero-route-path hero-route-path-soft" d="M294 188H310" />
      <path className="hero-route-path hero-route-path-soft" d="M176 254H294" />
      <path className="hero-route-path hero-route-path-soft" d="M306 252H338" />
      <path className="hero-route-path hero-route-path-pink" d="M294 236C308 242 324 246 338 248" />
      {[
        [254, 122],
        [294, 122],
        [310, 108],
        [254, 154],
        [294, 154],
        [310, 156],
        [310, 188],
        [176, 254],
        [306, 252],
      ].map(([cx, cy]) => (
        <circle className="hero-route-node" cx={cx} cy={cy} r="4.5" key={`${cx}-${cy}`} />
      ))}
      <circle className="hero-route-node hero-route-node-pink" cx="338" cy="248" r="4.5" />
    </svg>
  );
}

function GlassCallCard() {
  return (
    <article className="glass-panel hero-glass-card hero-call-card">
      <div className="hero-card-topline">
        <strong>Inbound call</strong>
        <span>Live</span>
      </div>
      <div className="hero-phone-number">(415) 555-0198</div>
      <p>01:24 Â· from San Francisco, CA</p>
      <div className="hero-wave" aria-hidden="true">
        {Array.from({ length: 34 }, (_, index) => <span key={index} />)}
      </div>
    </article>
  );
}

function GlassRoutingCard() {
  const routingRows = ["AI Receptionist", "Lead Qualification", "Appointment Booking", "Customer Support", "Human Handoff"] as const;
  const rowStates = ["Active", "Next", "Queued", "On demand", "Ready"] as const;

  return (
    <article className="glass-panel hero-glass-card hero-routing-card">
      <div className="hero-card-topline">
        <strong>Call routing</strong>
        <span>Active</span>
      </div>
      {routingRows.map((label, index) => (
        <div className="routing-row" key={label}>
          <i />
          <span>{label}</span>
          <small>{rowStates[index]}</small>
        </div>
      ))}
    </article>
  );
}

function GlassBookingCard() {
  return (
    <article className="glass-panel hero-glass-card hero-booking-card">
      <strong>Booking</strong>
      <div className="booking-date">May 27, 2026 <span>Tue</span></div>
      {["10:30 AM", "11:00 AM", "12:30 AM"].map((slot, index) => (
        <div className={index === 0 ? "booking-slot booking-slot-active" : "booking-slot"} key={slot}>
          {slot}
          {index === 0 ? <span>âœ“</span> : null}
        </div>
      ))}
    </article>
  );
}

function GlassCrmCard() {
  return (
    <article className="glass-panel hero-glass-card hero-crm-card">
      <strong>CRM update</strong>
      <div className="crm-record">New lead created</div>
      <dl>
        <div><dt>Intent</dt><dd>House cleaning</dd></div>
        <div><dt>Service</dt><dd>Deep clean</dd></div>
        <div><dt>Value</dt><dd>$240</dd></div>
        <div><dt>Source</dt><dd>Phone call</dd></div>
      </dl>
    </article>
  );
}

function GlassHandoffCard() {
  return (
    <article className="glass-panel hero-glass-card hero-handoff-card">
      <strong>Handoff</strong>
      <div className="handoff-person">
        <span>AJ</span>
        <div>
          <b>Alex Johnson</b>
          <small>Sr. Support Specialist</small>
        </div>
      </div>
      <p>Priority Â· Medium</p>
      <div className="handoff-check">Full context attached <span>âœ“</span></div>
    </article>
  );
}



type MarketingIconName =
  | "afterHours"
  | "audit"
  | "calendar"
  | "coaching"
  | "dental"
  | "design"
  | "headset"
  | "homeServices"
  | "qualification"
  | "property"
  | "receptionist"
  | "support"
  | "test"
  | "growth";

function MarketingLogo() {
  return (
    <span className="marketing-logo" aria-label="Zara voice automation logo mark">
      <span className="marketing-wordmark">
        ZARA
        <svg aria-hidden="true" viewBox="0 0 24 12">
          <path d="M2 3.5 8.5 8 11 5.5 17 9 22 6" />
          <path d="M8.5 8 8.5 4" />
        </svg>
      </span>
      <small>Voice automation</small>
    </span>
  );
}

function MarketingVectorIcon({ name, label }: { name: MarketingIconName; label: string }) {
  return (
    <svg className={`marketing-vector-icon marketing-vector-icon-${name}`} role="img" aria-label={label} viewBox="0 0 48 48">
      <IconPaths name={name} />
    </svg>
  );
}


function IconPaths({ name }: { name: MarketingIconName }) {
  switch (name) {
    case "receptionist":
      return (
        <>
          <path d="M14 28v-6a10 10 0 0 1 20 0v6" />
          <path d="M14 28h5v8h-5a4 4 0 0 1-4-4v0a4 4 0 0 1 4-4Z" />
          <path d="M34 28h-5v8h5a4 4 0 0 0 4-4v0a4 4 0 0 0-4-4Z" />
          <path d="M28 36h-5" />
        </>
      );
    case "qualification":
      return (
        <>
          <path d="M17 33c2-7 6-11 14-12" />
          <path d="M16 18a7 7 0 1 0 9 9" />
          <path d="M31 12h7v7" />
          <path d="M28 22 38 12" />
        </>
      );
    case "calendar":
      return (
        <>
          <rect x="11" y="13" width="26" height="25" rx="4" />
          <path d="M17 10v7M31 10v7M11 21h26" />
          <path d="M18 28h4M26 28h4M18 34h4" />
        </>
      );
    case "headset":
      return (
        <>
          <path d="M12 28v-5a12 12 0 0 1 24 0v5" />
          <path d="M12 28h6v9h-3a3 3 0 0 1-3-3Z" />
          <path d="M36 28h-6v9h3a3 3 0 0 0 3-3Z" />
          <path d="M29 37h-7" />
        </>
      );
    case "afterHours":
      return (
        <>
          <path d="M25 11a13 13 0 1 0 12 18 10 10 0 0 1-12-18Z" />
          <path d="M35 10v5M37.5 12.5h-5" />
        </>
      );
    case "dental":
      return (
        <>
          <path d="M17 14c-4 0-7 3-7 8 0 8 5 17 9 17 3 0 2-8 5-8s2 8 5 8c4 0 9-9 9-17 0-5-3-8-7-8-3 0-4 2-7 2s-4-2-7-2Z" />
          <path d="M18 20c2 1 4 1 6 0" />
        </>
      );
    case "property":
      return (
        <>
          <path d="M11 38h26V18L24 10 11 18Z" />
          <path d="M19 38V26h10v12" />
          <path d="M16 22h4M28 22h4" />
        </>
      );
    case "homeServices":
      return (
        <>
          <path d="M16 14 34 32" />
          <path d="m30 14 4 4-16 16-5 1 1-5Z" />
          <path d="M15 15a5 5 0 0 0-5 6l5-5 4 4-5 5a5 5 0 0 0 6-5" />
        </>
      );
    case "coaching":
      return (
        <>
          <circle cx="24" cy="17" r="6" />
          <path d="M13 38c2-8 7-12 11-12s9 4 11 12" />
          <path d="M16 31h16" />
        </>
      );
    case "support":
      return (
        <>
          <rect x="11" y="13" width="26" height="22" rx="5" />
          <path d="M18 35v6l7-6" />
          <path d="M18 22h12M18 28h8" />
        </>
      );
    case "audit":
      return (
        <>
          <path d="M14 15c4-4 11-4 16 0" />
          <path d="M10 24c6-6 22-6 28 0" />
          <path d="M15 33c4-3 14-3 18 0" />
          <path d="M25 9 34 4" />
        </>
      );
    case "design":
      return (
        <>
          <path d="M13 28h9v9h-9Z" />
          <path d="M26 11h9v9h-9Z" />
          <path d="M22 32h8a6 6 0 0 0 6-6v-6" />
          <path d="M26 15h-8a6 6 0 0 0-6 6v7" />
        </>
      );
    case "test":
      return (
        <>
          <path d="M12 27c6-8 18-8 24 0" />
          <path d="M18 32c3-4 9-4 12 0" />
          <path d="M24 37h.1" />
          <path d="M14 14h20" />
        </>
      );
    case "growth":
      return (
        <>
          <path d="M11 36h26" />
          <path d="M15 31v-8M24 31V16M33 31V11" />
          <path d="m13 19 7-6 6 4 9-9" />
        </>
      );
  }
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

function TenantOrganizationChooserScreen({
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
      <section className="auth-card" aria-labelledby="tenant-organization-title">
        <div className="auth-brand-mark">Z</div>
        <p className="auth-eyebrow">Tenant selection</p>
        <h1 id="tenant-organization-title">Choose a tenant</h1>
        <p>Select the tenant organization you want to operate in. Zara will open the workspace you can access for that tenant.</p>
        <div className="tenant-choice-list" role="list">
          {memberships.map((membership) => (
            <button
              key={membership.organizationId}
              aria-label={`Choose ${membership.organizationName}`}
              className="tenant-choice-button"
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
              <span>{membership.role}</span>
            </button>
          ))}
        </div>
        {errorMessage === null ? null : <p className="auth-error" role="alert">{errorMessage}</p>}
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

  useEffect(() => {
    document.title = isSignup
      ? "Create Zara Account | Zara Voice Automation"
      : "Zara Tenant Login | Zara Voice Automation";
  }, [isSignup]);

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
      })
      : await authClient.signInEmail({
        email,
        password,
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
          <NavLink to={isSignup ? "/login" : "/signup"}>
            {isSignup ? "Sign in" : "Create one"}
          </NavLink>
        </p>
      </section>
    </main>
  );
}

function DashboardScreen({
  organizationId,
  activeWorkspaceId,
  workspaceName,
  organizationName,
  memberships,
  auditEntries,
}: {
  organizationId: string;
  activeWorkspaceId: string;
  workspaceName: string;
  organizationName: string;
  memberships: WorkspaceMembership[];
  auditEntries: WorkspaceAuditEntry[];
}) {
  const [summary, setSummary] = useState<DashboardSummaryState>(() => createEmptyDashboardSummary());
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const publishedWorkflows = useMemo(
    () =>
      loadPublishedWorkflowVersionsForWorkspace({
        tenantId: organizationId,
        workspaceId: activeWorkspaceId,
      }),
    [activeWorkspaceId, organizationId],
  );
  const workspaceMembers = memberships.filter((membership) => membership.workspaceId === activeWorkspaceId);
  const lastAuditEntry = auditEntries
    .filter((entry) => entry.workspaceId === activeWorkspaceId)
    .sort((left, right) => right.at.localeCompare(left.at))[0];
  const activeConnections = summary.telephony?.connections.filter((connection) => connection.status === "active").length ?? 0;
  const routedNumbers = summary.telephony?.phoneNumbers.filter((phoneNumber) => phoneNumber.status === "routed").length ?? 0;
  const queuedCalls = summary.telephony?.dispatches.filter((dispatch) => dispatch.disposition === "queued").length ?? 0;
  const activeToolGrants = summary.toolGrants.filter((grant) => grant.status === "active").length;
  const healthyConnections = summary.integrations.filter((connection) => connection.health.status === "healthy").length;
  const activeMemories = summary.memory?.memories.filter((memory) => memory.status === "active" && memory.approvalState === "approved").length ?? 0;
  const pendingMemoryDrafts = summary.memory?.drafts.filter((draft) => draft.status === "draft").length ?? 0;
  const activeKnowledge = summary.memory?.knowledge.filter((record) => record.status === "active").length ?? 0;
  const latestPublishedWorkflow = publishedWorkflows.at(-1);
  const budgetLimit = summary.billing?.plan.budgetLimitUsd ?? 0;
  const budgetUsed = summary.billing?.plan.budgetUsedUsd ?? 0;
  const budgetPercent = budgetLimit > 0 ? Math.round((budgetUsed / budgetLimit) * 100) : 0;
  const primaryUsage = summary.billing?.usage.slice(0, 3) ?? [];
  const latestDispatch = summary.telephony?.dispatches[0];

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setErrorMessage(null);

    void Promise.allSettled([
      fetchTelephonyState(organizationId),
      fetchIntegrationConnections(organizationId),
      fetchToolGrants(organizationId, activeWorkspaceId),
      fetchTenantMemoryExport(organizationId),
      fetchTenantBillingState(organizationId),
    ]).then((results) => {
      if (cancelled) {
        return;
      }

      const [telephonyResult, integrationsResult, toolGrantsResult, memoryResult, billingResult] = results;

      setSummary({
        telephony: getSettledValue(telephonyResult),
        integrations: getSettledValue(integrationsResult) ?? [],
        toolGrants: getSettledValue(toolGrantsResult) ?? [],
        memory: getSettledValue(memoryResult),
        billing: getSettledValue(billingResult),
      });
      setLoading(false);

      if (results.some((result) => result.status === "rejected")) {
        setErrorMessage("Some dashboard metrics could not be loaded.");
      }
    });

    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId, organizationId]);

  return (
    <div className="dashboard-page">
      <section className="dashboard-hero surface-card">
        <div>
          <div className="eyebrow-copy">{organizationName}</div>
          <h1 className="headline-copy mt-1">Operations</h1>
          <p className="body-copy mt-3">
            {workspaceName} is summarized from live workspace, telephony, integration, memory, and billing state.
          </p>
        </div>
        <div className="dashboard-hero-facts" aria-label="Workspace facts">
          <div>
            <span>Members</span>
            <strong>{workspaceMembers.length}</strong>
          </div>
          <div>
            <span>Last change</span>
            <strong>{lastAuditEntry === undefined ? "No audit yet" : formatDashboardDate(lastAuditEntry.at)}</strong>
          </div>
        </div>
      </section>

      {loading ? <div className="tenant-status-banner tenant-status-banner-neutral" role="status">Loading dashboard metrics.</div> : null}
      {errorMessage === null ? null : <div className="tenant-status-banner tenant-status-banner-danger" role="alert">{errorMessage}</div>}

      <section className="dashboard-metric-grid" aria-label="Workspace metrics">
        <DashboardMetricCard
          icon={GitBranchPlus}
          label="Published workflows"
          value={String(publishedWorkflows.length)}
          detail={latestPublishedWorkflow === undefined ? "No published versions in this workspace" : `Latest version v${latestPublishedWorkflow.version}`}
        />
        <DashboardMetricCard
          icon={PhoneCall}
          label="Routed numbers"
          value={String(routedNumbers)}
          detail={`${activeConnections} active telephony connection${activeConnections === 1 ? "" : "s"}`}
        />
        <DashboardMetricCard
          icon={Cable}
          label="Active tool grants"
          value={String(activeToolGrants)}
          detail={`${healthyConnections} of ${summary.integrations.length} provider connections healthy`}
        />
        <DashboardMetricCard
          icon={CreditCard}
          label="Budget used"
          value={summary.billing === undefined ? "--" : formatDashboardUsd(budgetUsed)}
          detail={summary.billing === undefined ? "Billing state unavailable" : `${budgetPercent}% of ${formatDashboardUsd(budgetLimit)} workspace budget`}
        />
        <DashboardMetricCard
          icon={MemoryStick}
          label="Memory approvals"
          value={`${pendingMemoryDrafts} pending`}
          detail={`${activeMemories} approved memories, ${activeKnowledge} active knowledge records`}
        />
      </section>

      <section className="dashboard-grid">
        <article className="surface-card dashboard-panel">
          <div className="section-header">
            <div>
              <div className="eyebrow-copy">Calls</div>
              <div className="panel-title">Call operations</div>
            </div>
            <Activity size={16} />
          </div>
          <div className="dashboard-panel-body">
            <DashboardSignal label="Queued outbound calls" value={String(queuedCalls)} />
            <DashboardSignal
              label="Latest dispatch"
              value={latestDispatch === undefined ? "No dispatches yet" : formatDashboardStatus(latestDispatch.disposition)}
              detail={latestDispatch?.workflowLabel ?? latestDispatch?.reason}
            />
            <DashboardSignal label="Routed numbers" value={String(routedNumbers)} detail={`${activeConnections} active provider connections`} />
          </div>
        </article>

        <article className="surface-card dashboard-panel">
          <div className="section-header">
            <div>
              <div className="eyebrow-copy">Readiness</div>
              <div className="panel-title">Workflow readiness</div>
            </div>
            <BadgeCheck size={16} />
          </div>
          <div className="dashboard-panel-body">
            <DashboardSignal
              label="Published version"
              value={latestPublishedWorkflow === undefined ? "No version" : `v${latestPublishedWorkflow.version}`}
              detail={latestPublishedWorkflow?.graph.name ?? "Publish a workflow before routing production calls"}
            />
            <DashboardSignal label="Workspace members" value={String(workspaceMembers.length)} />
            <DashboardSignal label="Last workspace change" value={lastAuditEntry?.summary ?? "No workspace audit entries"} />
          </div>
        </article>

        <article className="surface-card dashboard-panel">
          <div className="section-header">
            <div>
              <div className="eyebrow-copy">Tools</div>
              <div className="panel-title">Connector health</div>
            </div>
            <ShieldCheck size={16} />
          </div>
          <div className="dashboard-panel-body">
            <DashboardSignal label="Provider health" value={`${healthyConnections} of ${summary.integrations.length} healthy`} />
            <DashboardSignal label="Active grants" value={String(activeToolGrants)} detail="Workflow tool permissions" />
            <DashboardSignal label="Webhook tools" value={String(summary.toolGrants.filter((grant) => grant.integrationConnectionId.includes("webhook")).length)} />
          </div>
        </article>

        <article className="surface-card dashboard-panel">
          <div className="section-header">
            <div>
              <div className="eyebrow-copy">Usage</div>
              <div className="panel-title">Billing usage</div>
            </div>
            <DatabaseZap size={16} />
          </div>
          <div className="dashboard-panel-body">
            <DashboardSignal
              label="Plan"
              value={summary.billing?.plan.name ?? "Unavailable"}
              detail={summary.billing === undefined ? undefined : formatDashboardStatus(summary.billing.plan.status)}
            />
            {primaryUsage.map((usage) => (
              <DashboardSignal
                key={usage.id}
                label={usage.label}
                value={`${usage.used.toLocaleString()} ${usage.unit}`}
                detail={`${formatDashboardUsd(usage.costUsd)} metered cost`}
              />
            ))}
          </div>
        </article>
      </section>
    </div>
  );
}

interface DashboardSummaryState {
  telephony?: TelephonyStateResponse | undefined;
  integrations: IntegrationConnection[];
  toolGrants: ToolGrant[];
  memory?: TenantMemoryExport | undefined;
  billing?: TenantBillingState | undefined;
}

function createEmptyDashboardSummary(): DashboardSummaryState {
  return {
    integrations: [],
    toolGrants: [],
  };
}

function getSettledValue<T>(result: PromiseSettledResult<T>): T | undefined {
  return result.status === "fulfilled" ? result.value : undefined;
}

function DashboardMetricCard({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: typeof LayoutGrid;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <article className="metric-card dashboard-metric-card" aria-label={`${label} metric`}>
      <div className="dashboard-metric-icon"><Icon size={16} /></div>
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      <div className="metric-detail">{detail}</div>
    </article>
  );
}

function DashboardSignal({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string | undefined;
}) {
  return (
    <div className="dashboard-signal">
      <div>
        <div className="metric-label">{label}</div>
        {detail === undefined ? null : <div className="metric-detail">{detail}</div>}
      </div>
      <strong>{value}</strong>
    </div>
  );
}

function formatDashboardUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDashboardStatus(value: string) {
  return value
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function formatDashboardDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
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
