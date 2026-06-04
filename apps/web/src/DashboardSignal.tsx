export function DashboardSignal({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string | undefined;
}) {
  return (
    <div className="dashboard-signal">
      <div>
        <div className="metric-label">{label}</div>
        {detail === undefined ? null : <div className="metric-detail">{detail}</div>}
      </div>
      <strong>{value}</strong>
    </div>
  );
}
