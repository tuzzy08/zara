import type { MarketingIconName } from "./marketingIconTypes";

export function MarketingIconPaths({ name }: { name: MarketingIconName }) {
  switch (name) {
    case "receptionist":
      return (
        <>
          <path d="M14 28v-6a10 10 0 0 1 20 0v6" />
          <path d="M14 28h5v8h-5a4 4 0 0 1-4-4v0a4 4 0 0 1 4-4Z" />
          <path d="M34 28h-5v8h5a4 4 0 0 0 4-4v0a4 4 0 0 0-4-4Z" />
          <path d="M28 36h-5" />
        </>
      );
    case "qualification":
      return (
        <>
          <path d="M17 33c2-7 6-11 14-12" />
          <path d="M16 18a7 7 0 1 0 9 9" />
          <path d="M31 12h7v7" />
          <path d="M28 22 38 12" />
        </>
      );
    case "calendar":
      return (
        <>
          <rect x="11" y="13" width="26" height="25" rx="4" />
          <path d="M17 10v7M31 10v7M11 21h26" />
          <path d="M18 28h4M26 28h4M18 34h4" />
        </>
      );
    case "headset":
      return (
        <>
          <path d="M12 28v-5a12 12 0 0 1 24 0v5" />
          <path d="M12 28h6v9h-3a3 3 0 0 1-3-3Z" />
          <path d="M36 28h-6v9h3a3 3 0 0 0 3-3Z" />
          <path d="M29 37h-7" />
        </>
      );
    case "afterHours":
      return (
        <>
          <path d="M25 11a13 13 0 1 0 12 18 10 10 0 0 1-12-18Z" />
          <path d="M35 10v5M37.5 12.5h-5" />
        </>
      );
    case "dental":
      return (
        <>
          <path d="M17 14c-4 0-7 3-7 8 0 8 5 17 9 17 3 0 2-8 5-8s2 8 5 8c4 0 9-9 9-17 0-5-3-8-7-8-3 0-4 2-7 2s-4-2-7-2Z" />
          <path d="M18 20c2 1 4 1 6 0" />
        </>
      );
    case "property":
      return (
        <>
          <path d="M11 38h26V18L24 10 11 18Z" />
          <path d="M19 38V26h10v12" />
          <path d="M16 22h4M28 22h4" />
        </>
      );
    case "homeServices":
      return (
        <>
          <path d="M16 14 34 32" />
          <path d="m30 14 4 4-16 16-5 1 1-5Z" />
          <path d="M15 15a5 5 0 0 0-5 6l5-5 4 4-5 5a5 5 0 0 0 6-5" />
        </>
      );
    case "coaching":
      return (
        <>
          <circle cx="24" cy="17" r="6" />
          <path d="M13 38c2-8 7-12 11-12s9 4 11 12" />
          <path d="M16 31h16" />
        </>
      );
    case "support":
      return (
        <>
          <rect x="11" y="13" width="26" height="22" rx="5" />
          <path d="M18 35v6l7-6" />
          <path d="M18 22h12M18 28h8" />
        </>
      );
    case "audit":
      return (
        <>
          <path d="M14 15c4-4 11-4 16 0" />
          <path d="M10 24c6-6 22-6 28 0" />
          <path d="M15 33c4-3 14-3 18 0" />
          <path d="M25 9 34 4" />
        </>
      );
    case "design":
      return (
        <>
          <path d="M13 28h9v9h-9Z" />
          <path d="M26 11h9v9h-9Z" />
          <path d="M22 32h8a6 6 0 0 0 6-6v-6" />
          <path d="M26 15h-8a6 6 0 0 0-6 6v7" />
        </>
      );
    case "test":
      return (
        <>
          <path d="M12 27c6-8 18-8 24 0" />
          <path d="M18 32c3-4 9-4 12 0" />
          <path d="M24 37h.1" />
          <path d="M14 14h20" />
        </>
      );
    case "growth":
      return (
        <>
          <path d="M11 36h26" />
          <path d="M15 31v-8M24 31V16M33 31V11" />
          <path d="m13 19 7-6 6 4 9-9" />
        </>
      );
  }
}
