import { useEffect, useState, type CSSProperties } from "react";
import { NavLink } from "react-router-dom";

import "./marketing-landing.css";

const glyphDrawings = {
  route: ["000000110", "000011110", "000010000", "111110000", "000010000", "000011110", "000000110"],
  agents: ["011001100", "111101110", "011001100", "000000000", "111101110", "111111111", "100101001"],
  handoff: ["000001000", "111111100", "000001000", "000000000", "001000000", "011111111", "001000000"],
  memory: ["011111110", "010000010", "010111010", "010000010", "010111010", "010000010", "011111110"],
  phone: ["011000000", "111000000", "110000000", "011000000", "001100110", "000111111", "000011110"],
  waveform: ["000010000", "001010100", "001111100", "111111111", "001111100", "001010100", "000010000"],
  policy: ["000111000", "011111110", "010000010", "010010010", "011011110", "001111100", "000111000"],
  tool: ["001000000", "111111111", "001000000", "000000100", "111111111", "000000100", "000000000"],
  observe: ["000111000", "001000100", "010010010", "100111001", "010010010", "001000100", "000111000"],
  network: ["000111000", "000111000", "000010000", "001111100", "001000100", "011101110", "011101110"],
  calendar: ["001000100", "011111110", "010000010", "011111110", "010101010", "010000010", "011111110"],
  commerce: ["000111000", "000101000", "011111110", "010000010", "010101010", "010000010", "011111110"],
  cloud: ["000111000", "001101100", "011000110", "110000011", "100000001", "100000001", "011111110"],
  signal: ["010000010", "100101001", "101000101", "101010101", "101000101", "100101001", "010000010"],
  code: ["000010000", "001010100", "010010010", "100010001", "010010010", "001010100", "000010000"],
  check: ["000000001", "000000011", "000000110", "100001100", "110011000", "011110000", "001100000"],
  arrow: ["000100000", "000110000", "000011000", "111111100", "000011000", "000110000", "000100000"],
} as const;

type GlyphName = keyof typeof glyphDrawings;

function GlyphDrawing({ name }: { name: GlyphName }) {
  const path = glyphDrawings[name].flatMap((row, y) =>
    [...row].map((pixel, x) => pixel === "1" ? `M${6 + x * 4} ${10 + y * 4}h3v3h-3z` : ""),
  ).join("");
  return <path d={path} fill="currentColor" stroke="none" />;
}

function SignalGlyph({ name, className }: { name: GlyphName; className?: string }) {
  return (
    <svg className={["signal-glyph", className].filter(Boolean).join(" ")} viewBox="0 0 48 48" aria-hidden="true">
      <GlyphDrawing name={name} />
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
  ["Voice agents", "Build voice agents for reception, scheduling, sales, and support, with clear routes to your team.", "phone"],
  ["Non-voice agents", "Create AI agents that research, process information, and complete tasks across your business tools.", "agents"],
  ["Go-to-market", "Connect prospect research, lead qualification, CRM updates, and sales follow-up in one workflow.", "network"],
  ["Workflow automation", "Automate company workflows across teams and systems, with approvals and human handoff where needed.", "tool"],
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
  ["Voice operations", "Bookings and customer support", "Answer calls, check availability, and route urgent requests with the context your team needs.", "phone"],
  ["Go-to-market", "From prospect to next step", "Use non-voice agents to research accounts, qualify leads, and prepare follow-up for your sales team.", "network"],
  ["Company workflows", "Less manual work between teams", "Connect intake, document processing, approvals, and system updates in a clear sequence.", "tool"],
];

const telemetryInstruments: Array<[string, string, GlyphName, string]> = [
  ["System load", "68.4", "observe", "load"],
  ["Route health", "99.2", "route", "health"],
  ["Cost signal", "$0.18", "commerce", "cost"],
  ["First audio", "482ms", "waveform", "latency"],
  ["Live calls", "024", "signal", "calls"],
  ["Handoff", "8.2%", "handoff", "handoff"],
];

const proofItems: Array<[string, string, GlyphName]> = [
  ["Reception", "Answers, identifies the reason, and routes with a safe fallback.", "agents"],
  ["Scheduling", "Checks availability, books, reschedules, and confirms.", "calendar"],
  ["Sales", "Qualifies intent and moves high-value callers to the right closer.", "commerce"],
  ["Support", "Uses approved knowledge and tools before escalating with context.", "handoff"],
];

const subscriptionPlans = [
  { name: "Starter", description: "For a first voice workflow and a steady volume of calls.", price: "$49", standard: "200 min", premium: "0 min included", standardOverage: "$0.15/min", premiumOverage: "$0.40/min" },
  { name: "Growth", description: "For teams bringing more calls, agents, and tools into one system.", price: "$149", standard: "1,000 min", premium: "50 min", standardOverage: "$0.12/min", premiumOverage: "$0.35/min" },
  { name: "Scale", description: "For larger call operations that need more included runtime.", price: null, standard: "3,000 min", premium: "200 min", standardOverage: "$0.10/min", premiumOverage: "$0.30/min" },
] as const;

const questions = [
  ["Services", "Can you build agents that do not use voice?", "Yes. We build non-voice agents for research, go-to-market tasks, and internal operations. We also connect company workflows across tools, with approvals and human handoff where needed."],
  ["Product", "How does Zhara handle call routing?", "A published workflow resolves the active agent, route policy, available tools, and safe fallback for every turn."],
  ["Security", "How is caller and tenant data protected?", "Tenant-scoped access, encrypted secrets, auditable actions, and explicit retention controls are part of the platform model."],
  ["Telephony", "Can we keep our phone provider?", "Yes. Zhara supports platform telephony alongside bring-your-own SIP and Twilio connections."],
  ["Billing", "How do we control runtime cost?", "Runtime policies, per-turn telemetry, budgets, and cost-per-resolution reporting keep spend visible."],
] as const;

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
    document.title = "Zhara | AI agents and workflow automation";
    const description = "Build voice and non-voice AI agents, go-to-market systems, and company workflow automation with Zhara.";
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
        <NavLink className="signal-brand" to="/" aria-label="Zhara home"><SignalMark compact /><span>ZHARA</span></NavLink>
        <nav className="signal-nav" aria-label="Primary"><a href="#capabilities">Capabilities</a><a href="#product">Product</a><a href="#proof">Use cases</a><a href="#pricing">Pricing</a></nav>
        <div className="signal-header-actions"><a className="signal-mobile-pricing" href="#pricing">Pricing</a><NavLink to="/login">Sign in</NavLink><NavLink className="signal-header-cta" to="/signup">Build a workflow</NavLink></div>
      </header>

      <section className="signal-hero signal-grid" aria-labelledby="signal-hero-title">
        <picture><source media="(max-width: 640px)" srcSet="/marketing/zara-switchboard-hero-960.webp" /><img className="signal-hero-media" src="/marketing/zara-switchboard-hero-1672.webp" alt="Analog voice-routing switchboard" /></picture>
        <div className="signal-hero-scrim" />
        {/* <div className="signal-hero-meta"><span>VOICE OPERATIONS / 2026</span><span>BUILD · TEST · OPERATE</span></div> */}
        <div className="signal-hero-copy"><p className="signal-kicker">AI AGENTS & WORKFLOW AUTOMATION</p><h1 id="signal-hero-title">Build the system behind your work</h1><p>Build voice and non-voice agents. Connect go-to-market tasks and company workflows, from first request to completed work.</p><NavLink className="signal-button signal-button-light" to="/signup"><SignalGlyph name="arrow" />Build a workflow</NavLink></div>
        <div className="signal-hero-services">{capabilities.map(([title], index) => <a href="#capabilities" key={title}><span>0{index + 1}</span>{title}</a>)}</div>
        <div className="signal-scroll-cue"><span>SCROLL TO EXPLORE</span><i /></div>
      </section>

      <section id="manifesto" className="signal-manifesto signal-grid" aria-label="Zhara agent and workflow services">
        <div className="signal-manifesto-index"><SignalGlyph name="signal" /><span>01 / OPERATING MODEL</span></div>
        <div className="signal-manifesto-copy"><p><strong>Connect your agents, tools, and people.</strong> Zhara builds voice agents, non-voice agents, and workflow automation around the way your company works.</p><small>From customer conversations to the work behind them.</small></div>
      </section>

      <section id="capabilities" className="signal-capabilities signal-grid" aria-label="Core capabilities">
        {capabilities.map(([title, copy, glyph], index) => <article key={title}><div className="signal-glyph-stage"><SignalGlyph name={glyph} /></div><small>0{index + 1} / CAPABILITY</small><h2>{title}</h2><p>{copy}</p></article>)}
      </section>

      <section id="outcomes" className="signal-metrics signal-grid" aria-labelledby="outcomes-title">
        <div className="signal-section-intro signal-metrics-intro"><p className="signal-kicker">MEASUREMENT MODEL</p><h2 id="outcomes-title">Know what improved</h2><p>Compare the signals that explain how every call performs.</p></div>
        {[["P50 / P95", "FIRST AUDIO / BY ROUTE", "68"], ["LIVE", "RESOLUTION / HANDOFF", "91"], ["$/CALL", "COST / RESOLVED OUTCOME", "43"]].map(([value, label, level], index) => <article className="signal-metric" key={label}><span>0{index + 1}</span><strong>{value}</strong><small>{label}</small><div className="signal-metric-trace" style={{ "--level": `${level}%` } as CSSProperties}><i /></div></article>)}
      </section>

      <section id="patterns" className="signal-cases signal-grid" aria-labelledby="cases-title">
        <div className="signal-cases-heading"><p className="signal-kicker">WORKFLOWS IN PRACTICE</p><h2 id="cases-title">Designed around the work your team needs done</h2></div>
        {callPatterns.map(([industry, title, copy, glyph], index) => <article key={title}><div className="signal-case-visual"><SignalGlyph name={glyph} /><span>0{index + 1}</span></div><div><small>{industry}</small><h3>{title}</h3><p>{copy}</p></div></article>)}
      </section>

      <section id="product" className="signal-product signal-grid" aria-labelledby="product-title">
        <div className="signal-section-intro"><p className="signal-kicker">OUR PRODUCT</p><h2 id="product-title">Build call logic at scale</h2><p>Design, test, publish, and observe sophisticated voice workflows through one visual operating surface.</p></div>
        <div className="signal-builder" aria-label="Zhara workflow builder preview">
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
                  <g className="signal-workflow-node-icon" transform="translate(14 10) scale(.52)" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"><GlyphDrawing name={glyph} /></g>
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

      <section id="features" className="signal-features signal-grid" aria-labelledby="features-title">
        <div className="signal-features-heading"><p className="signal-kicker">PRODUCT FEATURES</p><h2 id="features-title">Engineered for real conversations</h2></div>
        <div className="signal-feature-panel"><div className="signal-tabs" aria-label="Conversation stages">{featureTabs.map(([name], index) => <button type="button" aria-label={name} aria-pressed={activeFeature === index} key={name} onClick={() => setActiveFeature(index)}><span>0{index + 1}</span>{name}</button>)}</div><div className="signal-feature-content"><FeatureMachine active={activeFeature} glyph={featureGlyph} /><div><small>0{activeFeature + 1} / {featureName.toUpperCase()}</small><p>{featureCopy}</p><span>{featureStatus}</span></div></div></div>
      </section>

      <section id="integrations" className="signal-integrations signal-grid" aria-labelledby="integrations-title">
        <div className="signal-integration-copy"><p className="signal-kicker">INTEGRATIONS</p><h2 id="integrations-title">Your agents, connected to the systems that finish the work.</h2></div>
        <div className="signal-integration-grid">{integrations.map(([name, glyph], index) => <span key={name} style={{ "--delay": index } as CSSProperties}><SignalGlyph name={glyph} /><small>{name}</small><i /></span>)}</div>
      </section>

      <section id="proof" className="signal-proof signal-grid" aria-labelledby="proof-title">
        <div className="signal-section-intro"><p className="signal-kicker">OPERATIONAL PROOF</p><h2 id="proof-title">Built for work where every call matters</h2></div>
        <div className="signal-proof-grid">{proofItems.map(([title, copy, glyph], index) => <article key={title} className={`signal-proof-card-${index}`}><div><span>0{index + 1}</span><SignalGlyph name={glyph} /></div><h3>{title}</h3><div className="signal-status-sequence"><i /><i /><i /><i /></div><p>{copy}</p></article>)}</div>
      </section>

      <section id="pricing" className="signal-pricing signal-grid" aria-labelledby="pricing-title">
        <div className="signal-pricing-heading"><p className="signal-kicker">PRICING</p><h2 id="pricing-title">Pricing that follows the work</h2></div>
        <p className="signal-pricing-scroll-hint" id="pricing-scroll-hint">Swipe or use the arrow keys to compare plans →</p>
        <div className="signal-pricing-comparison" role="region" aria-label="Subscription plan comparison" aria-describedby="pricing-scroll-hint" tabIndex={0}>
          <table className="signal-pricing-table" aria-label="Compare subscription plans">
            <thead><tr>
              <th scope="col" className="signal-pricing-context"><span>Monthly plans</span><p>Compare included minutes and usage rates.</p><small>All prices in USD</small></th>
              {subscriptionPlans.map(plan => <th scope="col" key={plan.name} className={plan.name === "Growth" ? "is-featured" : undefined}>
                <div className="signal-pricing-plan-name"><SignalGlyph name={plan.name === "Starter" ? "signal" : plan.name === "Growth" ? "route" : "network"} /><h3>{plan.name}</h3></div>
                <p className="signal-pricing-description">{plan.description}</p>
                {plan.price === null ? (
                  <div className="signal-pricing-sales"><a className="signal-button signal-button-dark" href="mailto:sales@zharaai.com"><SignalGlyph name="arrow" />Contact sales</a></div>
                ) : (
                  <>
                    <p className="signal-pricing-price"><strong>{plan.price}</strong><span>/ month</span></p>
                    <NavLink className={`signal-button ${plan.name === "Growth" ? "signal-button-light" : "signal-button-dark"}`} to="/signup" aria-label={`Start with ${plan.name}`}><SignalGlyph name="arrow" />Get started</NavLink>
                  </>
                )}
              </th>)}
            </tr></thead>
            <tbody>
              <tr className="signal-pricing-group"><th scope="row">Included each month</th>{subscriptionPlans.map(plan => <td key={plan.name} className={plan.name === "Growth" ? "is-featured" : undefined} />)}</tr>
              {([["Standard runtime", "standard"], ["Premium runtime", "premium"]] as const).map(([label, key]) => <tr key={key}><th scope="row">{label}</th>{subscriptionPlans.map(plan => <td key={plan.name} className={plan.name === "Growth" ? "is-featured" : undefined}>{plan[key]}</td>)}</tr>)}
              <tr className="signal-pricing-group"><th scope="row">Usage beyond your plan</th>{subscriptionPlans.map(plan => <td key={plan.name} className={plan.name === "Growth" ? "is-featured" : undefined} />)}</tr>
              {([["Standard overage", "standardOverage"], ["Premium overage", "premiumOverage"]] as const).map(([label, key]) => <tr key={key}><th scope="row">{label}</th>{subscriptionPlans.map(plan => <td key={plan.name} className={plan.name === "Growth" ? "is-featured" : undefined}>{plan[key]}</td>)}</tr>)}
            </tbody>
          </table>
        </div>
        <article className="signal-pricing-payg">
          <div><span>04 / PREPAID</span><h3>Pay as you go</h3><p>For individual use without a monthly subscription.</p></div>
          <div className="signal-pricing-credit"><strong>$5 credit pack</strong><span>$0 monthly fee</span></div>
          <dl><div><dt>Standard runtime</dt><dd>$0.18/min</dd></div><div><dt>Premium runtime</dt><dd>$0.45/min</dd></div></dl>
          <NavLink className="signal-button signal-button-dark" to="/signup" aria-label="Start with prepaid credit"><SignalGlyph name="arrow" />Get started</NavLink>
        </article>
      </section>

      <section id="principles" className="signal-notes signal-grid" aria-labelledby="notes-title">
        <div className="signal-section-intro"><p className="signal-kicker">OPERATING PRINCIPLES</p><h2 id="notes-title">Control before complexity</h2></div>
        <article className="signal-feature-note"><div className="signal-principle-orbit"><SignalGlyph name="policy" /><i /><i /><i /></div><h3>Design workflows around clear outcomes, safe boundaries, and visible decisions.</h3><small>PRINCIPLE 01 / SYSTEM DESIGN</small></article>
        <div className="signal-note-list"><article><SignalGlyph name="handoff" /><h3>Keep context intact whenever a person takes over.</h3><small>PRINCIPLE 02 / HANDOFF</small></article><article><SignalGlyph name="observe" /><h3>Measure the whole call, not a single provider event.</h3><small>PRINCIPLE 03 / OBSERVABILITY</small></article></div>
      </section>

      <section id="faq" className="signal-faq signal-grid" aria-labelledby="faq-title">
        <div className="signal-faq-heading"><p className="signal-kicker">FAQ</p><h2 id="faq-title">Common questions</h2><p>What to know before building your first agent or workflow.</p><NavLink className="signal-button signal-button-dark" to="/signup"><SignalGlyph name="arrow" />Contact Zhara</NavLink></div>
        <div className="signal-faq-list">{questions.map(([category, question, answer], index) => <details key={question} open={index === 0}><summary><span>{category}</span>{question}<i>+</i></summary><p>{answer}</p></details>)}</div>
      </section>

      <section id="start" className="signal-closing signal-grid" aria-labelledby="closing-title"><div><SignalGlyph name="signal" /><p className="signal-kicker">GET STARTED</p><h2 id="closing-title">Make your next workflow work better</h2><p>Build the agent, connect your tools, and put your workflow to work.</p><NavLink className="signal-button signal-button-light" to="/signup"><SignalGlyph name="arrow" />Build a workflow</NavLink></div></section>

      <footer className="signal-footer signal-grid"><div className="signal-footer-mark"><SignalMark /><p>Agents and workflows,<br />designed end to end.</p></div><nav aria-label="Footer product"><strong>PRODUCT</strong><a href="#product">Workflows</a><a href="#telemetry">Monitoring</a><a href="#integrations">Integrations</a><a href="#pricing">Pricing</a><NavLink to="/login">Sign in</NavLink></nav><nav aria-label="Footer company"><strong>EXPLORE</strong><a href="#proof">Use cases</a><a href="#principles">Principles</a><a href="#faq">FAQ</a><NavLink to="/signup">Contact</NavLink></nav><nav aria-label="Footer access"><strong>ACCESS</strong><NavLink to="/login">Sign in</NavLink><NavLink to="/signup">Create workspace</NavLink><a href="#start">Get started</a></nav><div className="signal-footer-word" aria-hidden="true">zhara</div><small>©2026 Zhara Technologies. Agents and workflows, designed end to end.</small></footer>
    </main>
  );
}
