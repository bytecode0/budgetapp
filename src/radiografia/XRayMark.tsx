interface Props {
  className?: string;
}

/**
 * The Radiografía mark: an ascending arrow on a forest-green tile.
 *
 * It replaced the earlier tree-with-bar-roots drawing when the report was
 * redesigned (Informe_redisenado.html). The tree lost too much at 24px in a
 * topbar, which is where this mark actually lives; the arrow keeps its meaning
 * — things going up — at any size. `className` sizes the tile, and the arrow
 * scales with it.
 */
export function XRayMark({ className = 'w-9 h-9' }: Props) {
  return (
    <span
      className={`inline-grid place-items-center rounded-xl shrink-0 ${className}`}
      style={{ background: 'var(--primary)', boxShadow: 'var(--xray-shadow-mark)' }}
      aria-hidden
    >
      <svg viewBox="0 0 24 24" className="w-[55%] h-[55%]" fill="none" stroke="var(--primary-foreground)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M7 17L17 7" />
        <path d="M9 7h8v8" />
      </svg>
    </span>
  );
}
