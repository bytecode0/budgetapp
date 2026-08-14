// Shareable "Wrapped-style" card for the Radiografía (R6 virality).
//
// Rendered on a canvas so it needs no dependencies and no server round-trip. It
// deliberately carries NO sensitive figures — only the health score, stage and
// savings-rate percentage plus branding — so it's safe to post publicly.

interface CardData {
  score: number;
  // The translated archetype name — the identity line people screenshot.
  archetypeLabel: string;
  // The archetype KEY, which drives the traffic light independently of language.
  archetypeKey: string;
  // One line of recognition under the archetype ("that's me"), which is what
  // actually makes someone screenshot it.
  archetypeDesc?: string;
  savingsRatePct: number;   // 0–100
  strongestLabel: string;
  lang: 'es' | 'en';
  // The pivot's most "shareable" number — % of income already committed to
  // debt/cuotas. Optional: only present when the user has debt (monthlyTotal > 0).
  debtPctOfIncome?: number; // 0–100
}

const FOREST = '#1F3D30';
const FOREST_DEEP = '#12241C';
const GOLD = '#D9B872';

// Traffic light: the answer to "am I OK?" before anyone reads a single number.
// Mirrors stageLight() in server/lib/xray/labels.ts — keep the two in sync.
const LIGHTS = { red: '#E5484D', amber: '#E8A33D', green: '#3FA97A' } as const;
type Light = keyof typeof LIGHTS;

// Mirrors archetypeLight() in server/lib/xray/archetype.ts — keep in sync.
function lightForArchetype(key: string): Light {
  if (key === 'slave') return 'red';
  // A faithful giver with no cushion is genuinely fragile, however admirable.
  if (key === 'juggler' || key === 'braveGiver') return 'amber';
  return 'green';
}

// One glyph per identity, so the card is recognisable at a glance.
function archetypeEmoji(key: string): string {
  switch (key) {
    case 'slave': return '⛓️';
    case 'juggler': return '🤹';
    case 'builder': return '🧱';
    case 'sower': return '🌱';
    case 'braveGiver': return '🕊️';
    case 'steward': return '🗝️';
    case 'multiplier': return '📈';
    default: return '🧭';
  }
}

const COPY = {
  es: { title: 'Mi Salud Financiera', of: 'de 100', savings: 'Tasa de ahorro', strength: 'Mi fortaleza', debtLoad: 'Futuro comprometido', made: 'Hecho con Radiografía Financiera' },
  en: { title: 'My Financial Health', of: 'out of 100', savings: 'Savings rate', strength: 'My strength', debtLoad: 'Committed future', made: 'Made with Financial X-Ray' },
};

/** Draw the share card onto a 1080×1080 canvas. */
export function renderShareCard(canvas: HTMLCanvasElement, d: CardData): void {
  const S = 1080;
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const t = COPY[d.lang];

  // Background gradient — the "film" ground
  const bg = ctx.createLinearGradient(0, 0, S, S);
  bg.addColorStop(0, FOREST);
  bg.addColorStop(1, FOREST_DEEP);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, S, S);

  // Soft glow
  const glow = ctx.createRadialGradient(S * 0.8, S * 0.15, 0, S * 0.8, S * 0.15, 500);
  glow.addColorStop(0, 'rgba(217,184,114,0.18)');
  glow.addColorStop(1, 'rgba(217,184,114,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, S, S);

  const cx = S / 2;
  ctx.textAlign = 'center';

  // Title
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = '600 46px system-ui, -apple-system, "Segoe UI", sans-serif';
  ctx.fillText(t.title, cx, 150);

  // Score ring
  const ringY = 430;
  const radius = 180;
  ctx.lineWidth = 34;
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.beginPath();
  ctx.arc(cx, ringY, radius, 0, Math.PI * 2);
  ctx.stroke();

  // The ring itself carries the traffic light, so the verdict reads instantly
  // even at thumbnail size where no text is legible.
  const light = LIGHTS[lightForArchetype(d.archetypeKey)];
  ctx.strokeStyle = light;
  ctx.beginPath();
  ctx.arc(cx, ringY, radius, -Math.PI / 2, -Math.PI / 2 + (d.score / 100) * Math.PI * 2);
  ctx.stroke();

  // Score number
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '800 170px system-ui, -apple-system, sans-serif';
  ctx.fillText(String(d.score), cx, ringY + 55);
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.font = '500 34px system-ui, sans-serif';
  ctx.fillText(t.of, cx, ringY + 110);

  // Archetype — the identity line. This is the part people screenshot, so it
  // gets the largest type after the score itself.
  ctx.fillStyle = GOLD;
  ctx.font = '700 58px system-ui, sans-serif';
  ctx.fillText(`${archetypeEmoji(d.archetypeKey)}  ${d.archetypeLabel}`, cx, 716);

  // One line of recognition, wrapped to at most two lines so the layout can't
  // overflow into the stats row no matter how long the translation is.
  if (d.archetypeDesc) {
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = '400 30px system-ui, sans-serif';
    const maxWidth = S - 200;
    const lines: string[] = [];
    let line = '';
    for (const word of d.archetypeDesc.split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width > maxWidth && line) {
        lines.push(line);
        line = word;
        if (lines.length === 2) break;
      } else {
        line = candidate;
      }
    }
    if (lines.length < 2 && line) lines.push(line);
    lines.slice(0, 2).forEach((l, i) => ctx.fillText(l, cx, 768 + i * 38));
  }

  // Stats row — two by default (savings rate + strongest pillar), or three when
  // the futuro comprometido % is available (the pivot's most shareable number).
  const stats: { label: string; value: string }[] = [
    { label: t.savings, value: `${d.savingsRatePct}%` },
    { label: t.strength, value: d.strongestLabel },
  ];
  if (d.debtPctOfIncome != null) stats.push({ label: t.debtLoad, value: `${d.debtPctOfIncome}%` });

  const statY = 878;
  const spread = stats.length === 3 ? 320 : 240;
  const labelSize = stats.length === 3 ? 26 : 30;
  const valueSize = stats.length === 3 ? 50 : 62;
  const labelSmallSize = stats.length === 3 ? 38 : 48;
  stats.forEach((s, i) => {
    const x = cx + (i - (stats.length - 1) / 2) * spread;
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = `500 ${labelSize}px system-ui, sans-serif`;
    ctx.fillText(s.label.toUpperCase(), x, statY);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `700 ${/^\d+%$/.test(s.value) ? valueSize : labelSmallSize}px system-ui, sans-serif`;
    ctx.fillText(s.value, x, statY + 62);
  });

  // Footer brand
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.font = '500 30px system-ui, sans-serif';
  ctx.fillText(`✨  ${t.made}`, cx, 1010);
}

/** Render + share (Web Share API with the image file) or download as a fallback. */
export async function shareCard(d: CardData): Promise<'shared' | 'downloaded' | 'error'> {
  try {
    const canvas = document.createElement('canvas');
    renderShareCard(canvas, d);
    const blob: Blob | null = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) return 'error';

    const file = new File([blob], 'radiografia-financiera.png', { type: 'image/png' });
    const nav = navigator as Navigator & { canShare?: (data: { files: File[] }) => boolean };
    if (nav.share && nav.canShare?.({ files: [file] })) {
      await nav.share({
        files: [file],
        title: d.lang === 'es' ? 'Mi Salud Financiera' : 'My Financial Health',
      });
      return 'shared';
    }

    // Fallback: trigger a download.
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'radiografia-financiera.png';
    a.click();
    URL.revokeObjectURL(url);
    return 'downloaded';
  } catch {
    return 'error';
  }
}
