// Shareable "Wrapped-style" card for the Radiografía (R6 virality).
//
// Rendered on a canvas so it needs no dependencies and no server round-trip. It
// deliberately carries NO sensitive figures — only the health score, stage and
// savings-rate percentage plus branding — so it's safe to post publicly.

interface CardData {
  score: number;
  stageLabel: string;
  savingsRatePct: number;   // 0–100
  strongestLabel: string;
  lang: 'es' | 'en';
}

const NAVY = '#1E3A8A';
const GREEN = '#10B981';

function stageEmoji(score: number): string {
  if (score >= 80) return '💪';
  if (score >= 60) return '🌱';
  if (score >= 40) return '⚖️';
  return '🧭';
}

const COPY = {
  es: { title: 'Mi Salud Financiera', of: 'de 100', savings: 'Tasa de ahorro', strength: 'Mi fortaleza', made: 'Hecho con Radiografía Financiera' },
  en: { title: 'My Financial Health', of: 'out of 100', savings: 'Savings rate', strength: 'My strength', made: 'Made with Financial X-Ray' },
};

/** Draw the share card onto a 1080×1080 canvas. */
export function renderShareCard(canvas: HTMLCanvasElement, d: CardData): void {
  const S = 1080;
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const t = COPY[d.lang];

  // Background gradient
  const bg = ctx.createLinearGradient(0, 0, S, S);
  bg.addColorStop(0, NAVY);
  bg.addColorStop(1, '#0F2A6B');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, S, S);

  // Soft glow
  const glow = ctx.createRadialGradient(S * 0.8, S * 0.15, 0, S * 0.8, S * 0.15, 500);
  glow.addColorStop(0, 'rgba(16,185,129,0.25)');
  glow.addColorStop(1, 'rgba(16,185,129,0)');
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

  ctx.strokeStyle = GREEN;
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

  // Stage
  ctx.fillStyle = GREEN;
  ctx.font = '700 58px system-ui, sans-serif';
  ctx.fillText(`${stageEmoji(d.score)}  ${d.stageLabel}`, cx, 730);

  // Two stats
  const statY = 850;
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = '500 30px system-ui, sans-serif';
  ctx.fillText(t.savings.toUpperCase(), cx - 240, statY);
  ctx.fillText(t.strength.toUpperCase(), cx + 240, statY);
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 62px system-ui, sans-serif';
  ctx.fillText(`${d.savingsRatePct}%`, cx - 240, statY + 66);
  ctx.font = '700 48px system-ui, sans-serif';
  ctx.fillText(d.strongestLabel, cx + 240, statY + 62);

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
