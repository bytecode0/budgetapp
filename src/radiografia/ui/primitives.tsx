import type { ReactNode } from 'react';

// The visual grammar of the Radiografía, from Informe_redisenado.html. Shared
// by the report and by all five onboarding screens on purpose: the four
// detected figures a person reviews at step 2 are rendered by the same StatCard
// that opens their report, which is most of what makes the funnel and its
// output read as one product rather than two.
//
// Every colour here comes from a token in ../xray-theme.css. Nothing in this
// file, or in anything that uses it, should carry a hex code or a Tailwind
// palette class (`emerald-50`, `amber-200`): those don't follow the theme.

export type Tone = 'plain' | 'good' | 'warn' | 'bad' | 'info';

const TONE_VARS: Record<Exclude<Tone, 'plain'>, { bg: string; border: string; fg: string }> = {
  good: { bg: 'var(--xray-good-bg)', border: 'var(--xray-good-border)', fg: 'var(--xray-good-fg)' },
  warn: { bg: 'var(--xray-warn-bg)', border: 'var(--xray-warn-border)', fg: 'var(--xray-warn-fg)' },
  bad: { bg: 'var(--xray-bad-bg)', border: 'var(--xray-bad-border)', fg: 'var(--xray-bad-fg)' },
  info: { bg: 'var(--xray-info-bg)', border: 'var(--xray-info-border)', fg: 'var(--xray-info-fg)' },
};

function toneStyle(tone: Tone) {
  if (tone === 'plain') return { background: 'var(--card)', borderColor: 'var(--border)' };
  const t = TONE_VARS[tone];
  return { background: t.bg, borderColor: t.border };
}

export function toneColor(tone: Tone): string {
  return tone === 'plain' ? 'var(--muted-foreground)' : TONE_VARS[tone].fg;
}

/** Uppercase micro-label above a heading. */
export function Eyebrow({ children, color }: { children: ReactNode; color?: string }) {
  return (
    <p
      className="text-[11px] font-bold uppercase"
      style={{ letterSpacing: '0.13em', color: color ?? 'var(--primary)' }}
    >
      {children}
    </p>
  );
}

/** Eyebrow + H2 on the left, an optional intro paragraph on the right. */
export function SectionHead({ eyebrow, title, intro }: { eyebrow: string; title: string; intro?: string }) {
  return (
    <div className="flex flex-col md:flex-row md:justify-between md:items-end gap-3 md:gap-5 mb-4">
      <div>
        <Eyebrow>{eyebrow}</Eyebrow>
        <h2 className="font-display text-2xl md:text-3xl leading-tight mt-1">{title}</h2>
      </div>
      {intro && <p className="text-sm text-muted-foreground max-w-xl md:text-right">{intro}</p>}
    </div>
  );
}

/**
 * The green gradient header. `aside` is the glass card the design floats on the
 * right (the stage, on the report; nothing, on most onboarding screens), and it
 * drops under the headline rather than shrinking it on narrow screens.
 */
export function Hero({ kicker, title, intro, aside }: { kicker?: string; title: string; intro?: string; aside?: ReactNode }) {
  return (
    <section
      data-xray-surface
      className="relative overflow-hidden rounded-[32px] p-8 md:p-11 text-white"
      style={{ background: 'var(--xray-hero)', boxShadow: 'var(--xray-shadow-hero)' }}
    >
      {/* The two rings. Decorative and aria-hidden — they carry no meaning. */}
      <span aria-hidden className="pointer-events-none absolute rounded-full border border-white/15" style={{ width: 420, height: 420, right: -150, top: -190 }} />
      <span aria-hidden className="pointer-events-none absolute rounded-full border border-white/10" style={{ width: 260, height: 260, right: 70, bottom: -170 }} />

      <div className="relative z-10 grid gap-8 md:grid-cols-[1fr_auto] md:items-end">
        <div>
          {kicker && <p className="text-xs uppercase opacity-70" style={{ letterSpacing: '0.16em' }}>{kicker}</p>}
          <h1 className="font-display font-extrabold mt-2.5 mb-4 max-w-3xl text-4xl md:text-6xl leading-[0.98]" style={{ letterSpacing: '-0.04em' }}>
            {title}
          </h1>
          {intro && <p className="max-w-2xl text-base md:text-lg text-white/80">{intro}</p>}
        </div>
        {aside}
      </div>
    </section>
  );
}

/** The frosted card inside the hero. */
export function HeroAside({ label, title, detail }: { label: string; title: string; detail?: string }) {
  return (
    <div className="md:min-w-[240px] rounded-[22px] border border-white/20 bg-white/10 backdrop-blur-md p-5">
      <p className="text-[11px] uppercase opacity-65" style={{ letterSpacing: '0.12em' }}>{label}</p>
      <p className="font-display text-2xl md:text-3xl mt-1">{title}</p>
      {detail && <p className="text-sm text-white/75 mt-1">{detail}</p>}
    </div>
  );
}

/** One of the figures in the "cuatro cifras" grid, and of the detected-values grid at step 2. */
export function StatCard({ label, value, note, tone = 'plain' }: { label: string; value: string; note?: string; tone?: Tone }) {
  return (
    <div
      data-xray-surface
      className="rounded-[20px] border p-5"
      style={{ ...toneStyle(tone), boxShadow: tone === 'plain' ? 'var(--xray-shadow-card)' : undefined }}
    >
      <p className="text-[11px] uppercase text-muted-foreground" style={{ letterSpacing: '0.08em' }}>{label}</p>
      <p className="font-display text-3xl mt-1.5 mb-0.5">{value}</p>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}

/** The white card everything sits in. `dark` is the closing archetype panel. */
export function Panel({ children, dark = false, className = '' }: { children: ReactNode; dark?: boolean; className?: string }) {
  return (
    <div
      data-xray-surface
      className={`rounded-3xl p-6 md:p-7 ${dark ? 'text-white' : 'border'} ${className}`}
      style={dark
        ? { background: 'var(--xray-panel-dark)' }
        : { background: 'var(--card)', borderColor: 'var(--border)', boxShadow: 'var(--xray-shadow)' }}
    >
      {children}
    </div>
  );
}

export function PanelTitle({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-5">
      <h3 className="font-display text-xl">{title}</h3>
      {sub && <p className="text-sm text-muted-foreground mt-1">{sub}</p>}
    </div>
  );
}

/**
 * Actual vs target, with the target as a mark on the track rather than a second
 * bar. A second bar invites "which one am I?"; a mark reads as a line to reach.
 * `deviation` is in percentage points and is what the reader is actually here
 * for, so it gets its own line under the bar with an explicit sign.
 */
export function TargetBar({ label, pct, targetPct, deviation, deviationLabel }: {
  label: string;
  pct: number;
  targetPct: number;
  deviation: number;
  deviationLabel: string;
}) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div className="mb-4 last:mb-0">
      <div className="flex justify-between gap-3 text-xs mb-2">
        <span>{label}</span>
        <span className="font-display">{pct}% <span className="text-muted-foreground">/ {targetPct}%</span></span>
      </div>
      <div className="relative h-3 rounded-full overflow-hidden" style={{ background: 'var(--xray-track)' }}>
        <span className="block h-full rounded-full" style={{ width: `${clamped}%`, background: 'var(--primary)' }} />
      </div>
      <div className="relative">
        {/* Outside the overflow-hidden track so it can stand proud of it. */}
        <span aria-hidden className="absolute w-0.5 h-[19px] opacity-40" style={{ left: `${Math.min(100, targetPct)}%`, top: -15, background: 'var(--foreground)' }} />
      </div>
      <div className="flex justify-between text-[11px] text-muted-foreground mt-1.5">
        <span>{deviationLabel}</span>
        <strong className="text-foreground">{deviation > 0 ? '+' : ''}{deviation} pp</strong>
      </div>
    </div>
  );
}

/** Label / proportional bar / figure. The categories list. */
export function MoneyRow({ label, fraction, value }: { label: string; fraction: number; value: string }) {
  return (
    <div className="grid items-center gap-2.5 text-[13px] grid-cols-[95px_1fr_52px] md:grid-cols-[120px_1fr_52px]">
      <span className="truncate">{label}</span>
      <div className="h-3 rounded-full overflow-hidden" style={{ background: 'var(--xray-track)' }}>
        <span className="block h-full rounded-full" style={{ width: `${Math.max(2, Math.min(100, fraction * 100))}%`, background: 'var(--xray-bar)' }} />
      </div>
      <b className="text-right font-display font-semibold">{value}</b>
    </div>
  );
}

/** Pill used for "palanca rápida" and the archetype chips. */
export function Badge({ children, tone = 'warn' }: { children: ReactNode; tone?: Tone }) {
  const style = tone === 'plain'
    ? { background: 'var(--muted)', color: 'var(--muted-foreground)' }
    : { background: TONE_VARS[tone].bg, color: TONE_VARS[tone].fg };
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[11px] font-bold uppercase" style={{ ...style, letterSpacing: '0.06em' }}>
      {children}
    </span>
  );
}

/** A dashed "here is money you can move" block. */
export function Focus({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-2xl border border-dashed p-4 mt-2.5 first:mt-0" style={{ borderColor: 'var(--xray-warn-border)', background: 'var(--xray-warn-bg)' }}>
      <Eyebrow color="var(--xray-warn-fg)">{label}</Eyebrow>
      <p className="font-display text-xl mt-1">{value}</p>
      {detail && <p className="text-xs text-muted-foreground mt-0.5">{detail}</p>}
    </div>
  );
}

/** One of the three numbered next steps. */
export function ActionCard({ index, title, detail, impact }: { index: number; title: string; detail: string; impact?: string }) {
  return (
    <article data-xray-surface className="relative overflow-hidden rounded-[22px] border p-6" style={{ background: 'var(--card)', borderColor: 'var(--border)' }}>
      <span aria-hidden className="absolute rounded-full" style={{ right: -34, top: -34, width: 100, height: 100, background: 'var(--xray-good-bg)' }} />
      <div className="relative z-10">
        <p className="font-display text-[46px] leading-none" style={{ color: 'var(--xray-good-border)' }}>
          {String(index).padStart(2, '0')}
        </p>
        <h3 className="font-display text-lg mt-2.5 mb-1.5">{title}</h3>
        <p className="text-[13px] text-muted-foreground">{detail}</p>
        {impact && <p className="text-xs font-bold mt-2.5" style={{ color: 'var(--primary)' }}>{impact}</p>}
      </div>
    </article>
  );
}
