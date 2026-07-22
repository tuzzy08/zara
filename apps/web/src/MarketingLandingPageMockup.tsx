import { useEffect, useState, type CSSProperties } from "react";
import { NavLink } from "react-router-dom";

import "./marketing-landing.css";

const glyphDrawings = {
  route: <><circle cx="10" cy="24" r="4" /><circle cx="38" cy="10" r="4" /><circle cx="38" cy="38" r="4" /><path d="M14 24h8c8 0 7-14 12-14M22 24c8 0 7 14 12 14" /></>,
  agents: <><circle cx="15" cy="16" r="6" /><circle cx="34" cy="17" r="5" /><path d="M5 39c1-9 5-14 11-14s11 5 12 14M27 28c8-3 14 2 16 11" /></>,
  handoff: <><path d="M7 15h23l-5-5m5 5-5 5M41 33H18l5-5m-5 5 5 5" /><circle cx="8" cy="33" r="3" /><circle cx="40" cy="15" r="3" /></>,
  memory: <><path d="M12 7h21l4 4v30H12zM17 16h15M17 23h15M17 30h10" /><path d="M8 12v33h25" /></>,
  phone: <><path d="M13 7l7 9-5 5c4 7 7 10 14 14l5-5 9 7-4 6c-2 3-7 2-12-1C15 35 8 27 5 17 3 12 4 9 7 7z" /></>,
  waveform: <><path d="M4 24h6l3-12 5 25 5-31 5 36 5-25 4 7h7" /></>,
  policy: <><path d="M24 5l16 7v11c0 10-6 17-16 21C14 40 8 33 8 23V12z" /><path d="M16 24l5 5 11-12" /></>,
  tool: <><path d="M29 7a10 10 0 0 0-9 14L7 34l7 7 13-13a10 10 0 0 0 14-9l-7 5-6-6z" /></>,
  observe: <><path d="M4 24s7-12 20-12 20 12 20 12-7 12-20 12S4 24 4 24z" /><circle cx="24" cy="24" r="6" /><path d="M24 20v4l3 2" /></>,
  network: <><circle cx="24" cy="8" r="4" /><circle cx="9" cy="38" r="4" /><circle cx="39" cy="38" r="4" /><circle cx="24" cy="27" r="4" /><path d="M24 12v11M21 29L12 36M27 29l9 7" /></>,
  calendar: <><rect x="7" y="10" width="34" height="31" /><path d="M7 19h34M16 5v10M32 5v10M14 27h7v7h-7z" /></>,
  commerce: <><path d="M10 16h28l-2 27H12zM17 17c0-8 3-12 7-12s7 4 7 12" /><path d="M18 28h12" /></>,
  cloud: <><path d="M14 37h22c11 0 11-16 2-18C36 8 21 7 17 17 6 15 3 34 14 37z" /><path d="M24 20v12m-5-5 5 5 5-5" /></>,
  signal: <><circle cx="24" cy="24" r="4" /><path d="M15 15a13 13 0 0 0 0 18M33 15a13 13 0 0 1 0 18M9 9a21 21 0 0 0 0 30M39 9a21 21 0 0 1 0 30" /></>,
  code: <><path d="M18 13L7 24l11 11M30 13l11 11-11 11M27 7l-6 34" /></>,
  check: <><circle cx="24" cy="24" r="19" /><path d="M14 24l7 7 14-16" /></>,
} as const;

type GlyphName = keyof typeof glyphDrawings;

function SignalGlyph({ name, className }: { name: GlyphName; className?: string }) {
  return (
    <svg className={["signal-glyph", className].filter(Boolean).join(" ")} viewBox="0 0 48 48" aria-hidden="true">
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

const workflowNodes: Array<[string, string, GlyphName, string, string]> = [
  ["Incoming call", "VOICE / PSTN", "phone", "5%", "42%"],
  ["Router agent", "INTENT / 0.94", "route", "21%", "42%"],
  ["Policy gate", "RULES / SAFE", "policy", "38%", "19%"],
  ["Reception", "AGENT / ACTIVE", "agents", "55%", "8%"],
  ["Scheduler", "TOOL / READY", "calendar", "55%", "34%"],
  ["Transcript memory", "CONTEXT / SCOPED", "memory", "38%", "66%"],
  ["Knowledge", "RETRIEVAL / 6 DOCS", "observe", "55%", "62%"],
  ["Human handoff", "QUEUE / PRIORITY", "handoff", "72%", "18%"],
  ["CRM update", "TOOL / WRITTEN", "tool", "72%", "48%"],
  ["Resolved", "OUTCOME / LOGGED", "check", "88%", "34%"],
  ["Replay trace", "EVENTS / 28", "signal", "72%", "75%"],
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

const questions = [
  ["Product", "How does Zara handle call routing?", "A published workflow resolves the active agent, route policy, available tools, and safe fallback for every turn."],
  ["Security", "How is caller and tenant data protected?", "Tenant-scoped access, encrypted secrets, auditable actions, and explicit retention controls are part of the platform model."],
  ["Telephony", "Can we keep our phone provider?", "Yes. Zara supports platform telephony alongside bring-your-own SIP and Twilio connections."],
  ["Billing", "How do we control runtime cost?", "Runtime policies, per-turn telemetry, budgets, and cost-per-resolution reporting keep spend visible."],
] as const;

function HeroControlSurface() {
  return (
    <div className="signal-control-surface" aria-label="Live voice routing control surface">
      <div className="signal-control-header"><span>ZR / VOICE MATRIX</span><i>LIVE</i></div>
      <div className="signal-control-body">
        <div className="signal-control-routing">
          <span className="signal-control-label">ROUTE BUS / 04</span>
          <div className="signal-route-map" aria-hidden="true">
            <svg viewBox="0 0 420 220"><path d="M24 110h88c37 0 38-64 76-64h56c42 0 40 45 79 45h72M112 110h76c40 0 34 64 76 64h131M244 46v128" /></svg>
            {["CALL", "ROUTE", "AGENT", "TOOL", "HUMAN"].map((label, index) => <span key={label} className={`signal-route-port signal-route-port-${index}`}>{label}</span>)}
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
        <nav className="signal-nav" aria-label="Primary"><a href="#capabilities">Capabilities</a><a href="#product">Product</a><a href="#proof">Use cases</a></nav>
        <div className="signal-header-actions"><NavLink to="/login">Sign in</NavLink><NavLink className="signal-header-cta" to="/signup">Build a workflow</NavLink></div>
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
        <div className="signal-section-intro"><p className="signal-kicker">MEASUREMENT MODEL</p><h2 id="outcomes-title">Know what improved</h2><p>Compare the signals that explain how every call performs.</p></div>
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
            <svg viewBox="0 0 1000 520" aria-hidden="true"><path d="M80 245H210M330 245C385 245 360 115 430 115H535M330 245H430v130h105M650 115h80c55 0 35 100 95 100h80M650 245h175M650 375h70c60 0 45-70 105-70h80M535 375v90h190" /></svg>
            {workflowNodes.map(([title, meta, glyph, x, y], index) => <article className={`signal-node signal-node-${index}`} key={title} style={{ "--node-x": x, "--node-y": y } as CSSProperties}><SignalGlyph name={glyph} /><div><strong>{title}</strong><small>{meta}</small></div><i /></article>)}
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

      <footer className="signal-footer signal-grid"><div className="signal-footer-mark"><SignalMark /><p>Voice operations,<br />designed end to end.</p></div><nav aria-label="Footer product"><strong>PRODUCT</strong><a href="#product">Workflows</a><a href="#telemetry">Monitoring</a><a href="#integrations">Integrations</a><NavLink to="/login">Sign in</NavLink></nav><nav aria-label="Footer company"><strong>EXPLORE</strong><a href="#proof">Use cases</a><a href="#principles">Principles</a><a href="#faq">FAQ</a><NavLink to="/signup">Contact</NavLink></nav><nav aria-label="Footer access"><strong>ACCESS</strong><NavLink to="/login">Sign in</NavLink><NavLink to="/signup">Create workspace</NavLink><a href="#start">Get started</a></nav><div className="signal-footer-word" aria-hidden="true">zara</div><small>©2026 Zara Technologies. Voice operations, designed end to end.</small></footer>
    </main>
  );
}
