import { useEffect } from "react";
import { NavLink } from "react-router-dom";
import { ArrowRight } from "lucide-react";

import { MarketingGlassBookingCard } from "./MarketingGlassBookingCard";
import { MarketingGlassCallCard } from "./MarketingGlassCallCard";
import { MarketingGlassCrmCard } from "./MarketingGlassCrmCard";
import { MarketingGlassHandoffCard } from "./MarketingGlassHandoffCard";
import { MarketingGlassRoutingCard } from "./MarketingGlassRoutingCard";
import { MarketingHeroRoutingSvg } from "./MarketingHeroRoutingSvg";
import { MarketingHeroStudioBackdrop } from "./MarketingHeroStudioBackdrop";
import { MarketingLogo } from "./MarketingLogo";
import { MarketingVectorIcon } from "./MarketingVectorIcon";
import type { MarketingIconName } from "./marketingIconTypes";

const marketingServiceCards = [
  ["AI Receptionist", "24/7 call answering with natural conversations and intelligent routing.", "receptionist"],
  ["Lead Qualification", "Qualify callers, capture key details, and surface high-intent opportunities.", "qualification"],
  ["Appointment Scheduling", "Check availability, book, reschedule, and send automated confirmations.", "calendar"],
  ["Support Triage", "Resolve common issues, route complex cases, and escalate with full context.", "support"],
] as const;

const marketingTrustIndustries = [
  ["Home Services", "homeServices"],
  ["Healthcare", "headset"],
  ["Real Estate", "property"],
  ["Legal", "audit"],
  ["E-commerce", "support"],
  ["Financial Services", "growth"],
] as const;

const marketingUseCases = [
  ["Never miss a call", "Answer instantly, day or night, even during peak call volumes.", "receptionist"],
  ["Convert more leads", "Qualify, nurture, and capture intent while the caller is engaged.", "qualification"],
  ["Fill your calendar", "Book more jobs and meetings with real-time availability.", "calendar"],
  ["Handoff with context", "When humans step in, they get the full story from the start.", "headset"],
] as const;

const marketingProcessSteps = [
  ["1", "Discover", "We learn your business, call flows, and goals."],
  ["2", "Design", "We design your agent, workflows, and integrations."],
  ["3", "Build & Test", "We build, test, and refine for real-world conversations."],
  ["4", "Launch", "We launch with confidence and monitor performance."],
  ["5", "Optimize", "We continuously optimize for better results."],
] as const;

const marketingOutcomeCards = [
  ["65%+", "More calls answered", "Capture more opportunities that used to go to voicemail.", "receptionist"],
  ["30-50%", "Higher conversion", "Qualify and convert more high-intent callers.", "qualification"],
  ["2-3x", "More booked jobs", "Fill your calendar with qualified appointments.", "calendar"],
  ["40%+", "Lower cost per lead", "Automate top-of-funnel without sacrificing quality.", "growth"],
  ["4.9/5", "Caller satisfaction", "Natural conversations people actually like.", "support"],
] as const;

const marketingPricingCards = [
  ["Launch", "$2.5k", "setup", "For one phone line and a focused call flow.", ["AI receptionist", "Lead capture", "Calendar booking", "CRM handoff"], "Book launch plan"],
  ["Growth", "$4.5k", "setup", "For growing teams with qualification and routing.", ["Multi-step qualification", "Support triage", "Workflow reporting", "Weekly optimization"], "Book growth plan"],
  ["Scale", "Custom", "monthly", "For multi-location or regulated operations.", ["Custom integrations", "Advanced analytics", "SLA reviews", "Dedicated success manager"], "Talk to strategy"],
] as const;

export function MarketingLandingPageMockup() {
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
            <MarketingHeroStudioBackdrop />
            <MarketingHeroRoutingSvg />
            <MarketingGlassCallCard />
            <MarketingGlassRoutingCard />
            <MarketingGlassBookingCard />
            <MarketingGlassCrmCard />
            <MarketingGlassHandoffCard />
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
            {marketingTrustIndustries.map(([label, icon]) => (
              <span key={label}>
                <MarketingVectorIcon name={icon} label={`${label} icon`} />
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
            {marketingServiceCards.map(([title, copy, icon]) => (
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
            {marketingUseCases.map(([title, copy, icon]) => (
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
            {marketingProcessSteps.map(([step, title, copy]) => (
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
            {marketingOutcomeCards.map(([value, title, copy, icon]) => (
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
            {marketingPricingCards.map(([name, price, cadence, copy, bullets, cta], index) => (
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
