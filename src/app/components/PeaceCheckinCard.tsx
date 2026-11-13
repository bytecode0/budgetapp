import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../context/AuthContext';
import { usePeaceCheckins, type PeaceState } from '../hooks/usePeaceCheckins';

// The five faces, stored as 1 (muy intranquilo) to 5 (en paz).
const FACES = ['😣', '😟', '😐', '🙂', '😌'] as const;
const SCORES = [1, 2, 3, 4, 5] as const;

// "Ahora no" is remembered per person and per browser until the next budget
// period. Storage can be unavailable (private mode, blocked site data): then
// the card just comes back on the next visit.
const dismissKey = (userId: string) => `remanso.peaceDismissed.${userId}`;
function readDismissed(userId: string | undefined): string | null {
  if (!userId) return null;
  try { return window.localStorage.getItem(dismissKey(userId)); } catch { return null; }
}
function writeDismissed(userId: string | undefined, period: string) {
  if (!userId) return;
  try { window.localStorage.setItem(dismissKey(userId), period); } catch { /* not remembered */ }
}

// The first answer ever given (by when, not by period label: a payday change
// can make a later answer's label earlier) against the one just given, "hoy".
function evolutionOf(state: PeaceState): { months: number; from: number; to: number } | null {
  if (state.current === null) return null;
  const first = state.checkins.find(c => c.period !== state.period);
  if (!first) return null;
  const then = new Date(first.createdAt);
  const now = new Date();
  const months = (now.getFullYear() - then.getFullYear()) * 12 + (now.getMonth() - then.getMonth());
  return { months: Math.max(1, months), from: first.score, to: state.current };
}

// "¿Cómo te sientes hoy con tu dinero?" on Home (LPBETA-24): shown when the
// server says this budget period has no answer yet (`ask`), so the first visit
// after signing up is the baseline. After answering, with an earlier answer,
// one plain line with the first answer and today's — no judgement either way.
// Only the person sees their answers.
export function PeaceCheckinCard() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { state, answer } = usePeaceCheckins();
  const [dismissed, setDismissed] = useState(() => readDismissed(user?.id));
  const [saving, setSaving] = useState(false);
  const [justAnswered, setJustAnswered] = useState(false);
  const [closed, setClosed] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  // After answering, focus moves to the close button; the live region (mounted
  // with the card) says the thanks.
  useEffect(() => { if (justAnswered) closeRef.current?.focus(); }, [justAnswered]);

  if (!state || closed) return null;
  if (!justAnswered && (!state.ask || dismissed === state.period)) return null;

  const word = (score: number) => t(`peace.faces.${score}`);

  const choose = async (score: number) => {
    setSaving(true);
    const ok = await answer(score);
    setSaving(false);
    if (ok) setJustAnswered(true);
    else toast.error(t('peace.saveFailed'));
  };

  const notNow = () => {
    writeDismissed(user?.id, state.period);
    setDismissed(state.period);
  };

  const evolution = justAnswered ? evolutionOf(state) : null;

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}
      aria-labelledby="peace-heading"
      className="bg-card border border-border rounded-2xl p-5 space-y-4"
    >
      {/* Always mounted, so screen readers announce the text when it changes. */}
      <p role="status" aria-live="polite" className="sr-only">
        {justAnswered ? [
          t('peace.thanks'),
          evolution && t('peace.evolution', { count: evolution.months, from: word(evolution.from), to: word(evolution.to) }),
        ].filter(Boolean).join(' ') : ''}
      </p>

      {!justAnswered ? (
        <>
          <div className="flex items-start justify-between gap-3">
            <h2 id="peace-heading" className="font-display text-lg">{t('peace.question')}</h2>
            <button
              onClick={notNow}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors shrink-0 rounded-lg px-2 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t('peace.notNow')}
            </button>
          </div>
          <div role="group" aria-labelledby="peace-heading" className="grid grid-cols-5 gap-2">
            {SCORES.map(score => (
              <button
                key={score}
                onClick={() => choose(score)}
                disabled={saving}
                className="flex flex-col items-center gap-1 rounded-xl border border-border px-1 py-3 hover:bg-muted hover:border-primary transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="text-3xl leading-none" aria-hidden="true">{FACES[score - 1]}</span>
                <span className="text-xs text-muted-foreground text-center leading-tight">{word(score)}</span>
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{t('peace.private')}</p>
        </>
      ) : (
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <h2 id="peace-heading" className="font-display text-lg">{t('peace.thanks')}</h2>
            {evolution && (
              <p className="text-sm" aria-hidden="true">
                {t('peace.evolution', { count: evolution.months, from: FACES[evolution.from - 1], to: FACES[evolution.to - 1] })}
              </p>
            )}
            <p className="text-xs text-muted-foreground">{t('peace.private')}</p>
          </div>
          <button
            ref={closeRef}
            onClick={() => setClosed(true)}
            aria-label={t('peace.close')}
            className="p-2 rounded-lg hover:bg-muted transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </motion.section>
  );
}
