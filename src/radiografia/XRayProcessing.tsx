import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Tags, Calculator, Repeat, Bug, Gauge } from 'lucide-react';
import { XRayMark } from './XRayMark';

const STEPS = [
  { key: 'analyzing', Icon: Search },
  { key: 'categorizing', Icon: Tags },
  { key: 'calculating', Icon: Calculator },
  { key: 'recurring', Icon: Repeat },
  { key: 'ant', Icon: Bug },
  { key: 'scoring', Icon: Gauge },
];

const STEP_MS = 1300;

interface Props {
  ready: boolean;      // analysis result has arrived
  failed: boolean;     // analysis errored
  onDone: () => void;
  onFail: () => void;
}

export function XRayProcessing({ ready, failed, onDone, onFail }: Props) {
  const { t } = useTranslation();
  const [idx, setIdx] = useState(0);
  const readyRef = useRef(ready);
  readyRef.current = ready;

  useEffect(() => {
    if (failed) { onFail(); return; }
    let i = 0;
    const timer = setInterval(() => {
      i += 1;
      if (i >= STEPS.length) {
        clearInterval(timer);
        // Hold on the last step until the result is actually in, then reveal.
        const wait = setInterval(() => {
          if (readyRef.current) { clearInterval(wait); onDone(); }
        }, 200);
        return;
      }
      setIdx(i);
    }, STEP_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [failed]);

  const progress = Math.min(100, Math.round(((idx + 1) / STEPS.length) * 100));
  const { Icon } = STEPS[idx];

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6" style={{ background: 'var(--xray-film)', color: 'var(--xray-film-line)' }}>
      <XRayMark variant="negative" className="w-9 h-9 mb-7 opacity-90" />
      <motion.div
        key={idx}
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="w-24 h-24 rounded-full flex items-center justify-center"
        style={{ border: '2px solid var(--xray-film-gold)' }}
      >
        <Icon className="w-10 h-10" style={{ color: 'var(--xray-film-gold)' }} />
      </motion.div>

      <div className="h-8 mt-8 overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.p
            key={idx}
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -20, opacity: 0 }}
            className="font-display text-lg text-center"
          >
            {t(`radiografia.processing.${STEPS[idx].key}`)}
          </motion.p>
        </AnimatePresence>
      </div>

      <div className="w-full max-w-sm mt-6 h-2 rounded-full overflow-hidden" style={{ background: 'var(--xray-film-border)' }}>
        <motion.div
          className="h-full rounded-full"
          style={{ background: 'var(--xray-film-gold)' }}
          animate={{ width: `${progress}%` }}
          transition={{ ease: 'easeOut' }}
        />
      </div>
      <p className="text-xs mt-6 max-w-xs text-center" style={{ color: 'var(--xray-film-muted)' }}>{t('radiografia.processing.teaser')}</p>
    </div>
  );
}
