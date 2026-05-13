import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import {
  Activity,
  Bot,
  Cable,
  ChevronDown,
  Clock3,
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
  Zap,
  AudioLines,
  GitBranch,
  Plus,
} from "lucide-react";
import { NavLink, Route, Routes } from "react-router-dom";

import { SandboxScreen } from "./SandboxScreen";
import { WorkflowBuilderScreen } from "./WorkflowBuilder";
import {
  createTenantWorkspace,
  loadActiveWorkspaceId,
  loadWorkspaces,
  saveActiveWorkspaceId,
  saveWorkspaces,
} from "./workspaceState";

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

const workflowRows = [
  {
    name: "Inbound support triage",
    language: "English + French",
    runtime: "Balanced",
    updatedAt: "6m ago",
    status: "Ready",
    icon: GitBranch
  },
  {
    name: "Property inquiry router",
    language: "English",
    runtime: "Cost optimized",
    updatedAt: "18m ago",
    status: "Sandbox",
    icon: GitBranch
  },
  {
    name: "Returns and billing resolution",
    language: "English + Spanish",
    runtime: "Premium realtime",
    updatedAt: "42m ago",
    status: "Needs review",
    icon: GitBranch
  },
] as const;

const liveCalls = [
  {
    caller: "A. Johnson",
    queue: "Support",
    agent: "Billing specialist",
    sentiment: "Stable",
    elapsed: "03:42",
  },
  {
    caller: "K. Mensah",
    queue: "Reception",
    agent: "Front desk triage",
    sentiment: "Escalating",
    elapsed: "01:18",
  },
  {
    caller: "M. Perez",
    queue: "Sales",
    agent: "Lead qualification",
    sentiment: "Warm",
    elapsed: "06:05",
  },
] as const;

const agentRoster = [
  { name: "Front desk triage", role: "Reception", volume: "412 today", health: "Nominal" },
  { name: "Billing specialist", role: "Billing", volume: "176 today", health: "Nominal" },
  { name: "Property intake", role: "Real estate", volume: "89 today", health: "Watching latency" },
] as const;

export function App() {
  const [theme, setTheme] = useState<Theme>(() => getInitialTheme());
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [createWorkspaceOpen, setCreateWorkspaceOpen] = useState(false);
  const [workspaceName, setWorkspaceName] = useState("");
  const [workspaces, setWorkspaces] = useState(() => loadWorkspaces());
  const [activeWorkspaceId, setActiveWorkspaceId] = useState(() => loadActiveWorkspaceId(loadWorkspaces()));
  const profileMenuRef = useRef<HTMLDivElement | null>(null);
  const workspaceMenuRef = useRef<HTMLDivElement | null>(null);
  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? workspaces[0]!;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem("zara-theme", theme);
  }, [theme]);

  useEffect(() => {
    saveWorkspaces(workspaces);
  }, [workspaces]);

  useEffect(() => {
    saveActiveWorkspaceId(activeWorkspaceId);
  }, [activeWorkspaceId]);

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

  const createWorkspace = () => {
    const workspace = createTenantWorkspace({
      name: workspaceName,
      workspaces,
      createdBy: "ops-lead",
    });

    const nextWorkspaces = [...workspaces, workspace];

    setWorkspaces(nextWorkspaces);
    setActiveWorkspaceId(workspace.id);
    setWorkspaceName("");
    setCreateWorkspaceOpen(false);
    setWorkspaceMenuOpen(false);
  };

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
            <div className="shell-status-pills" aria-label="System status">
              <Pill tone="neutral">Sandbox healthy</Pill>
              <Pill tone="blue">Calls 14 live</Pill>
              <Pill tone="pink">Memory sync 2 queued</Pill>
              <Pill tone="red">1 escalation pending</Pill>
            </div>

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
                  <span className="profile-trigger-name">Operations lead</span>
                  <span className="profile-trigger-role">Tuzzy Labs</span>
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
                  {workspaces.map((workspace) => (
                    <button
                      key={workspace.id}
                      className="workspace-menu-item"
                      role="menuitem"
                      type="button"
                      onClick={() => {
                        setActiveWorkspaceId(workspace.id);
                        setWorkspaceMenuOpen(false);
                      }}
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

          <div className="spend-card">
            <div className="spend-card-row">
              <span>Realtime spend</span>
              <span>$184.20</span>
            </div>
            <div className="spend-card-bar">
              <div className="spend-card-bar-fill" />
            </div>
            <div className="spend-card-copy">
              Premium voice usage is healthy. Budget headroom remains for billing escalation and sandbox replay.
            </div>
          </div>
        </aside>

        <div className="shell-main">
          <main className="shell-scroll-region px-4 py-5 md:px-6 md:py-6" data-testid="shell-scroll-region">
            <div className="shell-scroll-content">
            <Routes>
              <Route path="/" element={<DashboardScreen />} />
              <Route
                path="/workflows"
                element={
                  <WorkflowBuilderScreen
                    activeWorkspaceId={activeWorkspaceId}
                    onWorkspaceChange={setActiveWorkspaceId}
                    workspaces={workspaces}
                  />
                }
              />
              <Route path="/sandbox" element={<SandboxScreen activeWorkspaceId={activeWorkspaceId} workspaces={workspaces} />} />
              <Route path="/calls" element={<DashboardScreen />} />
              <Route path="/integrations" element={<DashboardScreen />} />
              <Route path="/memory" element={<DashboardScreen />} />
              <Route path="/billing" element={<DashboardScreen />} />
              <Route path="/settings" element={<DashboardScreen />} />
            </Routes>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

function DashboardScreen() {
  return (
    <div className="space-y-5">
      <section className="shell-hero-grid grid gap-4">
        <div className="surface-card p-5">
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="eyebrow-copy">Operations</div>
                <h1 className="headline-copy mt-1">Tenant control surface</h1>
                <p className="body-copy mt-3 max-w-[58ch]">
                  Live call pressure is stable across support and reception. Workflows published in the last hour are holding latency targets,
                  while one billing escalation lane needs review before the evening spike.
                </p>
              </div>
              <div className="shell-hero-metrics grid min-w-[220px] grid-cols-2 gap-3">
                <MetricCard label="Answer rate" value="94.8%" detail="vs 92.1% yesterday" />
                <MetricCard label="Median latency" value="842ms" detail="voice first byte" />
                <MetricCard label="Resolution rate" value="71%" detail="without handoff" />
                <MetricCard label="Budget burn" value="62%" detail="monthly realtime cap" />
              </div>
            </div>

            <div className="shell-status-grid grid gap-3">
              <StatusStrip
                icon={Zap}
                title="Runtime policy"
                body="Cost-optimized default with premium escalation for billing disputes and VIP queues."
              />
              <StatusStrip
                icon={Activity}
                title="Call telemetry"
                body="Opentelemetry, live monitor, and transcript capture are active in production."
              />
              <StatusStrip
                icon={Clock3}
                title="Human response"
                body="Median takeover time is 41 seconds with one pending escalation in support."
              />
            </div>
          </div>
        </div>

        <div className="surface-card p-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="eyebrow-copy">Live queue</div>
              <div className="subhead-copy mt-1">Current calls</div>
            </div>
            <div className="queue-pill">14 active</div>
          </div>

          <div className="mt-4 space-y-3">
            {liveCalls.map((call) => (
              <div key={call.caller} className="subtle-panel">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="panel-title">{call.caller}</div>
                    <div className="panel-meta">
                      {call.queue} - {call.agent}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="panel-time">{call.elapsed}</div>
                    <div className="panel-meta">{call.sentiment}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="shell-secondary-grid grid gap-4">
        <div className="surface-card overflow-hidden">
          <div className="section-header">
            <div>
              <div className="eyebrow-copy">Build pipeline</div>
              <div className="subhead-copy mt-1">Recent workflows</div>
            </div>
            <button className="section-link" type="button">
              Open builder
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-left">
              <thead>
                <tr className="table-head-row">
                  <th className=""></th>
                  <th className="px-5 py-3 font-medium">Workflow</th>
                  <th className="px-5 py-3 font-medium">Language</th>
                  <th className="px-5 py-3 font-medium">Runtime</th>
                  <th className="px-5 py-3 font-medium">Updated</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {workflowRows.map((workflow) => (
                  <tr key={workflow.name} className="table-row">
                    <td className="px-4 py-4"><workflow.icon size={16} /></td>
                    <td className="px-5 py-4 font-medium">{workflow.name}</td>
                    <td className="px-5 py-4 table-copy">{workflow.language}</td>
                    <td className="px-5 py-4 table-copy">{workflow.runtime}</td>
                    <td className="px-5 py-4 table-copy">{workflow.updatedAt}</td>
                    <td className="px-5 py-4">
                      <span className="table-status">{workflow.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="surface-card p-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="eyebrow-copy">Specialists</div>
              <div className="subhead-copy mt-1">Agent roster</div>
            </div>
            <button className="icon-button" aria-label="Manage agents" type="button">
              <Bot size={15} />
            </button>
          </div>

          <div className="mt-4 space-y-3">
            {agentRoster.map((agent) => (
              <div key={agent.name} className="subtle-panel">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="panel-title">{agent.name}</div>
                    <div className="panel-meta">
                      {agent.role} - {agent.volume}
                    </div>
                  </div>
                  <div className="panel-meta">{agent.health}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
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

function MetricCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="metric-card">
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      <div className="metric-detail">{detail}</div>
    </div>
  );
}

function StatusStrip({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof Zap;
  title: string;
  body: string;
}) {
  return (
    <div className="status-strip">
      <div className="status-strip-title">
        <Icon size={15} />
        <span>{title}</span>
      </div>
      <div className="status-strip-body">{body}</div>
    </div>
  );
}

function Pill({
  children,
  tone,
}: {
  children: ReactNode;
  tone: "neutral" | "blue" | "pink" | "red";
}) {
  return <span className={`status-pill status-pill-${tone}`}>{children}</span>;
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
