import { Card } from "@zara/ui";

export function MarketingGlassCrmCard() {
  return (
    <Card className="glass-panel hero-glass-card hero-crm-card" role="article">
      <strong>CRM update</strong>
      <div className="crm-record">New lead created</div>
      <dl>
        <div><dt>Intent</dt><dd>House cleaning</dd></div>
        <div><dt>Service</dt><dd>Deep clean</dd></div>
        <div><dt>Value</dt><dd>$240</dd></div>
        <div><dt>Source</dt><dd>Phone call</dd></div>
      </dl>
    </Card>
  );
}
