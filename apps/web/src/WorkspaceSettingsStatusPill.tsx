export function WorkspaceSettingsStatusPill({
  children,
  tone,
}: {
  children: string;
  tone: "neutral" | "blue" | "red";
}) {
  return <span className={`status-pill status-pill-${tone}`}>{children}</span>;
}
