import type { ReactNode } from "react";

import {
  Activity,
  Bot,
  Cable,
  CircleDollarSign,
  Clock3,
  Command,
  LayoutGrid,
  MemoryStick,
  PhoneCall,
  Search,
  Settings,
  Shapes,
  Sparkles,
  Zap,
} from "lucide-react";
import { NavLink, Route, Routes } from "react-router-dom";

const primaryNavigation = [
  { label: "Agents", path: "/", icon: Bot },
  { label: "Workflows", path: "/workflows", icon: Shapes },
  { label: "Sandbox", path: "/sandbox", icon: Sparkles },
  { label: "Calls", path: "/calls", icon: PhoneCall },
] as const;

const secondaryNavigation = [
  { label: "Integrations", path: "/integrations", icon: Cable },
  { label: "Memory", path: "/memory", icon: MemoryStick },
  { label: "Billing", path: "/billing", icon: CircleDollarSign },
  { label: "Settings", path: "/settings", icon: Settings },
] as const;

const workflowRows = [
  {
    name: "Inbound support triage",
    language: "English + French",
    runtime: "Balanced",
    updatedAt: "6m ago",
    status: "Ready",
  },
  {
    name: "Property inquiry router",
    language: "English",
    runtime: "Cost optimized",
    updatedAt: "18m ago",
    status: "Sandbox",
  },
  {
    name: "Returns and billing resolution",
    language: "English + Spanish",
    runtime: "Premium realtime",
    updatedAt: "42m ago",
    status: "Needs review",
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
  return (
    <div className="min-h-screen bg-[var(--zara-bg)] text-[var(--zara-text)]">
      <div className="shell-frame mx-auto flex min-h-screen w-full max-w-[1600px]">
        <aside className="shell-sidebar border-r border-black/5 bg-white px-5 py-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-black/45">
                Zara
              </div>
              <div className="mt-1 text-[22px] font-semibold tracking-[-0.06em]">
                Tuzzy Labs
              </div>
            </div>
            <button className="icon-button" aria-label="Open command menu">
              <Command size={15} />
            </button>
          </div>

          <div className="mt-7 rounded-[8px] border border-black/5 bg-[var(--zara-surface)] px-3 py-3 shadow-[0_0_0_1px_rgba(0,0,0,0.04),0_8px_24px_-18px_rgba(0,0,0,0.18)]">
            <div className="flex items-center justify-between text-[12px] text-black/48">
              <span>Environment</span>
              <span className="rounded-full bg-[rgba(10,114,239,0.08)] px-2 py-1 font-medium text-[var(--zara-blue)]">
                Production
              </span>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-[8px] bg-[#171717] text-white">
                Z
              </div>
              <div>
                <div className="text-[14px] font-medium">West Africa operations</div>
                <div className="text-[12px] text-black/50">3 live queues • 11 agents</div>
              </div>
            </div>
          </div>

          <nav aria-label="Tenant" className="mt-8 space-y-7">
            <NavSection title="Build" items={primaryNavigation} />
            <NavSection title="Operate" items={secondaryNavigation} />
          </nav>

          <div className="mt-auto rounded-[8px] border border-black/5 bg-white px-4 py-4 shadow-[0_0_0_1px_rgba(0,0,0,0.04)]">
            <div className="flex items-center justify-between text-[12px] text-black/50">
              <span>Realtime spend</span>
              <span>$184.20</span>
            </div>
            <div className="mt-3 h-2 rounded-full bg-black/[0.06]">
              <div className="h-2 w-[62%] rounded-full bg-[#171717]" />
            </div>
            <div className="mt-3 text-[13px] leading-5 text-black/58">
              Premium voice usage is healthy. Budget headroom remains for billing escalation and sandbox replay.
            </div>
          </div>
        </aside>

        <div className="shell-main flex min-w-0 flex-1 flex-col">
          <header className="border-b border-black/5 bg-white/92 px-4 py-4 backdrop-blur md:px-6">
            <div className="shell-header-row flex flex-col gap-4">
              <div className="flex min-w-0 items-center gap-3">
                <button className="shell-mobile-nav inline-flex h-10 items-center gap-2 rounded-[8px] border border-black/5 bg-white px-3 text-[13px] font-medium shadow-[0_0_0_1px_rgba(0,0,0,0.04)]">
                  <LayoutGrid size={15} />
                  Navigation
                </button>
                <div className="flex min-w-0 items-center gap-3 rounded-[8px] border border-black/5 bg-[var(--zara-surface)] px-3 py-2 shadow-[0_0_0_1px_rgba(0,0,0,0.04)]">
                  <Search size={15} className="text-black/45" />
                  <span className="truncate text-[13px] text-black/52">
                    Search workflows, calls, or organizations
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Pill tone="neutral">Sandbox healthy</Pill>
                <Pill tone="blue">Calls 14 live</Pill>
                <Pill tone="pink">Memory sync 2 queued</Pill>
                <Pill tone="red">1 escalation pending</Pill>
              </div>
            </div>
          </header>

          <main className="flex-1 px-4 py-5 md:px-6 md:py-6">
            <Routes>
              <Route path="/" element={<DashboardScreen />} />
              <Route path="/workflows" element={<DashboardScreen />} />
              <Route path="/sandbox" element={<DashboardScreen />} />
              <Route path="/calls" element={<DashboardScreen />} />
              <Route path="/integrations" element={<DashboardScreen />} />
              <Route path="/memory" element={<DashboardScreen />} />
              <Route path="/billing" element={<DashboardScreen />} />
              <Route path="/settings" element={<DashboardScreen />} />
            </Routes>
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
                <div className="text-[13px] font-medium text-black/48">Operations</div>
                <h1 className="mt-1 text-[34px] font-semibold leading-[1.02] tracking-[-0.07em]">
                  Tenant control surface
                </h1>
                <p className="mt-3 max-w-[58ch] text-[15px] leading-6 text-black/58">
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
              <div className="text-[13px] font-medium text-black/48">Live queue</div>
              <div className="mt-1 text-[24px] font-semibold tracking-[-0.05em]">Current calls</div>
            </div>
            <div className="rounded-full bg-[rgba(10,114,239,0.08)] px-2.5 py-1 text-[12px] font-medium text-[var(--zara-blue)]">
              14 active
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {liveCalls.map((call) => (
              <div key={call.caller} className="rounded-[8px] border border-black/5 bg-[var(--zara-surface)] px-3 py-3 shadow-[0_0_0_1px_rgba(0,0,0,0.03)]">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[14px] font-medium">{call.caller}</div>
                    <div className="mt-1 text-[12px] text-black/48">
                      {call.queue} • {call.agent}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[12px] font-medium text-black/66">{call.elapsed}</div>
                    <div className="mt-1 text-[12px] text-black/48">{call.sentiment}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="shell-secondary-grid grid gap-4">
        <div className="surface-card overflow-hidden">
          <div className="flex items-center justify-between border-b border-black/5 px-5 py-4">
            <div>
              <div className="text-[13px] font-medium text-black/48">Build pipeline</div>
              <div className="mt-1 text-[22px] font-semibold tracking-[-0.05em]">Recent workflows</div>
            </div>
            <button className="text-[13px] font-medium text-black/62 transition hover:text-black">
              Open builder
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-left">
              <thead>
                <tr className="text-[12px] uppercase tracking-[0.12em] text-black/42">
                  <th className="px-5 py-3 font-medium">Workflow</th>
                  <th className="px-5 py-3 font-medium">Language</th>
                  <th className="px-5 py-3 font-medium">Runtime</th>
                  <th className="px-5 py-3 font-medium">Updated</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {workflowRows.map((workflow) => (
                  <tr key={workflow.name} className="border-t border-black/5 text-[14px]">
                    <td className="px-5 py-4 font-medium">{workflow.name}</td>
                    <td className="px-5 py-4 text-black/56">{workflow.language}</td>
                    <td className="px-5 py-4 text-black/56">{workflow.runtime}</td>
                    <td className="px-5 py-4 text-black/56">{workflow.updatedAt}</td>
                    <td className="px-5 py-4">
                      <span className="inline-flex rounded-full bg-black/[0.05] px-2.5 py-1 text-[12px] font-medium text-black/68">
                        {workflow.status}
                      </span>
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
              <div className="text-[13px] font-medium text-black/48">Specialists</div>
              <div className="mt-1 text-[22px] font-semibold tracking-[-0.05em]">Agent roster</div>
            </div>
            <button className="icon-button" aria-label="Manage agents">
              <Bot size={15} />
            </button>
          </div>

          <div className="mt-4 space-y-3">
            {agentRoster.map((agent) => (
              <div key={agent.name} className="rounded-[8px] border border-black/5 bg-[var(--zara-surface)] px-3 py-3 shadow-[0_0_0_1px_rgba(0,0,0,0.03)]">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[14px] font-medium">{agent.name}</div>
                    <div className="mt-1 text-[12px] text-black/48">
                      {agent.role} • {agent.volume}
                    </div>
                  </div>
                  <div className="text-[12px] text-black/52">{agent.health}</div>
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
      <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.16em] text-black/38">
        {title}
      </div>
      <div className="space-y-1">
        {items.map((item) => {
          const Icon = item.icon;

          return (
            <NavLink
              key={item.label}
              to={item.path}
              end={item.path === "/"}
              className={({ isActive }) =>
                [
                  "flex items-center gap-3 rounded-[8px] px-3 py-2.5 text-[14px] font-medium transition",
                  isActive
                    ? "bg-[#171717] text-white shadow-[0_0_0_1px_rgba(0,0,0,0.06),0_16px_32px_-26px_rgba(0,0,0,0.55)]"
                    : "text-black/62 hover:bg-black/[0.035] hover:text-black",
                ].join(" ")
              }
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
    <div className="rounded-[8px] border border-black/5 bg-[var(--zara-surface)] px-3 py-3 shadow-[0_0_0_1px_rgba(0,0,0,0.03)]">
      <div className="text-[12px] font-medium text-black/48">{label}</div>
      <div className="mt-2 text-[22px] font-semibold tracking-[-0.06em]">{value}</div>
      <div className="mt-1 text-[12px] text-black/46">{detail}</div>
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
    <div className="rounded-[8px] border border-black/5 bg-white px-4 py-4 shadow-[0_0_0_1px_rgba(0,0,0,0.04)]">
      <div className="flex items-center gap-2 text-[13px] font-medium">
        <Icon size={15} className="text-black/58" />
        <span>{title}</span>
      </div>
      <div className="mt-2 text-[13px] leading-5 text-black/56">{body}</div>
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
  const className = {
    neutral: "bg-black/[0.05] text-black/65",
    blue: "bg-[rgba(10,114,239,0.08)] text-[var(--zara-blue)]",
    pink: "bg-[rgba(222,29,141,0.09)] text-[var(--zara-pink)]",
    red: "bg-[rgba(255,91,79,0.1)] text-[var(--zara-red)]",
  }[tone];

  return <span className={`rounded-full px-2.5 py-1 text-[12px] font-medium ${className}`}>{children}</span>;
}
