import { platformAdminAuthClient, type ZaraAuthClient } from "@zara/auth-client";

export const platformAdminAppId = "platform-admin";

interface PlatformAdminAppProps {
  authClient?: ZaraAuthClient;
  route?: string | undefined;
}

interface MetricCard {
  label: string;
  value: string;
  detail: string;
}

interface PlatformAdminView {
  title: string;
  eyebrow: string;
  metrics: MetricCard[];
  rows: Array<Record<string, string>>;
}

const navigation = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/organizations", label: "Tenants" },
  { href: "/users", label: "Users" },
  { href: "/telephony", label: "Telephony" },
  { href: "/integrations", label: "Integrations" },
  { href: "/runtime", label: "Runtime" },
  { href: "/billing", label: "Billing" },
  { href: "/audit", label: "Audit" },
  { href: "/impersonation", label: "Impersonation" },
  { href: "/abuse", label: "Review" },
] as const;

const views: Record<string, PlatformAdminView> = {
  "/dashboard": {
    title: "Platform operations",
    eyebrow: "Zara Staff",
    metrics: [
      { label: "System health", value: "Operational", detail: "99% trace coverage" },
      { label: "Tenants", value: "3", detail: "2 active, 1 suspended" },
      { label: "Active calls", value: "8", detail: "2 escalated last hour" },
      { label: "Runtime status", value: "Healthy", detail: "AssemblyAI, OpenAI, Cartesia" },
      { label: "Abuse queue", value: "2", detail: "1 high severity" },
    ],
    rows: [
      { label: "Incidents", value: "0 active", state: "Clear" },
      { label: "Monthly spend", value: "$1,842.55", state: "Within policy" },
      { label: "Support queue", value: "3 requests", state: "Open" },
    ],
  },
  "/organizations": {
    title: "Tenant operations",
    eyebrow: "Organizations",
    metrics: [
      { label: "Active tenants", value: "2", detail: "1 trialing" },
      { label: "Suspended tenants", value: "1", detail: "Policy review" },
      { label: "Risk flags", value: "2", detail: "Injection and outbound velocity" },
    ],
    rows: [
      { tenant: "Tuzzy Labs", plan: "Scale", usage: "$1,260.42", state: "Active" },
      { tenant: "Healthdesk Reception", plan: "Starter", usage: "$248.10", state: "Trialing" },
    ],
  },
  "/users": {
    title: "User and membership support",
    eyebrow: "Support",
    metrics: [
      { label: "Users", value: "2", detail: "Across 2 tenants" },
      { label: "Owner memberships", value: "1", detail: "Protected" },
      { label: "Deleted users", value: "0", detail: "No recovery requests" },
    ],
    rows: [
      { user: "Ops Lead", tenant: "Tuzzy Labs", role: "Owner" },
      { user: "Finance", tenant: "Tuzzy Labs", role: "Viewer" },
    ],
  },
  "/telephony": {
    title: "Telephony operations",
    eyebrow: "Providers",
    metrics: [
      { label: "Platform-managed", value: "1", detail: "Healthy" },
      { label: "BYO SIP", value: "1", detail: "1 route failure" },
      { label: "BYO Twilio", value: "1", detail: "2 webhook failures" },
    ],
    rows: [
      { tenant: "Tuzzy Labs", mode: "platform_managed", provider: "Twilio", health: "Healthy" },
      { tenant: "Tuzzy Labs", mode: "byo_sip_trunk", provider: "Custom SIP", health: "Degraded" },
      { tenant: "Tuzzy Labs", mode: "byo_provider_account", provider: "Twilio", health: "Degraded" },
    ],
  },
  "/integrations": {
    title: "Integration operations",
    eyebrow: "Connectors",
    metrics: [
      { label: "Healthy connectors", value: "1", detail: "HubSpot" },
      { label: "Sync failures", value: "2", detail: "Zendesk" },
      { label: "Revoked", value: "1", detail: "Notion" },
    ],
    rows: [
      { tenant: "Tuzzy Labs", provider: "HubSpot", status: "Healthy", diagnostic: "Current" },
      { tenant: "Tuzzy Labs", provider: "Zendesk", status: "Refresh failed", diagnostic: "Reconnect" },
    ],
  },
  "/runtime": {
    title: "Provider health",
    eyebrow: "Runtime",
    metrics: [
      { label: "STT", value: "Healthy", detail: "AssemblyAI us-east" },
      { label: "TTS", value: "Healthy", detail: "Cartesia us-east" },
      { label: "Realtime", value: "Degraded", detail: "OpenAI us-east" },
    ],
    rows: [
      { kind: "stt", provider: "AssemblyAI", region: "us-east", state: "Healthy" },
      { kind: "tts", provider: "Cartesia", region: "us-east", state: "Healthy" },
      { kind: "realtime", provider: "OpenAI", region: "us-east", state: "Degraded" },
    ],
  },
  "/billing": {
    title: "Usage and billing controls",
    eyebrow: "Controls",
    metrics: [
      { label: "Month to date", value: "$1,842.55", detail: "All tenants" },
      { label: "Premium realtime", value: "$318.20", detail: "82 minutes" },
      { label: "Over budget", value: "1", detail: "Requires review" },
    ],
    rows: [
      { tenant: "Tuzzy Labs", plan: "Scale", budget: "$1,500", state: "Within policy" },
      { tenant: "Healthdesk Reception", plan: "Starter", budget: "$500", state: "Watch" },
    ],
  },
  "/audit": {
    title: "Platform audit log",
    eyebrow: "Audit",
    metrics: [
      { label: "Recorded actions", value: "4", detail: "Mutation trail" },
      { label: "Impersonation links", value: "1", detail: "Visible" },
      { label: "Failed actions", value: "0", detail: "None" },
    ],
    rows: [
      { actor: "user-platform-admin", action: "platform.organization.status_updated", target: "tenant-west-africa" },
      { actor: "user-platform-admin", action: "platform.billing_controls.updated", target: "tenant-west-africa" },
    ],
  },
  "/impersonation": {
    title: "Impersonation workflow",
    eyebrow: "Support access",
    metrics: [
      { label: "Active sessions", value: "1", detail: "Time-boxed" },
      { label: "Visible banners", value: "On", detail: "Required" },
      { label: "Destructive actions", value: "Blocked", detail: "Default policy" },
    ],
    rows: [
      { tenant: "Tuzzy Labs", target: "Ops Lead", expires: "15 minutes", state: "Active" },
    ],
  },
  "/abuse": {
    title: "Abuse and compliance review",
    eyebrow: "Queue",
    metrics: [
      { label: "Outbound abuse", value: "1", detail: "High severity" },
      { label: "DNC violations", value: "1", detail: "Blocked" },
      { label: "Prompt injection", value: "1", detail: "Needs review" },
      { label: "Suspension recommendations", value: "1", detail: "Policy review" },
    ],
    rows: [
      { signal: "outbound_abuse", tenant: "Tuzzy Labs", severity: "High", state: "Open" },
      { signal: "dnc_violation", tenant: "Tuzzy Labs", severity: "High", state: "Open" },
      { signal: "prompt_injection", tenant: "Tuzzy Labs", severity: "Medium", state: "Open" },
      { signal: "suspension_recommendation", tenant: "Tuzzy Labs", severity: "High", state: "Open" },
    ],
  },
};

export function PlatformAdminApp({
  authClient = platformAdminAuthClient,
  route,
}: PlatformAdminAppProps = {}) {
  const session = authClient.useSession();

  if (session.isPending) {
    return (
      <main className="admin-auth" aria-busy="true">
        <p className="eyebrow">Zara Staff</p>
        <h1>Checking Zara Admin session</h1>
      </main>
    );
  }

  if (session.data === null) {
    return (
      <main className="admin-auth">
        <section className="auth-card">
          <p className="eyebrow">Platform admin</p>
          <h1>Sign in to Zara Admin</h1>
          <p>Zara staff must sign in before inspecting tenants, providers, billing, audit, or compliance queues.</p>
        </section>
      </main>
    );
  }

  if (session.data.platformRole === undefined) {
    return (
      <main className="admin-auth">
        <section className="auth-card">
          <p className="eyebrow">Restricted</p>
          <h1>Platform access required</h1>
          <p>Tenant organization roles never grant access to the Zara staff console.</p>
        </section>
      </main>
    );
  }

  const activeRoute = resolveRoute(route);
  const fallbackView: PlatformAdminView = views["/dashboard"] as PlatformAdminView;
  const activeView = views[activeRoute] ?? fallbackView;

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar" aria-label="Zara Staff navigation">
        <a className="brand" href="/dashboard">Zara Staff</a>
        <nav>
          {navigation.map((item) => (
            <a
              aria-current={item.href === activeRoute ? "page" : undefined}
              className={item.href === activeRoute ? "active" : undefined}
              href={item.href}
              key={item.href}
            >
              {item.label}
            </a>
          ))}
        </nav>
      </aside>
      <main className="admin-main">
        <header className="admin-topbar">
          <div>
            <p className="eyebrow">{activeView.eyebrow}</p>
            <h1>{activeView.title}</h1>
          </div>
          <div className="role-badge">{session.data.platformRole}</div>
        </header>
        <section className="metric-grid" aria-label={`${activeView.title} metrics`}>
          {activeView.metrics.map((metric) => (
            <article className="metric-card" key={metric.label}>
              <p>{metric.label}</p>
              <strong>{metric.value}</strong>
              <span>{metric.detail}</span>
            </article>
          ))}
        </section>
        <section className="data-panel" aria-label={`${activeView.title} records`}>
          {activeView.rows.map((row, index) => (
            <article className="data-row" key={`${activeRoute}-${index}`}>
              {Object.entries(row).map(([key, value]) => (
                <div key={key}>
                  <span>{formatLabel(key)}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </article>
          ))}
        </section>
      </main>
    </div>
  );
}

function resolveRoute(route: string | undefined) {
  const candidate = route ?? (typeof window === "undefined" ? "/dashboard" : window.location.pathname);

  return candidate === "/" ? "/dashboard" : candidate;
}

function formatLabel(value: string) {
  return value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ");
}
