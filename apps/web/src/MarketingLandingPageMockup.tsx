import { useEffect, useState, type ComponentType, type CSSProperties } from "react";
import { NavLink } from "react-router-dom";
import {
  Activity,
  ArrowRight,
  AudioLines,
  Bot,
  BrainCircuit,
  CalendarDays,
  ChartNoAxesCombined,
  Check,
  CircleHelp,
  Cloud,
  Database,
  Headphones,
  LifeBuoy,
  MessageSquare,
  Network,
  Phone,
  Radio,
  Route,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  UserRound,
  Webhook,
  Workflow,
} from "lucide-react";

import "./marketing-landing.css";

type Icon = ComponentType<{ size?: number; strokeWidth?: number; "aria-hidden"?: boolean }>;

const capabilities: Array<[string, string, Icon]> = [
  ["Call routing", "Identify intent, apply policy, and move every caller to the right next step.", Route],
  ["Agent teams", "Coordinate reception, scheduling, sales, support, and specialist roles in one flow.", Network],
  ["Human handoff", "Escalate with the transcript, route history, and the context a person needs.", Headphones],
  ["Call memory", "Keep approved knowledge and caller context scoped, visible, editable, and auditable.", Database],
];

const caseStudies = [
  ["Service operations", "Pattern 01", "Bookings and urgent work", "Route new bookings, urgent requests, and existing-customer calls without losing context."],
  ["Multi-location", "Pattern 02", "Scheduling across locations", "Check availability, confirm appointments, and apply local routing rules in one workflow."],
  ["Subscription support", "Pattern 03", "Billing and retention", "Resolve routine questions, use approved tools, and hand complex cases to the right team."],
] as const;

const workflowNodes = [
  ["Incoming call", "Entry", Phone],
  ["Router agent", "Identify intent", Route],
  ["Reception", "Answer questions", UserRound],
  ["Scheduling", "Book and manage", CalendarDays],
  ["Billing", "Payments and invoices", Database],
  ["Human handoff", "Live specialist", Headphones],
  ["Resolved", "Outcome recorded", Check],
] as const;

const featureTabs = [
  ["Listen", "Capture high-fidelity audio and reliable turn signals across browser and phone channels.", AudioLines, "STATUS / LISTENING"],
  ["Understand", "Combine the active agent, workflow policy, tools, and approved knowledge before deciding what happens next.", BrainCircuit, "STATUS / CONTEXT READY"],
  ["Act", "Use scoped business tools to schedule, look up, update, and resolve without exposing provider credentials.", Workflow, "STATUS / TOOL COMPLETE"],
  ["Escalate", "Move the caller to a human with the transcript, route facts, and reason for escalation intact.", Headphones, "STATUS / HANDOFF READY"],
] as const;

const integrations: Array<[string, Icon]> = [
  ["Calendars", CalendarDays],
  ["CRM", ChartNoAxesCombined],
  ["Support", LifeBuoy],
  ["Commerce", ShoppingBag],
  ["Knowledge", Database],
  ["Messaging", MessageSquare],
  ["Telephony", Phone],
  ["Cloud", Cloud],
  ["Webhooks", Webhook],
  ["Identity", UserRound],
  ["Automation", Workflow],
  ["Monitoring", Activity],
];

const questions = [
  ["Product", "How does Zara handle call routing?", "A published workflow resolves the active agent, route policy, available tools, and safe fallback for every turn."],
  ["Security", "How is caller and tenant data protected?", "Tenant-scoped access, encrypted secrets, auditable actions, and explicit retention controls are part of the platform model."],
  ["Telephony", "Can we keep our phone provider?", "Yes. Zara supports platform telephony alongside bring-your-own SIP and Twilio connections."],
  ["Billing", "How do we control runtime cost?", "Runtime policies, per-turn telemetry, budgets, and cost-per-resolution reporting keep spend visible."],
] as const;

function SignalMark({ compact = false }: { compact?: boolean }) {
  return (
    <span className={compact ? "signal-mark signal-mark-compact" : "signal-mark"} aria-hidden="true">
      <i />
      <i />
    </span>
  );
}

export function MarketingLandingPageMockup() {
  const [activeFeature, setActiveFeature] = useState(0);

  useEffect(() => {
    document.title = "Zara | Voice operations, designed end to end";

    const description =
      "Design, test, publish, and operate multi-agent voice workflows with telephony, tools, human handoff, and live operational visibility.";
    let descriptionMeta = document.querySelector<HTMLMetaElement>("meta[name='description']");

    if (descriptionMeta === null) {
      descriptionMeta = document.createElement("meta");
      descriptionMeta.name = "description";
      document.head.append(descriptionMeta);
    }

    descriptionMeta.content = description;
  }, []);

  const [featureName, featureCopy, FeatureIcon, featureStatus] =
    featureTabs[activeFeature] ?? featureTabs[0];

  return (
    <main className="signal-page">
      <header className="signal-header" role="banner">
        <NavLink className="signal-brand" to="/" aria-label="Zara home">
          <SignalMark compact />
          <span>ZARA</span>
        </NavLink>
        <div className="signal-header-actions">
          <NavLink to="/login">Sign in</NavLink>
          <NavLink className="signal-header-cta" to="/signup">Build a workflow</NavLink>
          <a className="signal-jump" href="#product">Product</a>
        </div>
      </header>

      <section className="signal-hero signal-grid" aria-labelledby="signal-hero-title">
        <picture>
          <source media="(max-width: 640px)" srcSet="/marketing/zara-switchboard-hero-960.webp" />
          <img
            className="signal-hero-media"
            src="/marketing/zara-switchboard-hero-1672.webp"
            alt="Analog voice-routing switchboard"
          />
        </picture>
        <div className="signal-hero-scrim" />
        <div className="signal-service-index" aria-label="Zara capabilities">
          {[
            "Voice strategy",
            "Multi-agent workflows",
            "Telephony operations",
            "Call intelligence",
          ].map((service, index) => <span key={service}><small>0{index + 1}</small>{service}</span>)}
          <div className="signal-sector-row">
            {[Phone, ShoppingBag, Bot, ShieldCheck].map((SectorIcon, index) => (
              <span key={index}><SectorIcon size={18} strokeWidth={1.3} aria-hidden /></span>
            ))}
          </div>
        </div>
        <div className="signal-hero-copy">
          <p className="signal-kicker">VOICE OPERATIONS PLATFORM</p>
          <h1 id="signal-hero-title">Build the system behind every call</h1>
          <p>Design, test, and operate voice agents that route, resolve, and hand off with control.</p>
          <NavLink className="signal-button signal-button-light" to="/signup">
            Build a workflow <ArrowRight size={15} aria-hidden />
          </NavLink>
        </div>
        <div className="signal-next-glyphs" aria-hidden="true">
          <span><AudioLines /></span><span><Network /></span><span><Sparkles /></span><span><UserRound /></span>
        </div>
      </section>

      <section id="manifesto" className="signal-manifesto signal-grid" aria-label="Zara voice operations promise">
        <div>
          <div className="signal-orbits" aria-hidden="true"><span /><span /><span /><span /></div>
          <p>
            <strong>Connect every call to the right agent, tool, and human.</strong>{" "}
            Zara turns complex phone operations into one system you can see, test, and improve.
          </p>
          <small>One operational model from first hello to resolved outcome.</small>
        </div>
      </section>

      <section id="capabilities" className="signal-capabilities signal-grid" aria-label="Core capabilities">
        {capabilities.map(([title, copy, CapabilityIcon], index) => (
          <article key={title}>
            <div className="signal-isometric-icon"><CapabilityIcon size={62} strokeWidth={0.8} aria-hidden /></div>
            <span className="signal-index">0{index + 1}</span>
            <h2>{title}</h2>
            <p>{copy}</p>
          </article>
        ))}
      </section>

      <section id="outcomes" className="signal-metrics signal-grid" aria-labelledby="outcomes-title">
        <div className="signal-section-intro">
          <p className="signal-kicker">MEASUREMENT MODEL</p>
          <h2 id="outcomes-title">Know what improved</h2>
          <p>Compare the signals that explain how every call performs.</p>
        </div>
        <div className="signal-metric"><strong>P50<span>/P95</span></strong><small>FIRST AUDIO / BY ROUTE</small></div>
        <div className="signal-metric"><strong>LIVE</strong><small>RESOLUTION / HANDOFF</small></div>
        <div className="signal-metric"><strong>$/CALL</strong><small>COST / RESOLVED OUTCOME</small></div>
      </section>

      <section id="signal-system" className="signal-film" aria-label="Zara signal system">
        <div className="signal-film-wave" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /></div>
        <SignalMark />
        <span className="signal-film-label">SCROLL / EXPLORE</span>
        <a href="#product" aria-label="Explore the Zara workflow builder">↓</a>
      </section>

      <section id="patterns" className="signal-cases signal-grid" aria-labelledby="cases-title">
        <div className="signal-cases-heading">
          <p className="signal-kicker">COMMON CALL PATTERNS</p>
          <h2 id="cases-title">Designed around the work callers need done</h2>
        </div>
        {caseStudies.map(([industry, year, title, copy], index) => (
          <article key={title} className={index === 1 ? "signal-case-active" : undefined}>
            <div className="signal-case-art" aria-hidden="true"><AudioLines /></div>
            <span>{industry}</span>
            <span>{year}</span>
            <div><h3>{title}</h3><p>{copy}</p></div>
          </article>
        ))}
      </section>

      <section id="product" className="signal-product signal-grid" aria-labelledby="product-title">
        <div className="signal-section-intro">
          <p className="signal-kicker">OUR PRODUCT</p>
          <h2 id="product-title">Build call logic at scale</h2>
          <p>Design, test, publish, and observe sophisticated voice workflows through one visual operating surface.</p>
        </div>
        <div className="signal-builder" aria-label="Zara workflow builder preview">
          <aside>
            <strong>ADD STEP</strong>
            {[Bot, Route, Workflow, Database, Headphones].map((ToolIcon, index) => (
              <span key={index}><ToolIcon size={15} aria-hidden /></span>
            ))}
          </aside>
          <div className="signal-builder-canvas">
            <svg viewBox="0 0 900 430" aria-hidden="true">
              <path d="M120 214H255M390 214C440 214 435 80 500 80M390 214H500M390 214C440 214 435 345 500 345M650 80C715 80 700 214 780 214M650 214H780M650 345C715 345 700 214 780 214" />
            </svg>
            {workflowNodes.map(([title, copy, NodeIcon], index) => (
              <article className={`signal-node signal-node-${index}`} key={title}>
                <NodeIcon size={18} strokeWidth={1.3} aria-hidden />
                <div><strong>{title}</strong><small>{copy}</small></div>
                <i />
              </article>
            ))}
          </div>
        </div>
        <div className="signal-product-benefits">
          {["Visual builder", "Test and simulate", "Observe live", "Iterate safely"].map((item, index) => (
            <span key={item}><small>0{index + 1}</small>{item}</span>
          ))}
        </div>
      </section>

      <section id="telemetry" className="signal-telemetry signal-grid" aria-labelledby="telemetry-title">
        <div className="signal-telemetry-title"><p className="signal-kicker">ILLUSTRATIVE OPERATIONS VIEW</p><h2 id="telemetry-title">Every signal, in view</h2><p>Sample telemetry shows how operators compare routes and investigate change.</p></div>
        {[
          ["First audio", "P50 / P95", 68],
          ["Handoff", "BY ROUTE", 88],
          ["Call volume", "LIVE", 76],
        ].map(([label, value, progress]) => (
          <article className="signal-gauge" key={label} style={{ "--gauge": `${progress}%` } as CSSProperties}>
            <div className="signal-gauge-ring" aria-hidden="true" />
            <span>{label}</span><strong>{value}</strong>
            <svg viewBox="0 0 200 60" aria-hidden="true"><polyline points="0,50 24,44 48,47 72,25 96,34 120,18 144,32 168,12 200,22" /></svg>
          </article>
        ))}
        <div className="signal-trend"><span>CALLS OVER TIME / 7 DAY TREND</span><i /><i /><i /><i /><i /><i /><i /></div>
      </section>

      <section id="approach" className="signal-approach signal-grid" aria-labelledby="approach-title">
        <div className="signal-approach-media" aria-hidden="true"><AudioLines /><span /></div>
        <div className="signal-approach-copy">
          <p className="signal-kicker">OUR APPROACH</p>
          <h2 id="approach-title">Built for the whole call</h2>
          <div>
            {[
              ["Route with context", Route],
              ["See every handoff", Network],
              ["Test before launch", ShieldCheck],
            ].map(([title, ApproachIcon]) => {
              const IconComponent = ApproachIcon as Icon;
              return <article key={title as string}><IconComponent size={38} strokeWidth={0.9} aria-hidden /><h3>{title as string}</h3></article>;
            })}
            <article className="signal-empty-cell" aria-hidden="true">+</article>
          </div>
        </div>
      </section>

      <section id="features" className="signal-features signal-grid" aria-labelledby="features-title">
        <div className="signal-features-heading"><p className="signal-kicker">PRODUCT FEATURES</p><h2 id="features-title">Engineered for real conversations</h2></div>
        <div className="signal-feature-panel">
          <div className="signal-tabs" aria-label="Conversation stages">
            {featureTabs.map(([name], index) => (
              <button
                type="button"
                aria-pressed={activeFeature === index}
                key={name}
                onClick={() => setActiveFeature(index)}
              >{name}</button>
            ))}
          </div>
          <div className="signal-feature-content">
            <div className="signal-diagnostic" aria-hidden="true"><FeatureIcon size={96} strokeWidth={0.55} /><span>{featureStatus}</span></div>
            <div><small>0{activeFeature + 1} / {featureName.toUpperCase()}</small><p>{featureCopy}</p><span>{featureStatus}</span></div>
          </div>
        </div>
      </section>

      <section id="integrations" className="signal-integrations signal-grid" aria-labelledby="integrations-title">
        <div className="signal-integration-copy">
          <p className="signal-kicker">INTEGRATIONS</p>
          <h2 id="integrations-title">Zara connects the conversation to the systems where work already happens.</h2>
        </div>
        <div className="signal-integration-grid">
          {integrations.map(([name, IntegrationIcon]) => <span key={name}><IntegrationIcon size={29} strokeWidth={1} aria-hidden /><small>{name}</small></span>)}
        </div>
      </section>

      <section id="proof" className="signal-proof signal-grid" aria-labelledby="proof-title">
        <div className="signal-section-intro"><p className="signal-kicker">OPERATIONAL PROOF</p><h2 id="proof-title">Built for work where every call matters</h2></div>
        <div className="signal-proof-grid">
          {[
            ["Reception", "Answers, identifies the reason, and routes with a safe fallback."],
            ["Scheduling", "Checks availability, books, reschedules, and confirms."],
            ["Sales", "Qualifies intent and moves high-value callers to the right closer."],
            ["Support", "Uses approved knowledge and tools before escalating with context."],
          ].map(([title, copy], index) => (
            <article key={title}><span>0{index + 1}</span><h3>{title}</h3><div className="signal-status-sequence">●—●—●—○</div><small>OPERATIONAL SIGNAL</small><p>{copy}</p></article>
          ))}
        </div>
      </section>

      <section id="principles" className="signal-notes signal-grid" aria-labelledby="notes-title">
        <div className="signal-section-intro"><p className="signal-kicker">OPERATING PRINCIPLES</p><h2 id="notes-title">Control before complexity</h2></div>
        <article className="signal-feature-note"><div><Radio size={80} strokeWidth={0.5} aria-hidden /></div><h3>Design workflows around clear outcomes, safe boundaries, and visible decisions.</h3><small>PRINCIPLE 01 / SYSTEM DESIGN</small></article>
        <div className="signal-note-list">
          <article><h3>Keep context intact whenever a person takes over.</h3><small>PRINCIPLE 02 / HANDOFF</small></article>
          <article><h3>Measure the whole call, not a single provider event.</h3><small>PRINCIPLE 03 / OBSERVABILITY</small></article>
        </div>
      </section>

      <section id="faq" className="signal-faq signal-grid" aria-labelledby="faq-title">
        <div className="signal-faq-heading"><p className="signal-kicker">FAQ</p><h2 id="faq-title">Common questions</h2><p>Everything you need to know before running your first call.</p><NavLink className="signal-button signal-button-dark" to="/signup">Contact Zara <ArrowRight size={14} aria-hidden /></NavLink></div>
        <div className="signal-faq-list">
          {questions.map(([category, question, answer], index) => (
            <details key={question} open={index === 0}><summary><span>{category}</span>{question}<i><CircleHelp size={17} aria-hidden /></i></summary><p>{answer}</p></details>
          ))}
        </div>
      </section>

      <section id="start" className="signal-closing signal-grid" aria-labelledby="closing-title">
        <div><p className="signal-kicker">GET STARTED</p><h2 id="closing-title">Make the next call work better</h2><p>Build the workflow, test the conversation, and see every operational signal.</p><NavLink className="signal-button signal-button-light" to="/signup">Build a workflow <ArrowRight size={14} aria-hidden /></NavLink></div>
      </section>

      <footer className="signal-footer signal-grid">
        <div className="signal-footer-mark"><SignalMark /><p>Voice operations,<br />designed end to end.</p></div>
        <nav aria-label="Footer product"><strong>PRODUCT</strong><a href="#product">Workflows</a><a href="#telemetry-title">Monitoring</a><a href="#integrations-title">Integrations</a><NavLink to="/login">Sign in</NavLink></nav>
        <nav aria-label="Footer company"><strong>EXPLORE</strong><a href="#proof">Use cases</a><a href="#principles">Principles</a><a href="#faq">FAQ</a><NavLink to="/signup">Contact</NavLink></nav>
        <nav aria-label="Footer access"><strong>ACCESS</strong><NavLink to="/login">Sign in</NavLink><NavLink to="/signup">Create workspace</NavLink><a href="#start">Get started</a></nav>
        <div className="signal-footer-word" aria-hidden="true">zara</div>
        <small>©2026 Zara Technologies. Voice operations, designed end to end.</small>
      </footer>
    </main>
  );
}
