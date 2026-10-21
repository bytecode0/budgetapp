import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'motion/react';
import { XRayMark } from '../XRayMark';
import { OnboardingProgress } from '../onboarding/OnboardingProgress';

interface Props {
  step: number | 'done';
  children: ReactNode;
  // The report needs the full 1180px column; the form steps read better narrow.
  width?: 'narrow' | 'wide' | 'full';
}

const WIDTHS = {
  narrow: 'max-w-xl',
  wide: 'max-w-3xl',
  full: 'max-w-[1180px]',
};

/**
 * The frame every onboarding screen sits in: paper, the brand topbar, and the
 * progress bar. Having it in one place is what stops the five steps drifting
 * apart — before this, each screen repeated its own header markup and they had
 * already diverged in mark size, spacing and alignment.
 *
 * The entrance animation stays short on purpose: this is a five-screen wizard,
 * and animation time is paid once per step (CLAUDE.md — keep transitions
 * ≤200 ms so they don't add up into abandonment).
 */
export function PageShell({ step, children, width = 'narrow' }: Props) {
  const { t } = useTranslation();
  return (
    <div className="min-h-screen bg-background px-4 md:px-7 py-6 md:py-8">
      <div className="max-w-[1180px] mx-auto flex items-center gap-3 mb-8">
        <XRayMark className="w-9 h-9" />
        <span className="text-[13px] font-bold uppercase" style={{ letterSpacing: '0.14em', color: 'var(--primary)' }}>
          {t('radiografia.report.badge')}
        </span>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className={`w-full mx-auto space-y-6 ${WIDTHS[width]}`}
      >
        <OnboardingProgress step={step} />
        {children}
      </motion.div>
    </div>
  );
}
