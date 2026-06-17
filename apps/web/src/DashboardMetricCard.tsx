import type { LucideIcon } from "lucide-react";
import { Card } from "@zara/ui";

export function DashboardMetricCard({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <Card className="metric-card dashboard-metric-card" role="article" aria-label={`${label} metric`}>
      <div className="dashboard-metric-icon"><Icon size={16} /></div>
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      <div className="metric-detail">{detail}</div>
    </Card>
  );
}
