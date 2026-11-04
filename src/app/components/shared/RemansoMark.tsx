// The Remanso mark (LPBETA-26): calm water, a sun, and three lines going from
// current to stillness. Brand colours are fixed in the SVG (public/icons/);
// never recolour it. Decorative next to the name (alt=""), labelled when alone.
export function RemansoMark({ className = 'w-10 h-10', label }: { className?: string; label?: string }) {
  return <img src="/icons/remanso-mark.svg" alt={label ?? ''} aria-hidden={label ? undefined : true} className={`shrink-0 ${className}`} draggable={false} />;
}
