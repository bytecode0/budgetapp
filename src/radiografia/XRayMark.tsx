interface Props {
  className?: string;
  variant?: 'positive' | 'negative';
}

/**
 * The Radiografía mark: one continuous line inside a viewport ring — roots that
 * are ascending bars (the data) rising into a trunk and canopy (the tree).
 * `positive` renders in forest ink for paper backgrounds; `negative` renders in
 * gold for the dark "film" panels (processing, the health score).
 */
export function XRayMark({ className = 'w-8 h-8', variant = 'positive' }: Props) {
  const color = variant === 'negative' ? 'var(--xray-film-gold)' : 'var(--primary)';
  return (
    <svg viewBox="0 0 100 100" className={className} fill="none" style={{ color }}>
      <circle cx="50" cy="50" r="42" stroke="currentColor" strokeWidth="4" />
      <path
        d="M50 76V42M50 42V22M50 42L36 30M50 42L64 30"
        stroke="currentColor"
        strokeWidth="4.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="30" y="66" width="6" height="10" rx="1.5" fill="currentColor" />
      <rect x="39" y="60" width="6" height="16" rx="1.5" fill="currentColor" />
      <rect x="55" y="60" width="6" height="16" rx="1.5" fill="currentColor" />
      <rect x="64" y="66" width="6" height="10" rx="1.5" fill="currentColor" />
    </svg>
  );
}
