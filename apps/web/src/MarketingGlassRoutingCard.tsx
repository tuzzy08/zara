const glassRoutingRows = ["AI Receptionist", "Lead Qualification", "Appointment Booking", "Customer Support", "Human Handoff"] as const;
const glassRoutingRowStates = ["Active", "Next", "Queued", "On demand", "Ready"] as const;

export function MarketingGlassRoutingCard() {
  return (
    <article className="glass-panel hero-glass-card hero-routing-card">
      <div className="hero-card-topline">
        <strong>Call routing</strong>
        <span>Active</span>
      </div>
      {glassRoutingRows.map((label, index) => (
        <div className="routing-row" key={label}>
          <i />
          <span>{label}</span>
          <small>{glassRoutingRowStates[index]}</small>
        </div>
      ))}
    </article>
  );
}
