import { Card } from "@zara/ui";

export function MarketingGlassHandoffCard() {
  return (
    <Card className="glass-panel hero-glass-card hero-handoff-card" role="article">
      <strong>Handoff</strong>
      <div className="handoff-person">
        <span>AJ</span>
        <div>
          <b>Alex Johnson</b>
          <small>Sr. Support Specialist</small>
        </div>
      </div>
      <p>Priority - Medium</p>
      <div className="handoff-check">Full context attached <span>Attached</span></div>
    </Card>
  );
}
