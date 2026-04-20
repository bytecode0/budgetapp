import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Target, CheckCircle2, Sparkles, Crown, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { createCheckoutSession } from '../../../api/stripe';

interface WelcomeProps {
  onContinue: () => void;
}

const createConfetti = () => {
  const colors = ['#1E3A8A', '#10B981', '#F59E0B', '#3B82F6'];
  const confettiCount = 50;
  const confetti = [];

  for (let i = 0; i < confettiCount; i++) {
    const style: React.CSSProperties = {
      position: 'fixed',
      width: '10px',
      height: '10px',
      backgroundColor: colors[Math.floor(Math.random() * colors.length)],
      left: Math.random() * window.innerWidth + 'px',
      top: '-10px',
      opacity: Math.random(),
      transform: `rotate(${Math.random() * 360}deg)`,
      animation: `fall ${Math.random() * 3 + 2}s linear`,
      pointerEvents: 'none' as const,
      zIndex: 9999,
    };
    confetti.push(<div key={i} style={style} />);
  }
  return confetti;
};

export function Welcome({ onContinue }: WelcomeProps) {
  const { t } = useTranslation();
  const [showConfetti, setShowConfetti] = useState(true);
  const [upgradingToPremium, setUpgradingToPremium] = useState(false);

  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `
      @keyframes fall {
        to {
          transform: translateY(100vh) rotate(360deg);
          opacity: 0;
        }
      }
    `;
    document.head.appendChild(style);

    const timer = setTimeout(() => setShowConfetti(false), 5000);
    return () => {
      clearTimeout(timer);
      document.head.removeChild(style);
    };
  }, []);

  const handleStartPremium = async () => {
    setUpgradingToPremium(true);
    try {
      const { url } = await createCheckoutSession();
      window.location.href = url;
    } catch {
      setUpgradingToPremium(false);
    }
  };

  const freeFeatures = [
    t('auth.welcome.freePlanFeature1'),
    t('auth.welcome.freePlanFeature2'),
    t('auth.welcome.freePlanFeature3'),
    t('auth.welcome.freePlanFeature4'),
  ];

  const premiumFeatures = [
    t('auth.welcome.premiumFeature1'),
    t('auth.welcome.premiumFeature2'),
    t('auth.welcome.premiumFeature3'),
    t('auth.welcome.premiumFeature4'),
    t('auth.welcome.premiumFeature5'),
  ];

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4 relative overflow-hidden">
      {showConfetti && createConfetti()}
      <div className="w-full max-w-3xl relative z-10">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="text-center mb-10"
        >
          <div className="flex justify-center mb-6">
            <div className="w-20 h-20 bg-gradient-to-br from-primary to-secondary rounded-3xl flex items-center justify-center shadow-2xl">
              <Target className="w-11 h-11 text-white" />
            </div>
          </div>
          <h1 className="text-4xl md:text-5xl font-display text-primary mb-4">
            {t('auth.welcome.choosePlan')}
          </h1>
          <p className="text-lg text-muted-foreground max-w-lg mx-auto">
            {t('auth.welcome.choosePlanSubtitle')}
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          {/* Free Plan Card */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="bg-card border border-border rounded-3xl p-8 flex flex-col"
          >
            <div className="mb-6">
              <div className="w-12 h-12 bg-muted rounded-2xl flex items-center justify-center mb-4">
                <Sparkles className="w-6 h-6 text-muted-foreground" />
              </div>
              <h2 className="text-2xl font-display mb-1">{t('auth.welcome.freePlan')}</h2>
              <div className="flex items-baseline gap-1">
                <span className="text-4xl font-display text-foreground">{t('auth.welcome.freePlanPrice')}</span>
                <span className="text-muted-foreground">{t('auth.welcome.perMonth')}</span>
              </div>
            </div>

            <ul className="space-y-3 flex-1 mb-8">
              {freeFeatures.map((f) => (
                <li key={f} className="flex items-center gap-2 text-sm text-muted-foreground">
                  <CheckCircle2 className="w-4 h-4 text-secondary shrink-0" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>

            <button
              onClick={onContinue}
              className="w-full py-3 border border-border text-foreground rounded-2xl font-display hover:bg-muted transition-all"
            >
              {t('auth.welcome.continueFree')}
            </button>
          </motion.div>

          {/* Premium Plan Card */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="bg-gradient-to-br from-primary to-primary/90 rounded-3xl p-8 flex flex-col relative overflow-hidden shadow-2xl"
          >
            <div className="absolute top-0 right-0 w-48 h-48 bg-white/5 rounded-full blur-3xl -mr-16 -mt-16" />

            <div className="absolute top-4 right-4">
              <span className="bg-secondary text-white text-xs font-display px-3 py-1 rounded-full">
                {t('auth.welcome.mostPopular')}
              </span>
            </div>

            <div className="mb-6 relative z-10">
              <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center mb-4">
                <Crown className="w-6 h-6 text-white" />
              </div>
              <h2 className="text-2xl font-display text-white mb-1">{t('auth.welcome.premiumPlan')}</h2>
              <div className="flex items-baseline gap-1">
                <span className="text-4xl font-display text-white">{t('auth.welcome.premiumPlanPrice')}</span>
                <span className="text-white/70">{t('auth.welcome.perMonth')}</span>
              </div>
            </div>

            <ul className="space-y-3 flex-1 mb-8 relative z-10">
              {premiumFeatures.map((f) => (
                <li key={f} className="flex items-center gap-2 text-sm text-white/90">
                  <CheckCircle2 className="w-4 h-4 text-secondary shrink-0" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>

            <button
              onClick={handleStartPremium}
              disabled={upgradingToPremium}
              className="w-full py-3 bg-white text-primary rounded-2xl font-display hover:shadow-xl transition-all flex items-center justify-center gap-2 relative z-10 disabled:opacity-70"
            >
              {upgradingToPremium ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {t('auth.welcome.redirectingToStripe')}
                </>
              ) : (
                t('auth.welcome.startPremium')
              )}
            </button>
          </motion.div>
        </div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.5 }}
          className="text-center text-sm text-muted-foreground"
        >
          {t('auth.welcome.noCard')}
        </motion.p>
      </div>
    </div>
  );
}
