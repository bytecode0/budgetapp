import { useState } from 'react';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../context/AuthContext';
import { usePeaceCheckins } from '../hooks/usePeaceCheckins';

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

/** Whole months between two "YYYY-MM" labels. */
function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

// "¿Cómo te sientes hoy con tu dinero?" on Home (LPBETA-24): once per budget
// period (the first visit after signing up is the baseline). After answering,
// with 2+ answers, one plain line with the first answer and today's — no
// judgement either way. Only the person sees their answers.
export function PeaceCheckinCard() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { state, answer } = usePeaceCheckins();
  const [dismissed, setDismissed] = useState(() => readDismissed(user?.id));
  const [saving, setSaving] = useState(false);
  const [justAnswered, setJustAnswered] = useState(false);
  const [closed, setClosed] = useState(false);

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

  const first = state.checkins[0];
  const latest = state.checkins[state.checkins.length - 1];
  const evolution = justAnswered && state.checkins.length >= 2 ? { first, latest, months: monthsBetween(first.period, latest.period) } : null;

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}
      aria-labelledby="peace-question"
      className="bg-card border border-border rounded-2xl p-5 space-y-4"
    >
      {!justAnswered ? (
        <>
          <div className="flex items-start justify-between gap-3">
            <h2 id="peace-question" className="font-display text-lg">{t('peace.question')}</h2>
            <button
              onClick={notNow}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors shrink-0 rounded-lg px-2 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t('peace.notNow')}
            </button>
          </div>
          <div role="group" aria-labelledby="peace-question" className="grid grid-cols-5 gap-2">
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
        <div className="flex items-start justify-between gap-3" role="status">
          <div className="space-y-1">
            <h2 id="peace-question" className="font-display text-lg">{t('peace.thanks')}</h2>
            {evolution && (
              <p className="text-sm">
                <span aria-hidden="true">
                  {t('peace.evolution', { count: evolution.months, from: FACES[evolution.first.score - 1], to: FACES[evolution.latest.score - 1] })}
                </span>
                <span className="sr-only">
                  {t('peace.evolution', { count: evolution.months, from: word(evolution.first.score), to: word(evolution.latest.score) })}
                </span>
              </p>
            )}
            <p className="text-xs text-muted-foreground">{t('peace.private')}</p>
          </div>
          <button
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
