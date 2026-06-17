import { CardHeader } from "@zara/ui";

export function TenantSectionHeader({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <CardHeader className="section-header">
      <div>
        <div className="eyebrow-copy">{eyebrow}</div>
        <div className="subhead-copy mt-1">{title}</div>
      </div>
    </CardHeader>
  );
}
