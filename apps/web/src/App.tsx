import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

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
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import {
  tenantAuthClient,
  type ZaraAuthClient,
  type ZaraAuthContext,
  type ZaraAuthSession,
  type ZaraInvitation,
  type ZaraInvitationWorkspaceAccess,
} from "@zara/auth-client";
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

import { AuthLoadingScreen } from "./AuthLoadingScreen";
import { DashboardScreen } from "./DashboardScreen";
import { MarketingLandingPageMockup } from "./MarketingLandingPageMockup";
import { NavSection } from "./NavSection";
import { ResetPasswordScreen } from "./ResetPasswordScreen";
import { SandboxScreen } from "./SandboxScreen";
import { TelephonyScreen } from "./TelephonyScreen";
import { TenantAccessRequiredScreen } from "./TenantAccessRequiredScreen";
import { TenantLoginScreen } from "./TenantLoginScreen";
import { TenantOrganizationChooserScreen } from "./TenantOrganizationChooserScreen";
import { TenantBillingScreen, TenantIntegrationsScreen, TenantMemoryScreen } from "./TenantPages";
import { WorkflowBuilderScreen } from "./WorkflowBuilder";
import { WorkspaceSettingsScreen } from "./WorkspaceSettingsScreen";
import {
  createInitialWorkspaceState,
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




function authContextToSession(context: ZaraAuthContext | null): ZaraAuthSession | null {
  if (context?.authenticated !== true || context.user === null) {
    return null;
  }

  return {
    user: context.user,
    organization: context.activeOrganization,
    platformRole: context.platformRole ?? undefined,
    platformAuth: context.platformAuth,
  };
}

function isPublicAuthPath(pathname: string) {
  return pathname === "/" || pathname === "/login" || pathname === "/signup" || pathname === "/reset-password";
}

interface AppProps {
  authClient?: ZaraAuthClient;
}

function useAppModel({ authClient = tenantAuthClient }: AppProps = {}) {
  const [authRevision, setAuthRevision] = useState(0);
  const authSnapshot = authClient.useSession();
  const location = useLocation();
  const currentPathname = location.pathname;
  const navigate = useNavigate();
  const initialWorkspaceState = useMemo(() => createInitialWorkspaceState(), []);
  const [theme, setTheme] = useState<Theme>(() => getInitialTheme());
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [createWorkspaceOpen, setCreateWorkspaceOpen] = useState(false);
  const [workspaceName, setWorkspaceName] = useState("");
  const [directoryUsers, setDirectoryUsers] = useState<WorkspaceDirectoryUser[]>(() => initialWorkspaceState.directoryUsers);
  const [workspaces, setWorkspaces] = useState(() => initialWorkspaceState.workspaces);
  const [activeWorkspaceOverrideId, setActiveWorkspaceOverrideId] = useState<string | null>(null);
  const [workspaceMemberships, setWorkspaceMemberships] = useState(() => initialWorkspaceState.memberships);
  const [workspaceAuditEntries, setWorkspaceAuditEntries] = useState(() => initialWorkspaceState.auditEntries);
  const [authContextState, setAuthContextState] = useState(() => ({
    context: null as ZaraAuthContext | null,
    errorMessage: null as string | null,
    loading: true,
    revision: authRevision,
  }));
  const [shellToast, setShellToast] = useState<string | null>(null);
  const profileMenuRef = useRef<HTMLDivElement | null>(null);
  const workspaceMenuRef = useRef<HTMLDivElement | null>(null);
  const workspaceRequestIdRef = useRef(0);
  const authContext = authContextState.revision === authRevision ? authContextState.context : null;
  const authContextLoading = authContextState.revision === authRevision ? authContextState.loading : true;
  const authContextErrorMessage = authContextState.revision === authRevision ? authContextState.errorMessage : null;
  const visibleShellToast = shellToast ?? authContextErrorMessage;
  const rawSession = authSnapshot.data;
  const rawUser = rawSession?.user ?? null;
  const contextOrganization =
    rawUser !== null
    && authContext?.authenticated === true
    && authContext.user?.id === rawUser.id
      ? authContext.activeOrganization
      : null;
  const contextSession = authContextToSession(authContext);
  const currentSession = rawSession === null
    ? contextSession
    : {
        ...rawSession,
        organization: rawSession.organization ?? contextOrganization,
      };
  const currentUser = currentSession?.user ?? null;
  const currentOrganization = currentSession?.organization ?? null;
  const currentUserId = currentUser?.id ?? null;
  const currentOrganizationId = currentOrganization?.id ?? null;
  const activeOrganizationId = currentOrganizationId ?? tenantId;
  const activeActorUserId = currentUserId ?? "user-ops-lead";
  const authContextActiveWorkspaceId =
    authContext?.activeOrganization?.id === activeOrganizationId && authContext.activeWorkspace !== null
      ? authContext.activeWorkspace.id
      : undefined;
  const activeActorHasWorkspaceMembership = workspaceMemberships.some((membership) =>
    membership.tenantId === activeOrganizationId && membership.userId === activeActorUserId,
  );
  const activeWorkspaceResolutionOptions = activeActorHasWorkspaceMembership
    ? {
        organizationId: activeOrganizationId,
        memberships: workspaceMemberships,
        userId: activeActorUserId,
      }
    : {
        organizationId: activeOrganizationId,
      };
  const validActiveWorkspaceOverrideId =
    activeWorkspaceOverrideId !== null
    && workspaces.some((workspace) => workspace.id === activeWorkspaceOverrideId && workspace.status === "active")
      ? activeWorkspaceOverrideId
      : null;
  const activeWorkspaceId = resolveActiveWorkspaceId(
    workspaces,
    validActiveWorkspaceOverrideId ?? authContextActiveWorkspaceId,
    validActiveWorkspaceOverrideId !== null
      ? { organizationId: activeOrganizationId }
      : activeWorkspaceResolutionOptions,
  );
  const invitationsRequestKey = currentOrganizationId === null || currentPathname !== "/settings"
    ? ""
    : `${activeOrganizationId}:${activeWorkspaceId}`;
  const [invitationsState, setInvitationsState] = useState(() => ({
    invitations: [] as ZaraInvitation[],
    key: invitationsRequestKey,
  }));
  if (authContextState.revision !== authRevision) {
    setAuthContextState({
      context: null,
      errorMessage: null,
      loading: true,
      revision: authRevision,
    });
  }

  if (invitationsState.key !== invitationsRequestKey) {
    setInvitationsState({
      invitations: [],
      key: invitationsRequestKey,
    });
  }

  const invitations = invitationsState.key === invitationsRequestKey ? invitationsState.invitations : [];
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

    const resolveAuthContextState = async () => {
      try {
        return {
          context: await authClient.getContext(),
          errorMessage: null,
          loading: false,
          revision: authRevision,
        };
      } catch (error) {
        return {
          context: null,
          errorMessage: error instanceof Error ? error.message : "Tenant context could not be loaded.",
          loading: false,
          revision: authRevision,
        };
      }
    };

    void resolveAuthContextState().then((nextAuthContextState) => {
      if (!cancelled) {
        setAuthContextState((current) => current.revision === authRevision
          ? {
              context: nextAuthContextState.context,
              errorMessage: nextAuthContextState.errorMessage,
              loading: nextAuthContextState.loading,
              revision: nextAuthContextState.revision,
            }
          : current);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [authClient, authRevision]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem("zara-theme", theme);
  }, [theme]);

  useEffect(() => {
    if (currentOrganizationId === null) {
      return;
    }

    saveActiveWorkspaceId(activeWorkspaceId, activeOrganizationId);
  }, [activeOrganizationId, activeWorkspaceId, currentOrganizationId]);

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

  const themeToggleLabel = theme === "dark" ? "Light mode" : "Dark mode";
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

  const resolveLatestWorkspaceState = useCallback((request: () => Promise<WorkspaceStateResponse>) => {
    const requestId = ++workspaceRequestIdRef.current;

    return request().then((state) => {
      if (requestId !== workspaceRequestIdRef.current) {
        return null;
      }

      applyWorkspaceState(state);
      return state;
    });
  }, [applyWorkspaceState]);

  useEffect(() => {
    let cancelled = false;

    if (currentOrganizationId === null || currentUserId === null) {
      return undefined;
    }

    void resolveLatestWorkspaceState(() => fetchWorkspaceState(activeOrganizationId))
      .then(() => undefined)
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setShellToast(error instanceof Error ? error.message : "Workspace state could not be loaded.");
      });

    return () => {
      cancelled = true;
    };
  }, [activeOrganizationId, currentOrganizationId, currentUserId, resolveLatestWorkspaceState]);

  useEffect(() => {
    let cancelled = false;

    if (currentOrganizationId === null || currentPathname !== "/settings") {
      return undefined;
    }

    void authClient.listInvitations({ organizationId: activeOrganizationId })
      .then((result) => {
        if (cancelled) {
          return;
        }

        if (!result.ok) {
          showToast(result.message);
          return;
        }

        setInvitationsState((current) => current.key === invitationsRequestKey
          ? {
              invitations: result.invitations,
              key: invitationsRequestKey,
            }
          : current);
      })
      .catch((error) => {
        if (!cancelled) {
          showToast(error instanceof Error ? error.message : "Invitations could not be loaded.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeOrganizationId, authClient, currentOrganizationId, currentPathname, invitationsRequestKey, showToast]);

  const activateWorkspace = (workspaceId: string) => {
    const previousWorkspaceId = activeWorkspaceId;

    if (workspaceId === previousWorkspaceId) {
      setWorkspaceMenuOpen(false);
      return;
    }

    setActiveWorkspaceOverrideId(workspaceId);
    setWorkspaceMenuOpen(false);

    void (async () => {
      try {
        const state = await resolveLatestWorkspaceState(() => markWorkspaceAccessedViaApi({
          organizationId: activeOrganizationId,
          workspaceId,
          actorUserId: activeActorUserId,
        }));

        if (state === null) {
          return;
        }

        setActiveWorkspaceOverrideId(resolveActiveWorkspaceId(state.workspaces, workspaceId, {
          organizationId: activeOrganizationId,
          memberships: state.memberships,
          userId: activeActorUserId,
        }));
      } catch (error) {
        setActiveWorkspaceOverrideId(previousWorkspaceId);
        showToast(error instanceof Error ? error.message : "Workspace switch could not be saved.");
      }
    })();
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
    setActiveWorkspaceOverrideId(optimisticWorkspace.id);
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
        setActiveWorkspaceOverrideId(createdWorkspace.id);
      }

      showToast(`${createdWorkspace?.name ?? "Workspace"} created.`);
    } catch (error) {
      setWorkspaces(previousWorkspaces);
      setActiveWorkspaceOverrideId(previousActiveWorkspaceId);
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

      setActiveWorkspaceOverrideId(resolveActiveWorkspaceId(state.workspaces, activeWorkspaceId));
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

    setActiveWorkspaceOverrideId(
      activeWorkspaceId === workspaceId
        ? resolveActiveWorkspaceId(state.workspaces, undefined, {
            organizationId: activeOrganizationId,
            memberships: state.memberships,
            userId: activeActorUserId,
          })
        : resolveActiveWorkspaceId(state.workspaces, activeWorkspaceId, {
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

    setActiveWorkspaceOverrideId(resolveActiveWorkspaceId(state.workspaces, activeWorkspaceId, {
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

  const createInvitation = async (input: {
    email: string;
    role: TenantRole;
    workspaceAccess: ZaraInvitationWorkspaceAccess | null;
  }) => {
    const result = await authClient.createInvitation({
      organizationId: activeOrganizationId,
      email: input.email,
      role: input.role,
      workspaceAccess: input.workspaceAccess,
    });

    if (!result.ok) {
      throw new Error(result.message);
    }

    setInvitationsState((current) => ({
      invitations: upsertInvitation(current.invitations, result.invitation),
      key: current.key,
    }));
  };

  const revokeInvitation = async (invitationId: string) => {
    const result = await authClient.revokeInvitation({ invitationId });

    if (!result.ok) {
      throw new Error(result.message);
    }

    setInvitationsState((current) => ({
      invitations: upsertInvitation(current.invitations, result.invitation),
      key: current.key,
    }));
  };

  if (authSnapshot.isPending) {
    return <AuthLoadingScreen />;
  }

  if (currentSession === null) {
    if (authContextLoading && !isPublicAuthPath(currentPathname)) {
      return <AuthLoadingScreen />;
    }

    if (currentPathname === "/reset-password") {
      return (
        <ResetPasswordScreen
          authClient={authClient}
          onComplete={() => navigate("/login", { replace: true })}
        />
      );
    }

    if (currentPathname === "/") {
      return <MarketingLandingPageMockup />;
    }

    return (
      <TenantLoginScreen
        authClient={authClient}
        mode={currentPathname === "/signup" ? "signup" : "signin"}
        onAuthChanged={refreshAuth}
      />
    );
  }

  if (currentOrganization === null) {
    if (authContextLoading || authContext === null) {
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

  if (currentPathname === "/login" || currentPathname === "/signup") {
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
                  />
                }
              />
              <Route
                path="/workflows"
                element={
                  <WorkflowBuilderScreen
                    key={`${activeOrganizationId}:${activeWorkspaceId}`}
                    activeWorkspaceId={activeWorkspaceId}
                    actorUserId={activeActorUserId}
                    organizationId={activeOrganizationId}
                    workspaces={workspaces}
                  />
                }
              />
              <Route
                path="/sandbox"
                element={
                  <SandboxScreen
                    key={`${activeOrganizationId}:${activeWorkspaceId}`}
                    activeWorkspaceId={activeWorkspaceId}
                    workspaces={workspaces}
                    showToast={showToast}
                  />
                }
              />
              <Route path="/calls" element={<TelephonyScreen activeWorkspaceId={activeWorkspaceId} workspaces={workspaces} showToast={showToast} />} />
              <Route path="/integrations" element={<TenantIntegrationsScreen organizationId={activeOrganizationId} activeWorkspaceId={activeWorkspaceId} showToast={showToast} />} />
              <Route path="/memory" element={<TenantMemoryScreen organizationId={activeOrganizationId} activeWorkspaceId={activeWorkspaceId} showToast={showToast} />} />
              <Route path="/billing" element={<TenantBillingScreen organizationId={activeOrganizationId} activeWorkspaceId={activeWorkspaceId} showToast={showToast} />} />
              <Route
                path="/settings"
                element={
                  <WorkspaceSettingsScreen
                    authClient={authClient}
                    activeWorkspaceId={activeWorkspaceId}
                    workspaces={workspaces}
                    memberships={workspaceMemberships}
                    auditEntries={workspaceAuditEntries}
                    directoryUsers={directoryUsers}
                    invitations={invitations}
                    onRenameWorkspace={renameWorkspace}
                    onArchiveWorkspace={archiveWorkspace}
                    onRestoreWorkspace={restoreWorkspace}
                    onGrantWorkspaceRole={setWorkspaceRole}
                    onUpdateWorkspaceRole={setWorkspaceRole}
                    onRevokeWorkspaceRole={revokeWorkspaceRole}
                    onCreateInvitation={createInvitation}
                    onRevokeInvitation={revokeInvitation}
                    showToast={showToast}
                  />
                }
              />
            </Routes>
            </div>
          </main>
        </div>
      </div>
      {visibleShellToast !== null ? (
        <output className="workflow-toast" aria-live="polite">
          {visibleShellToast}
        </output>
      ) : null}
    </div>
  );
}

export function App(props: AppProps = {}) {
  return useAppModel(props);
}

function upsertInvitation(invitations: ZaraInvitation[], invitation: ZaraInvitation) {
  const existingIndex = invitations.findIndex((candidate) => candidate.id === invitation.id);

  if (existingIndex === -1) {
    return [invitation, ...invitations];
  }

  return invitations.map((candidate) => candidate.id === invitation.id ? invitation : candidate);
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
