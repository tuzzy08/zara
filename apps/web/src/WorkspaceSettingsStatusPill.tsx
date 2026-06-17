import { Badge } from "@zara/ui";

export function WorkspaceSettingsStatusPill({
  children,
  tone,
}: {
  children: string;
  tone: "neutral" | "blue" | "red";
}) {
  return (
    <Badge
      className={`status-pill status-pill-${tone}`}
      variant={tone === "red" ? "destructive" : tone === "blue" ? "default" : "secondary"}
    >
      {children}
    </Badge>
  );
}
