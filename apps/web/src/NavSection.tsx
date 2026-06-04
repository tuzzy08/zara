import { NavLink } from "react-router-dom";
import type { LucideIcon } from "lucide-react";

export function NavSection({
  title,
  items,
}: {
  title: string;
  items: ReadonlyArray<{
    label: string;
    path: string;
    icon: LucideIcon;
  }>;
}) {
  return (
    <div>
      <div className="nav-section-title">{title}</div>
      <div className="space-y-0.5">
        {items.map((item) => {
          const Icon = item.icon;

          return (
            <NavLink
              key={item.label}
              end={item.path === "/"}
              to={item.path}
              className={({ isActive }) => ["nav-link", isActive ? "nav-link-active" : ""].filter(Boolean).join(" ")}
            >
              <Icon size={16} />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </div>
    </div>
  );
}
