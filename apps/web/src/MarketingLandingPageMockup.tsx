import { useEffect, useState, type CSSProperties } from "react";
import { NavLink } from "react-router-dom";

import "./marketing-landing.css";

const glyphDrawings = {
  route: <><g><path d="M7 24h13M20 24c7 0 6-12 13-12h7M20 24c7 0 6 12 13 12h7" /><circle cx="7" cy="24" r="2.5" /><circle cx="40" cy="12" r="2.5" /><circle cx="40" cy="36" r="2.5" /></g><g className="signal-glyph-detail"><path d="M17 19v10M28 9h5M28 39h5" /></g></>,
  agents: <><g><circle cx="17" cy="17" r="5.5" /><circle cx="33.5" cy="18" r="4.5" /><path d="M7.5 38c.8-8 4-12 9.5-12s8.7 4 9.5 12M28 29c7-2 11 1.5 12.5 8.5" /></g><g className="signal-glyph-detail"><path d="M9 11h4M35 10h4M21 32h3M42 33v4" /><circle cx="25.5" cy="12" r="1" /></g></>,
  handoff: <><g><path d="M7 15h27M29 10l5 5-5 5M41 33H14M19 28l-5 5 5 5" /><circle cx="7" cy="15" r="2.5" /><circle cx="41" cy="33" r="2.5" /></g><g className="signal-glyph-detail"><path d="M11 23h26M24 20v6" /></g></>,
  memory: <><g><rect x="10" y="8" width="27" height="33" rx="1.5" /><path d="M16 16h15M16 23h15M16 30h10" /></g><g className="signal-glyph-detail"><path d="M7 13v31h27M32 8v5h5" /><circle cx="32" cy="30" r="1" /></g></>,
  phone: <><g><path d="M13 8l7 9-5 5c4 7 7 10 14 14l5-5 9 7-4 5c-2 3-7 2-12-1C15 35 8 28 5 18 3.5 13 5 9 8 8z" /></g><g className="signal-glyph-detail"><path d="M29 8c5 1 9 5 10 10M30 13c2.5.7 4.3 2.5 5 5" /></g></>,
  waveform: <><g><path d="M4 24h7l3-8 5 17 5-25 5 32 5-22 4 6h6" /></g><g className="signal-glyph-detail"><path d="M8 12v5M8 31v5M40 12v5M40 31v5M19 5h10M19 43h10" /></g></>,
  policy: <><g><path d="M24 5.5l15 6.5v11c0 9.5-5.5 16.5-15 20-9.5-3.5-15-10.5-15-20V12z" /><path d="M16.5 24.5l5 5 10.5-11" /></g><g className="signal-glyph-detail"><path d="M6 16V9h7M42 16V9h-7M6 32v7h7M42 32v7h-7" /></g></>,
  tool: <><g><path d="M11 13h26M11 24h26M11 35h26" /><circle cx="18" cy="13" r="4" /><circle cx="31" cy="24" r="4" /><circle cx="21" cy="35" r="4" /></g><g className="signal-glyph-detail"><path d="M7 13h7M22 13h19M7 24h20M35 24h6M7 35h10M25 35h16" /></g></>,
  observe: <><g><path d="M4.5 24S11 13 24 13s19.5 11 19.5 11S37 35 24 35 4.5 24 4.5 24z" /><circle cx="24" cy="24" r="6.5" /><circle cx="24" cy="24" r="1.5" /></g><g className="signal-glyph-detail"><path d="M24 8v3M24 37v3M7 14l2.5 1.5M41 14l-2.5 1.5" /></g></>,
  network: <><g><path d="M24 10l12 7v14l-12 7-12-7V17zM24 24V10M24 24l12 7M24 24l-12 7" /><circle cx="24" cy="24" r="3" /><circle cx="24" cy="10" r="2.5" /><circle cx="36" cy="31" r="2.5" /><circle cx="12" cy="31" r="2.5" /></g><g className="signal-glyph-detail"><path d="M7 11h6M35 11h6M7 37h6M35 37h6" /></g></>,
  calendar: <><g><rect x="7" y="10" width="34" height="31" rx="1.5" /><path d="M7 19h34M16 6v8M32 6v8M14 25h7v7h-7M27 25h7M27 32h7" /></g><g className="signal-glyph-detail"><path d="M11 37h4M19 37h4M27 37h4M35 37h2" /></g></>,
  commerce: <><g><path d="M10 17h28l-2 26H12zM17 17c0-7.5 3-11 7-11s7 3.5 7 11M18 28h12" /></g><g className="signal-glyph-detail"><path d="M7 13h8M33 13h8M16 34h16" /><circle cx="24" cy="28" r="1.5" /></g></>,
  cloud: <><g><path d="M14 37h22c9.5 0 10.5-13.5 2-16-2-10-15-11-20-2C7 17 4 34 14 37z" /><path d="M24 21v11M19.5 27.5L24 32l4.5-4.5" /></g><g className="signal-glyph-detail"><path d="M13 42h22M8 38v-4M40 38v-4" /></g></>,
  signal: <><g><circle cx="24" cy="24" r="3" /><path d="M16 16a11.5 11.5 0 0 0 0 16M32 16a11.5 11.5 0 0 1 0 16M10.5 10.5a19 19 0 0 0 0 27M37.5 10.5a19 19 0 0 1 0 27" /></g><g className="signal-glyph-detail"><path d="M24 5v5M24 38v5M5 24h5M38 24h5" /></g></>,
  code: <><g><path d="M18 13L7 24l11 11M30 13l11 11-11 11M27 8l-6 32" /></g><g className="signal-glyph-detail"><path d="M4 9h8M36 9h8M4 39h8M36 39h8" /></g></>,
  check: <><g><path d="M24 5l16.5 9.5v19L24 43 7.5 33.5v-19z" /><path d="M14.5 24.5l6.5 6 13-14" /></g><g className="signal-glyph-detail"><path d="M5 10V5h5M43 10V5h-5M5 38v5h5M43 38v5h-5" /></g></>,
} as const;

type GlyphName = keyof typeof glyphDrawings;

function SignalGlyph({ name, className }: { name: GlyphName; className?: string }) {
  return (
    <svg className={["signal-glyph", className].filter(Boolean).join(" ")} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {glyphDrawings[name]}
    </svg>
  );
}

function SignalMark({ compact = false }: { compact?: boolean }) {
  return (
    <svg className={compact ? "signal-mark signal-mark-compact" : "signal-mark"} viewBox="0 0 64 64" aria-hidden="true">
      <path d="M9 8h46L34 31H14zM29 33h21L55 56H9z" />
    </svg>
  );
}

const capabilities: Array<[string, string, GlyphName]> = [
  ["Call routing", "Identify intent, apply policy, and move every caller to the right next step.", "route"],
  ["Agent teams", "Coordinate reception, scheduling, sales, support, and specialist roles in one flow.", "agents"],
  ["Human handoff", "Escalate with the transcript, route history, and the context a person needs.", "handoff"],
  ["Call memory", "Keep approved knowledge and caller context scoped, visible, editable, and auditable.", "memory"],
];

const workflowNodes: Array<{ title: string; meta: string; glyph: GlyphName; x: number; y: number; ports: "source" | "bidirectional" | "target" }> = [
  { title: "Incoming call", meta: "VOICE / PSTN", glyph: "phone", x: 20, y: 270, ports: "source" },
  { title: "Router agent", meta: "INTENT / 0.94", glyph: "route", x: 220, y: 270, ports: "bidirectional" },
  { title: "Policy gate", meta: "RULES / SAFE", glyph: "policy", x: 440, y: 90, ports: "bidirectional" },
  { title: "Reception", meta: "AGENT / ACTIVE", glyph: "agents", x: 680, y: 30, ports: "bidirectional" },
  { title: "Scheduler", meta: "TOOL / READY", glyph: "calendar", x: 680, y: 230, ports: "bidirectional" },
  { title: "Transcript memory", meta: "CONTEXT / SCOPED", glyph: "memory", x: 440, y: 430, ports: "bidirectional" },
  { title: "Knowledge", meta: "RETRIEVAL / 6 DOCS", glyph: "observe", x: 680, y: 390, ports: "bidirectional" },
  { title: "Human handoff", meta: "QUEUE / PRIORITY", glyph: "handoff", x: 920, y: 90, ports: "bidirectional" },
  { title: "CRM update", meta: "TOOL / WRITTEN", glyph: "tool", x: 920, y: 270, ports: "bidirectional" },
  { title: "Resolved", meta: "OUTCOME / LOGGED", glyph: "check", x: 1160, y: 230, ports: "target" },
  { title: "Replay trace", meta: "EVENTS / 28", glyph: "signal", x: 920, y: 470, ports: "bidirectional" },
];

const featureTabs: Array<[string, string, GlyphName, string]> = [
  ["Listen", "Capture high-fidelity audio and reliable turn signals across browser and phone channels.", "waveform", "AUDIO / LOCKED"],
  ["Understand", "Combine the active agent, workflow policy, tools, and approved knowledge before deciding what happens next.", "network", "CONTEXT / READY"],
  ["Act", "Use scoped business tools to schedule, look up, update, and resolve without exposing provider credentials.", "tool", "TOOL / COMPLETE"],
  ["Escalate", "Move the caller to a human with the transcript, route facts, and reason for escalation intact.", "handoff", "HANDOFF / READY"],
];

const integrations: Array<[string, GlyphName]> = [
  ["Calendars", "calendar"], ["CRM", "network"], ["Support", "handoff"], ["Commerce", "commerce"],
  ["Knowledge", "memory"], ["Messaging", "signal"], ["Telephony", "phone"], ["Cloud", "cloud"],
  ["Webhooks", "code"], ["Identity", "agents"], ["Automation", "tool"], ["Monitoring", "observe"],
];

const callPatterns: Array<[string, string, string, GlyphName]> = [
  ["Service operations", "Bookings and urgent work", "Route new bookings and urgent requests without losing context.", "route"],
  ["Multi-location", "Scheduling across locations", "Check availability and apply local routing rules in one workflow.", "calendar"],
  ["Subscription support", "Billing and retention", "Resolve routine questions and hand complex cases to the right team.", "commerce"],
];

const telemetryInstruments: Array<[string, string, GlyphName, string]> = [
  ["System load", "68.4", "observe", "load"],
  ["Route health", "99.2", "route", "health"],
  ["Cost signal", "$0.18", "commerce", "cost"],
  ["First audio", "482ms", "waveform", "latency"],
  ["Live calls", "024", "signal", "calls"],
  ["Handoff", "8.2%", "handoff", "handoff"],
];

const approachItems: Array<[string, GlyphName]> = [
  ["Route with context", "route"],
  ["See every handoff", "network"],
  ["Test before launch", "policy"],
  ["Improve with evidence", "observe"],
];

const proofItems: Array<[string, string, GlyphName]> = [
  ["Reception", "Answers, identifies the reason, and routes with a safe fallback.", "agents"],
  ["Scheduling", "Checks availability, books, reschedules, and confirms.", "calendar"],
  ["Sales", "Qualifies intent and moves high-value callers to the right closer.", "commerce"],
  ["Support", "Uses approved knowledge and tools before escalating with context.", "handoff"],
];

const subscriptionPlans = [
  { name: "Starter", price: "$49", standard: "200 min", premium: "0 min included", standardOverage: "$0.15/min", premiumOverage: "$0.40/min" },
  { name: "Growth", price: "$149", standard: "1,000 min", premium: "50 min", standardOverage: "$0.12/min", premiumOverage: "$0.35/min" },
  { name: "Scale", price: "$499", standard: "3,000 min", premium: "200 min", standardOverage: "$0.10/min", premiumOverage: "$0.30/min" },
] as const;

const questions = [
  ["Product", "How does Zara handle call routing?", "A published workflow resolves the active agent, route policy, available tools, and safe fallback for every turn."],
  ["Security", "How is caller and tenant data protected?", "Tenant-scoped access, encrypted secrets, auditable actions, and explicit retention controls are part of the platform model."],
  ["Telephony", "Can we keep our phone provider?", "Yes. Zara supports platform telephony alongside bring-your-own SIP and Twilio connections."],
  ["Billing", "How do we control runtime cost?", "Runtime policies, per-turn telemetry, budgets, and cost-per-resolution reporting keep spend visible."],
] as const;

function HeroControlSurface() {
  return (
    <div className="signal-control-surface" aria-label="Live voice routing control surface">
      <div className="signal-control-header"><span>ZR / VOICE MATRIX</span><i className="signal-live-status">LIVE</i></div>
      <div className="signal-control-body">
        <div className="signal-control-routing">
          <span className="signal-control-label">ROUTE BUS / 04</span>
          <div className="signal-route-map">
            <svg viewBox="0 0 580 260" role="img" aria-label="Live voice route map">
              <defs>
                <linearGradient id="route-call" gradientUnits="userSpaceOnUse" x1="110" x2="150"><stop stopColor="#5ddcff" /><stop offset="1" stopColor="#ffc857" /></linearGradient>
                <linearGradient id="route-agent" gradientUnits="userSpaceOnUse" x1="244" y1="130" x2="300" y2="54"><stop stopColor="#ffc857" /><stop offset="1" stopColor="#a98bff" /></linearGradient>
                <linearGradient id="route-tool" gradientUnits="userSpaceOnUse" x1="244" y1="130" x2="300" y2="206"><stop stopColor="#ffc857" /><stop offset="1" stopColor="#ff7e67" /></linearGradient>
                <linearGradient id="agent-human" gradientUnits="userSpaceOnUse" x1="404" y1="54" x2="466" y2="130"><stop stopColor="#a98bff" /><stop offset="1" stopColor="#63e6a4" /></linearGradient>
                <linearGradient id="tool-human" gradientUnits="userSpaceOnUse" x1="404" y1="206" x2="466" y2="130"><stop stopColor="#ff7e67" /><stop offset="1" stopColor="#63e6a4" /></linearGradient>
              </defs>
              <g className="signal-route-edges">
                <path d="M110 130H150" stroke="url(#route-call)" />
                <path d="M244 130C270 130 270 54 300 54" stroke="url(#route-agent)" />
                <path d="M244 130C270 130 270 206 300 206" stroke="url(#route-tool)" />
                <path d="M404 54C438 54 432 130 466 130" stroke="url(#agent-human)" />
                <path d="M404 206C438 206 432 130 466 130" stroke="url(#tool-human)" />
              </g>
              <g className="signal-route-node signal-route-node-call" transform="translate(20 108)" data-port-layout="terminal">
                <rect width="90" height="44" rx="3" /><text x="45" y="26">CALL</text><circle data-testid="route-port" cx="90" cy="22" r="5" />
              </g>
              <g className="signal-route-node signal-route-node-router" transform="translate(150 108)" data-port-layout="bidirectional">
                <rect width="94" height="44" rx="3" /><circle data-testid="route-port" cx="0" cy="22" r="5" /><text x="47" y="26">ROUTE</text><circle data-testid="route-port" cx="94" cy="22" r="5" />
              </g>
              <g className="signal-route-node signal-route-node-agent" transform="translate(300 32)" data-port-layout="bidirectional">
                <rect width="104" height="44" rx="3" /><circle data-testid="route-port" cx="0" cy="22" r="5" /><text x="52" y="26">AGENT</text><circle data-testid="route-port" cx="104" cy="22" r="5" />
              </g>
              <g className="signal-route-node signal-route-node-tool" transform="translate(300 184)" data-port-layout="bidirectional">
                <rect width="104" height="44" rx="3" /><circle data-testid="route-port" cx="0" cy="22" r="5" /><text x="52" y="26">TOOL</text><circle data-testid="route-port" cx="104" cy="22" r="5" />
              </g>
              <g className="signal-route-node signal-route-node-human" transform="translate(466 108)" data-port-layout="terminal">
                <rect width="92" height="44" rx="3" /><circle data-testid="route-port" cx="0" cy="22" r="5" /><text x="46" y="26">HUMAN</text>
              </g>
            </svg>
          </div>
          <div className="signal-vu-bank" aria-hidden="true">{Array.from({ length: 22 }, (_, index) => <i key={index} style={{ "--bar": index, "--bar-height": `${18 + (index % 8) * 9}%` } as CSSProperties} />)}</div>
        </div>
        <div className="signal-control-dials">
          {["INTENT", "LATENCY", "COST"].map((label, index) => <div className="signal-dial-unit" key={label}><span className={`signal-dial signal-dial-${index}`}><i /></span><small>{label}</small></div>)}
        </div>
        <div className="signal-toggle-bank">
          {["VAD", "MEM", "TOOLS", "SAFE"].map((label, index) => <span key={label}><i className={index === 1 ? "is-reverse" : undefined} /><small>{label}</small></span>)}
        </div>
        <div className="signal-control-readout"><strong>01:42.8</strong><span>TURN 08 / ROUTE SCHEDULING</span></div>
      </div>
    </div>
  );
}

function FeatureMachine({ active, glyph }: { active: number; glyph: GlyphName }) {
  return (
    <div className={`signal-feature-machine signal-feature-machine-${active}`} aria-hidden="true">
      <div className="signal-machine-radar"><i /><i /><i /><SignalGlyph name={glyph} /></div>
      <div className="signal-machine-bars">{Array.from({ length: 16 }, (_, index) => <i key={index} style={{ "--bar": index, "--bar-height": `${16 + (index % 7) * 11}%` } as CSSProperties} />)}</div>
      <div className="signal-machine-log"><span>00:01 / CAPTURE</span><span>00:03 / POLICY</span><span>00:05 / {active === 3 ? "TRANSFER" : "RESOLVE"}</span></div>
    </div>
  );
}

export function MarketingLandingPageMockup() {
  const [activeFeature, setActiveFeature] = useState(0);

  useEffect(() => {
    document.title = "Zara | Voice operations, designed end to end";
    const description = "Design, test, publish, and operate multi-agent voice workflows with telephony, tools, human handoff, and live operational visibility.";
    let descriptionMeta = document.querySelector<HTMLMetaElement>("meta[name='description']");
    if (descriptionMeta === null) {
      descriptionMeta = document.createElement("meta");
      descriptionMeta.name = "description";
      document.head.append(descriptionMeta);
    }
    descriptionMeta.content = description;
  }, []);

  const [featureName, featureCopy, featureGlyph, featureStatus] = featureTabs[activeFeature] ?? featureTabs[0]!;

  return (
    <main className="signal-page">
      <header className="signal-header" role="banner">
        <NavLink className="signal-brand" to="/" aria-label="Zara home"><SignalMark compact /><span>ZARA</span></NavLink>
        <nav className="signal-nav" aria-label="Primary"><a href="#capabilities">Capabilities</a><a href="#product">Product</a><a href="#proof">Use cases</a><a href="#pricing">Pricing</a></nav>
        <div className="signal-header-actions"><a className="signal-mobile-pricing" href="#pricing">Pricing</a><NavLink to="/login">Sign in</NavLink><NavLink className="signal-header-cta" to="/signup">Build a workflow</NavLink></div>
      </header>

      <section className="signal-hero signal-grid" aria-labelledby="signal-hero-title">
        <picture><source media="(max-width: 640px)" srcSet="/marketing/zara-switchboard-hero-960.webp" /><img className="signal-hero-media" src="/marketing/zara-switchboard-hero-1672.webp" alt="Analog voice-routing switchboard" /></picture>
        <div className="signal-hero-scrim" />
        <div className="signal-hero-meta"><span>VOICE OPERATIONS / 2026</span><span>BUILD · TEST · OPERATE</span></div>
        <div className="signal-hero-copy"><p className="signal-kicker">VOICE OPERATIONS PLATFORM</p><h1 id="signal-hero-title">Build the system behind every call</h1><p>Design, test, and operate voice agents that route, resolve, and hand off with control.</p><NavLink className="signal-button signal-button-light" to="/signup">Build a workflow <span>↗</span></NavLink></div>
        <HeroControlSurface />
        <div className="signal-scroll-cue"><span>SCROLL TO EXPLORE</span><i /></div>
      </section>

      <section id="manifesto" className="signal-manifesto signal-grid" aria-label="Zara voice operations promise">
        <div className="signal-manifesto-index"><SignalGlyph name="signal" /><span>01 / OPERATING MODEL</span></div>
        <div className="signal-manifesto-copy"><p><strong>Connect every call to the right agent, tool, and human.</strong> Zara turns complex phone operations into one system you can see, test, and improve.</p><small>One operational model from first hello to resolved outcome.</small></div>
      </section>

      <section id="capabilities" className="signal-capabilities signal-grid" aria-label="Core capabilities">
        {capabilities.map(([title, copy, glyph], index) => <article key={title}><div className="signal-glyph-stage"><SignalGlyph name={glyph} /><span /><span /></div><small>0{index + 1} / CAPABILITY</small><h2>{title}</h2><p>{copy}</p></article>)}
      </section>

      <section id="outcomes" className="signal-metrics signal-grid" aria-labelledby="outcomes-title">
        <div className="signal-section-intro signal-metrics-intro"><p className="signal-kicker">MEASUREMENT MODEL</p><h2 id="outcomes-title">Know what improved</h2><p>Compare the signals that explain how every call performs.</p></div>
        {[["P50 / P95", "FIRST AUDIO / BY ROUTE", "68"], ["LIVE", "RESOLUTION / HANDOFF", "91"], ["$/CALL", "COST / RESOLVED OUTCOME", "43"]].map(([value, label, level], index) => <article className="signal-metric" key={label}><span>0{index + 1}</span><strong>{value}</strong><small>{label}</small><div className="signal-metric-trace" style={{ "--level": `${level}%` } as CSSProperties}><i /></div></article>)}
      </section>

      <section id="patterns" className="signal-cases signal-grid" aria-labelledby="cases-title">
        <div className="signal-cases-heading"><p className="signal-kicker">COMMON CALL PATTERNS</p><h2 id="cases-title">Designed around the work callers need done</h2></div>
        {callPatterns.map(([industry, title, copy, glyph], index) => <article key={title}><div className="signal-case-visual"><SignalGlyph name={glyph} /><span>0{index + 1}</span></div><div><small>{industry}</small><h3>{title}</h3><p>{copy}</p></div><span className="signal-case-arrow">↗</span></article>)}
      </section>

      <section id="product" className="signal-product signal-grid" aria-labelledby="product-title">
        <div className="signal-section-intro"><p className="signal-kicker">OUR PRODUCT</p><h2 id="product-title">Build call logic at scale</h2><p>Design, test, publish, and observe sophisticated voice workflows through one visual operating surface.</p></div>
        <div className="signal-builder" aria-label="Zara workflow builder preview">
          <div className="signal-builder-topbar"><span>WORKFLOW / RECEPTION V12</span><span>TEST MODE · AUTO SAVE · 100%</span></div>
          <aside><strong>STEPS</strong>{(["agents", "route", "tool", "policy", "handoff", "memory"] as GlyphName[]).map(glyph => <span key={glyph}><SignalGlyph name={glyph} /></span>)}</aside>
          <div className="signal-builder-canvas">
            <svg className="signal-workflow-graph" viewBox="0 0 1360 620" role="img" aria-label="Connected workflow preview">
              <g className="signal-workflow-edges">
                <path d="M180 302H220" data-edge-from="incoming-call" data-edge-to="router-agent" />
                <path d="M380 302C415 302 402 122 440 122" data-edge-from="router-agent" data-edge-to="policy-gate" />
                <path d="M600 122C635 122 640 62 680 62" data-edge-from="policy-gate" data-edge-to="reception" />
                <path d="M380 302C500 302 530 262 680 262" data-edge-from="router-agent" data-edge-to="scheduler" />
                <path d="M380 302C420 302 400 462 440 462" data-edge-from="router-agent" data-edge-to="transcript-memory" />
                <path d="M600 462C635 462 640 422 680 422" data-edge-from="transcript-memory" data-edge-to="knowledge" />
                <path d="M840 62C880 62 875 122 920 122" data-edge-from="reception" data-edge-to="human-handoff" />
                <path d="M840 262C880 262 875 302 920 302" data-edge-from="scheduler" data-edge-to="crm-update" />
                <path d="M840 422C885 422 870 302 920 302" data-edge-from="knowledge" data-edge-to="crm-update" />
                <path d="M840 422C880 422 875 502 920 502" data-edge-from="knowledge" data-edge-to="replay-trace" />
                <path d="M1080 122C1125 122 1115 262 1160 262" data-edge-from="human-handoff" data-edge-to="resolved" />
                <path d="M1080 302C1120 302 1120 262 1160 262" data-edge-from="crm-update" data-edge-to="resolved" />
              </g>
              <g className="signal-workflow-nodes">
                {workflowNodes.map(({ title, meta, glyph, x, y, ports }) => <g className="signal-workflow-node" key={title} transform={`translate(${x} ${y})`} data-port-layout={ports}>
                  <rect width="160" height="64" rx="2" />
                  <g className="signal-workflow-node-icon" transform="translate(14 10) scale(.52)" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">{glyphDrawings[glyph]}</g>
                  <text className="signal-workflow-node-title" x="52" y="27">{title.toUpperCase()}</text>
                  <text className="signal-workflow-node-meta" x="52" y="43">{meta}</text>
                  {ports !== "source" && <circle data-testid="workflow-port" cx="0" cy="32" r="5" />}
                  {ports !== "target" && <circle data-testid="workflow-port" cx="160" cy="32" r="5" />}
                </g>)}
              </g>
            </svg>
            <div className="signal-builder-minimap" aria-hidden="true"><i /><i /><i /><i /><i /></div>
          </div>
          <div className="signal-builder-status"><span>11 NODES</span><span>18 CONNECTIONS</span><span>POLICY / VALID</span><span>TEST / READY</span></div>
        </div>
      </section>

      <section id="telemetry" className="signal-telemetry signal-grid" aria-labelledby="telemetry-title">
        <div className="signal-telemetry-title"><p className="signal-kicker">ILLUSTRATIVE OPERATIONS VIEW</p><h2 id="telemetry-title">Every signal, in view</h2><p>Compare routes, investigate change, and understand the whole call.</p></div>
        <div className="signal-telemetry-board">
          {telemetryInstruments.map(([label, value, glyph, kind], index) => <article className={`signal-instrument signal-instrument-${kind}`} key={label}><div><small>0{index + 1} / {label}</small><SignalGlyph name={glyph} /></div><strong>{value}</strong><div className="signal-instrument-chart" aria-hidden="true">{Array.from({ length: 12 }, (_, bar) => <i key={bar} style={{ "--bar": bar, "--bar-height": `${14 + (bar % 6) * 13}%` } as CSSProperties} />)}</div><span>{index % 2 === 0 ? "NOMINAL" : "LIVE / ROUTED"}</span></article>)}
        </div>
      </section>

      <section id="approach" className="signal-approach signal-grid" aria-labelledby="approach-title">
        <div className="signal-approach-visual"><div className="signal-radar"><i /><i /><i /><SignalGlyph name="waveform" /></div><span>CALL / 01:42.8</span></div>
        <div className="signal-approach-copy"><p className="signal-kicker">OUR APPROACH</p><h2 id="approach-title">Built for the whole call</h2><div>{approachItems.map(([title, glyph], index) => <article key={title}><span>0{index + 1}</span><SignalGlyph name={glyph} /><h3>{title}</h3></article>)}</div></div>
      </section>

      <section id="features" className="signal-features signal-grid" aria-labelledby="features-title">
        <div className="signal-features-heading"><p className="signal-kicker">PRODUCT FEATURES</p><h2 id="features-title">Engineered for real conversations</h2></div>
        <div className="signal-feature-panel"><div className="signal-tabs" aria-label="Conversation stages">{featureTabs.map(([name], index) => <button type="button" aria-label={name} aria-pressed={activeFeature === index} key={name} onClick={() => setActiveFeature(index)}><span>0{index + 1}</span>{name}</button>)}</div><div className="signal-feature-content"><FeatureMachine active={activeFeature} glyph={featureGlyph} /><div><small>0{activeFeature + 1} / {featureName.toUpperCase()}</small><p>{featureCopy}</p><span>{featureStatus}</span></div></div></div>
      </section>

      <section id="integrations" className="signal-integrations signal-grid" aria-labelledby="integrations-title">
        <div className="signal-integration-copy"><p className="signal-kicker">INTEGRATIONS</p><h2 id="integrations-title">One conversation, connected to every system that finishes the work.</h2></div>
        <div className="signal-integration-grid">{integrations.map(([name, glyph], index) => <span key={name} style={{ "--delay": index } as CSSProperties}><SignalGlyph name={glyph} /><small>{name}</small><i /></span>)}</div>
      </section>

      <section id="proof" className="signal-proof signal-grid" aria-labelledby="proof-title">
        <div className="signal-section-intro"><p className="signal-kicker">OPERATIONAL PROOF</p><h2 id="proof-title">Built for work where every call matters</h2></div>
        <div className="signal-proof-grid">{proofItems.map(([title, copy, glyph], index) => <article key={title} className={`signal-proof-card-${index}`}><div><span>0{index + 1}</span><SignalGlyph name={glyph} /></div><h3>{title}</h3><div className="signal-status-sequence"><i /><i /><i /><i /></div><small>OPERATIONAL SIGNAL</small><p>{copy}</p></article>)}</div>
      </section>

      <section id="pricing" className="signal-pricing signal-grid" aria-labelledby="pricing-title">
        <div className="signal-pricing-heading"><p className="signal-kicker">PRICING</p><h2 id="pricing-title">Pricing that follows the work</h2><p>Start with a 14-day trial that includes 30 standard sandbox minutes. The trial has no premium runtime or live platform telephony. Then choose a plan or buy prepaid credit.</p></div>
        <div className="signal-pricing-plans">
          {subscriptionPlans.map((plan, index) => <article key={plan.name} className={plan.name === "Growth" ? "is-featured" : undefined}>
            <div className="signal-pricing-plan-head"><span>0{index + 1} / SUBSCRIPTION</span>{plan.name === "Growth" && <small>MOST POPULAR</small>}</div>
            <h3>{plan.name}</h3>
            <p className="signal-pricing-price"><strong>{plan.price}</strong><span>/ month</span></p>
            <dl><div><dt>Standard runtime</dt><dd>{plan.standard}</dd></div><div><dt>Premium runtime</dt><dd>{plan.premium}</dd></div><div><dt>Standard overage</dt><dd>{plan.standardOverage}</dd></div><div><dt>Premium overage</dt><dd>{plan.premiumOverage}</dd></div></dl>
            <NavLink to="/signup">Create workspace <span>↗</span></NavLink>
          </article>)}
        </div>
        <article className="signal-pricing-payg">
          <div><span>04 / PREPAID</span><h3>Pay as you go</h3><p>For individual use without a monthly subscription.</p></div>
          <div className="signal-pricing-credit"><strong>$5 credit pack</strong><span>$0 monthly fee</span></div>
          <dl><div><dt>Standard runtime</dt><dd>$0.18/min</dd></div><div><dt>Premium runtime</dt><dd>$0.45/min</dd></div></dl>
          <NavLink to="/signup">Create workspace <span>↗</span></NavLink>
        </article>
        <p className="signal-pricing-note">Overage is off by default. Prices exclude tax. Platform-managed Nigeria outbound telephony is $0.35/min plus runtime. PAYG stops when credit reaches zero. Included runtime resets each billing period.</p>
      </section>

      <section id="principles" className="signal-notes signal-grid" aria-labelledby="notes-title">
        <div className="signal-section-intro"><p className="signal-kicker">OPERATING PRINCIPLES</p><h2 id="notes-title">Control before complexity</h2></div>
        <article className="signal-feature-note"><div className="signal-principle-orbit"><SignalGlyph name="policy" /><i /><i /><i /></div><h3>Design workflows around clear outcomes, safe boundaries, and visible decisions.</h3><small>PRINCIPLE 01 / SYSTEM DESIGN</small></article>
        <div className="signal-note-list"><article><SignalGlyph name="handoff" /><h3>Keep context intact whenever a person takes over.</h3><small>PRINCIPLE 02 / HANDOFF</small></article><article><SignalGlyph name="observe" /><h3>Measure the whole call, not a single provider event.</h3><small>PRINCIPLE 03 / OBSERVABILITY</small></article></div>
      </section>

      <section id="faq" className="signal-faq signal-grid" aria-labelledby="faq-title">
        <div className="signal-faq-heading"><p className="signal-kicker">FAQ</p><h2 id="faq-title">Common questions</h2><p>Everything you need to know before running your first call.</p><NavLink className="signal-button signal-button-dark" to="/signup">Contact Zara <span>↗</span></NavLink></div>
        <div className="signal-faq-list">{questions.map(([category, question, answer], index) => <details key={question} open={index === 0}><summary><span>{category}</span>{question}<i>+</i></summary><p>{answer}</p></details>)}</div>
      </section>

      <section id="start" className="signal-closing signal-grid" aria-labelledby="closing-title"><div><SignalGlyph name="signal" /><p className="signal-kicker">GET STARTED</p><h2 id="closing-title">Make the next call work better</h2><p>Build the workflow, test the conversation, and see every operational signal.</p><NavLink className="signal-button signal-button-light" to="/signup">Build a workflow <span>↗</span></NavLink></div></section>

      <footer className="signal-footer signal-grid"><div className="signal-footer-mark"><SignalMark /><p>Voice operations,<br />designed end to end.</p></div><nav aria-label="Footer product"><strong>PRODUCT</strong><a href="#product">Workflows</a><a href="#telemetry">Monitoring</a><a href="#integrations">Integrations</a><a href="#pricing">Pricing</a><NavLink to="/login">Sign in</NavLink></nav><nav aria-label="Footer company"><strong>EXPLORE</strong><a href="#proof">Use cases</a><a href="#principles">Principles</a><a href="#faq">FAQ</a><NavLink to="/signup">Contact</NavLink></nav><nav aria-label="Footer access"><strong>ACCESS</strong><NavLink to="/login">Sign in</NavLink><NavLink to="/signup">Create workspace</NavLink><a href="#start">Get started</a></nav><div className="signal-footer-word" aria-hidden="true">zara</div><small>©2026 Zara Technologies. Voice operations, designed end to end.</small></footer>
    </main>
  );
}
