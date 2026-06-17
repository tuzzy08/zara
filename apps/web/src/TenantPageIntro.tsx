import { type LucideIcon } from "lucide-react";
import { Card } from "@zara/ui";

export function TenantPageIntro({
  icon: Icon,
  eyebrow,
  title,
  body,
}: {
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  body: string;
}) {
  return (
    <Card className="surface-card tenant-page-intro">
      <div className="tenant-page-intro-icon"><Icon size={20} /></div>
      <div>
        <div className="eyebrow-copy">{eyebrow}</div>
        <h1 className="tenant-page-title">{title}</h1>
        <p className="body-copy tenant-page-copy">{body}</p>
      </div>
    </Card>
  );
}
