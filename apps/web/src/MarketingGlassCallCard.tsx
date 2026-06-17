import { Card } from "@zara/ui";

const heroWaveBars = Array.from({ length: 34 }, (_, index) => index);

export function MarketingGlassCallCard() {
  return (
    <Card className="glass-panel hero-glass-card hero-call-card" role="article">
      <div className="hero-card-topline">
        <strong>Inbound call</strong>
        <span>Live</span>
      </div>
      <div className="hero-phone-number">(415) 555-0198</div>
      <p>01:24 - from San Francisco, CA</p>
      <div className="hero-wave" aria-hidden="true">
        {heroWaveBars.map((index) => <span key={index} />)}
      </div>
    </Card>
  );
}
