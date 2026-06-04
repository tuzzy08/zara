const heroRouteNodes = [
  [254, 122],
  [294, 122],
  [310, 108],
  [254, 154],
  [294, 154],
  [310, 156],
  [310, 188],
  [176, 254],
  [306, 252],
] as const;

export function MarketingHeroRoutingSvg() {
  return (
    <svg className="hero-routing-svg" aria-hidden="true" viewBox="0 0 570 330" preserveAspectRatio="none">
      <defs>
        <linearGradient id="hero-route-cyan" x1="250" y1="86" x2="510" y2="248" gradientUnits="userSpaceOnUse">
          <stop stopColor="#ecfffd" stopOpacity="0.2" />
          <stop offset="0.22" stopColor="#57e9df" stopOpacity="1" />
          <stop offset="0.66" stopColor="#4edbd3" stopOpacity="0.95" />
          <stop offset="1" stopColor="#ff89ad" stopOpacity="0.9" />
        </linearGradient>
        <filter id="hero-route-glow" x="-20%" y="-80%" width="140%" height="260%">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <path className="hero-route-path hero-route-path-main" d="M254 122H294C302 122 304 108 310 108" />
      <path className="hero-route-path hero-route-path-main" d="M254 154H294V236H310" />
      <path className="hero-route-path hero-route-path-soft" d="M294 128V236" />
      <path className="hero-route-path hero-route-path-soft" d="M294 156H310" />
      <path className="hero-route-path hero-route-path-soft" d="M294 188H310" />
      <path className="hero-route-path hero-route-path-soft" d="M176 254H294" />
      <path className="hero-route-path hero-route-path-soft" d="M306 252H338" />
      <path className="hero-route-path hero-route-path-pink" d="M294 236C308 242 324 246 338 248" />
      {heroRouteNodes.map(([cx, cy]) => (
        <circle className="hero-route-node" cx={cx} cy={cy} r="4.5" key={`${cx}-${cy}`} />
      ))}
      <circle className="hero-route-node hero-route-node-pink" cx="338" cy="248" r="4.5" />
    </svg>
  );
}
