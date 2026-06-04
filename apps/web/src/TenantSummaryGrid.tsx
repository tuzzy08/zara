export function TenantSummaryGrid({ items }: { items: Array<{ label: string; value: string; detail: string }> }) {
  return (
    <section className="tenant-summary-grid">
      {items.map((item) => (
        <div key={item.label} className="metric-card">
          <div className="metric-label">{item.label}</div>
          <div className="metric-value">{item.value}</div>
          <div className="metric-detail">{item.detail}</div>
        </div>
      ))}
    </section>
  );
}
