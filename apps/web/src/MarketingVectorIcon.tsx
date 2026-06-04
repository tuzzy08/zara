import { MarketingIconPaths } from "./MarketingIconPaths";
import type { MarketingIconName } from "./marketingIconTypes";

export function MarketingVectorIcon({ name, label }: { name: MarketingIconName; label: string }) {
  return (
    <svg className={`marketing-vector-icon marketing-vector-icon-${name}`} role="img" aria-label={label} viewBox="0 0 48 48">
      <MarketingIconPaths name={name} />
    </svg>
  );
}
