import { BadgeCheck, XCircle } from "lucide-react";

export function TenantStatusBanner({ tone, children }: { tone: "neutral" | "danger"; children: string }) {
  return (
    <div className={`tenant-status-banner tenant-status-banner-${tone}`} role={tone === "danger" ? "alert" : "status"}>
      {tone === "danger" ? <XCircle size={15} /> : <BadgeCheck size={15} />}
      <span>{children}</span>
    </div>
  );
}
