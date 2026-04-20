import { useState } from 'react';
import { ArrowLeft, CheckCircle2, Loader2, PiggyBank, TrendingUp, Calendar, Sparkles, Shield, Rocket } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { usePlans } from '../hooks/usePlans';
import { useTranslation } from 'react-i18next';

// ── Safety categories ─────────────────────────────────────────────────────────
const SAFETY_CATEGORIES = [
  { id: 'emergency', icon: '🛡️', color: '#10B981', labelKey: 'createPlan.safetyEmergency',  descKey: 'createPlan.safetyEmergencyDesc' },
  { id: 'liquidity', icon: '💧', color: '#06B6D4', labelKey: 'createPlan.safetyLiquidity',  descKey: 'createPlan.safetyLiquidityDesc' },
  { id: 'medical',   icon: '🏥', color: '#F59E0B', labelKey: 'createPlan.safetyMedical',    descKey: 'createPlan.safetyMedicalDesc' },
  { id: 'tax',       icon: '📋', color: '#8B5CF6', labelKey: 'createPlan.safetyTax',         descKey: 'createPlan.safetyTaxDesc' },
  { id: 'other',     icon: '⚙️', color: '#6366F1', labelKey: 'createPlan.safetyCustom',      descKey: 'createPlan.safetyCustomDesc' },
];

// ── Savings categories ────────────────────────────────────────────────────────
const SAVINGS_CATEGORIES = [
  { id: 'house',     icon: '🏠', color: '#1E3A8A', labelKey: 'createPlan.savingsHome',       descKey: 'createPlan.savingsHomeDesc' },
  { id: 'car',       icon: '🚗', color: '#8B5CF6', labelKey: 'createPlan.savingsCar',        descKey: 'createPlan.savingsCarDesc' },
  { id: 'vacation',  icon: '✈️', color: '#3B82F6', labelKey: 'createPlan.savingsVacation',   descKey: 'createPlan.savingsVacationDesc' },
  { id: 'education', icon: '🎓', color: '#06B6D4', labelKey: 'createPlan.savingsEducation',  descKey: 'createPlan.savingsEducationDesc' },
  { id: 'business',  icon: '🚀', color: '#EF4444', labelKey: 'createPlan.savingsBusiness',   descKey: 'createPlan.savingsBusinessDesc' },
  { id: 'purchase',  icon: '🛍️', color: '#EC4899', labelKey: 'createPlan.savingsPurchase',   descKey: 'createPlan.savingsPurchaseDesc' },
  { id: 'other',     icon: '⭐', color: '#6366F1', labelKey: 'createPlan.savingsCustom',      descKey: 'createPlan.savingsCustomDesc' },
];

// ── Icons ─────────────────────────────────────────────────────────────────────
const ICON_OPTIONS = [
  '🎯','⭐','🏆','💎','🌟','✨','🔑','🎁',
  '✈️','🚀','🌍','🏖️','⛵','🏔️','🗺️','🎡',
  '🏠','🏡','🏢','🏗️','🛖','🏰','🏯','🌆',
  '🚗','🚕','🏍️','🚢','🚁','🛸','🚂','🚴',
  '📈','💰','💵','💳','🏦','💹','📊','🪙',
  '🎓','📚','🔬','🧪','💡','🎨','🎵','🎮',
  '🛡️','🆘','⚓','🧲','⚙️','🔧','🛠️','🧱',
  '💻','📱','🖥️','⌚','📷','🎬','📻','🎙️',
  '🌱','🌳','🌊','⚡','🔥','❄️','☀️','🌙',
];

const COLOR_OPTIONS = [
  '#1E3A8A','#10B981','#F59E0B','#EF4444','#8B5CF6',
  '#3B82F6','#EC4899','#06B6D4','#84CC16','#F97316',
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function calcMonthlyNeeded(target: number, current: number, deadline: string): number {
  const months = Math.max(1, Math.ceil(
    (new Date(deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24 * 30)
  ));
  return Math.max(0, (target - current) / months);
}

function compoundBalance(current: number, monthly: number, months: number, annualRate: number): number {
  if (annualRate === 0) return current + monthly * months;
  const r = annualRate / 12;
  return current * Math.pow(1 + r, months) + monthly * (Math.pow(1 + r, months) - 1) / r;
}

// ── Component ─────────────────────────────────────────────────────────────────
export function CreatePlan({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  const { createPlan } = usePlans();
  const [step, setStep]   = useState(1);
  const [saving, setSaving] = useState(false);

  // Shared
  const [goalClass, setGoalClass] = useState<'safety' | 'savings' | 'investment' | 'wealth' | ''>('');
  const [title, setTitle]           = useState('');
  const [description, setDescription] = useState('');
  const [icon, setIcon]             = useState('🎯');
  const [color, setColor]           = useState('#1E3A8A');

  // Savings-specific
  const [savingsCategory, setSavingsCategory] = useState('');
  const [targetAmount, setTargetAmount]   = useState('');
  const [currentAmount, setCurrentAmount] = useState('');
  const [deadline, setDeadline]           = useState('');
  const [monthlyContrib, setMonthlyContrib] = useState('');

  // Investment-specific
  const [milestone, setMilestone]         = useState('');
  const [invMonthly, setInvMonthly]       = useState('');
  const [invCurrent, setInvCurrent]       = useState('');

  const selectedCategory = goalClass === 'safety'
    ? SAFETY_CATEGORIES.find(c => c.id === savingsCategory)
    : SAVINGS_CATEGORIES.find(c => c.id === savingsCategory);

  const handleTargetChange = (v: string) => {
    setTargetAmount(v);
    if (v && deadline) setMonthlyContrib(String(Math.ceil(calcMonthlyNeeded(parseFloat(v), parseFloat(currentAmount) || 0, deadline))));
  };
  const handleCurrentChange = (v: string) => {
    setCurrentAmount(v);
    if (targetAmount && deadline) setMonthlyContrib(String(Math.ceil(calcMonthlyNeeded(parseFloat(targetAmount), parseFloat(v) || 0, deadline))));
  };
  const handleDeadlineChange = (v: string) => {
    setDeadline(v);
    if (targetAmount && v) setMonthlyContrib(String(Math.ceil(calcMonthlyNeeded(parseFloat(targetAmount), parseFloat(currentAmount) || 0, v))));
  };

  const isCompoundGoal = goalClass === 'investment' || goalClass === 'wealth';
  const compoundRates: [number, number, number] = goalClass === 'wealth' ? [0.05, 0.12, 0.25] : [0.01, 0.05, 0.15];
  const compoundScenarios = goalClass === 'wealth'
    ? [t('createPlan.conservative'), t('createPlan.expected'), t('createPlan.aggressive')]
    : [t('createPlan.pessimistic'), t('createPlan.base'), t('createPlan.optimistic')];

  const invPreview = (() => {
    const monthly  = parseFloat(invMonthly) || 0;
    const current  = parseFloat(invCurrent) || 0;
    if (monthly <= 0) return null;
    const [r0, r1, r2] = compoundRates;
    return [
      { label: t('createPlan.years5'),  pessimistic: compoundBalance(current, monthly, 60,  r0), base: compoundBalance(current, monthly, 60,  r1), optimistic: compoundBalance(current, monthly, 60,  r2) },
      { label: t('createPlan.years10'), pessimistic: compoundBalance(current, monthly, 120, r0), base: compoundBalance(current, monthly, 120, r1), optimistic: compoundBalance(current, monthly, 120, r2) },
      { label: t('createPlan.years20'), pessimistic: compoundBalance(current, monthly, 240, r0), base: compoundBalance(current, monthly, 240, r1), optimistic: compoundBalance(current, monthly, 240, r2) },
    ];
  })();

  const handleCreate = async () => {
    if (!goalClass) return;
    setSaving(true);
    const result = await createPlan({
      title,
      description,
      goalClass,
      type: isCompoundGoal ? goalClass : (savingsCategory || 'other'),
      icon,
      color,
      targetAmount: parseFloat(isCompoundGoal ? (milestone || '0') : targetAmount) || 0,
      currentAmount: parseFloat(isCompoundGoal ? invCurrent : currentAmount) || 0,
      monthlyContribution: parseFloat(isCompoundGoal ? invMonthly : monthlyContrib) || 0,
      deadline: !isCompoundGoal && deadline ? deadline : undefined,
    });
    setSaving(false);
    if ('error' in result && result.error) { toast.error(result.error); return; }
    toast.success(t('createPlan.planCreated'));
    onBack();
  };

  const totalSteps = isCompoundGoal ? 3 : 4;

  return (
    <div className="space-y-6 pb-8">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-4">
        <button
          onClick={() => { if (step === 1) onBack(); else setStep(s => s - 1); }}
          className="w-10 h-10 bg-card border border-border rounded-lg flex items-center justify-center hover:bg-muted transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-4xl tracking-tight">{t('createPlan.title')}</h1>
          <p className="text-muted-foreground">{t('createPlan.subtitle')}</p>
        </div>
      </motion.div>

      {/* Progress bar */}
      <div className="flex items-center gap-2 max-w-sm">
        {Array.from({ length: totalSteps }, (_, i) => (
          <div key={i} className={`flex-1 h-1.5 rounded-full transition-all ${i + 1 <= step ? 'bg-primary' : 'bg-muted'}`} />
        ))}
      </div>

      <AnimatePresence mode="wait">

        {/* ── STEP 1: Goal Class ── */}
        {step === 1 && (
          <motion.div key="step1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="max-w-3xl">
            <div className="mb-6">
              <h2 className="text-2xl font-display mb-1">{t('createPlan.whatKind')}</h2>
              <p className="text-muted-foreground">{t('createPlan.whatKindSubtitle')}</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

              {/* Safety Plan */}
              <motion.button
                onClick={() => { setGoalClass('safety'); setIcon('🛡️'); setColor('#10B981'); setStep(2); }}
                whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                className="bg-card border-2 border-border hover:border-emerald-500 rounded-2xl p-6 text-left transition-all group space-y-3"
              >
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-emerald-100 dark:bg-emerald-950/40 flex items-center justify-center">
                    <Shield className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <div>
                    <h3 className="font-display text-lg group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">{t('createPlan.typeSafety')}</h3>
                    <p className="text-xs text-muted-foreground">{t('createPlan.typeSafetyRisk')}</p>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">{t('createPlan.typeSafetyDesc')}</p>
                <ul className="space-y-1 text-sm text-muted-foreground">
                  {[t('createPlan.safetyEx1'), t('createPlan.safetyEx2'), t('createPlan.safetyEx3')].map(ex => (
                    <li key={ex} className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                      {ex}
                    </li>
                  ))}
                </ul>
              </motion.button>

              {/* Savings Goal */}
              <motion.button
                onClick={() => { setGoalClass('savings'); setIcon('🎯'); setColor('#1E3A8A'); setStep(2); }}
                whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                className="bg-card border-2 border-border hover:border-primary rounded-2xl p-6 text-left transition-all group space-y-3"
              >
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                    <PiggyBank className="w-6 h-6 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-display text-lg group-hover:text-primary transition-colors">{t('createPlan.typeSavings')}</h3>
                    <p className="text-xs text-muted-foreground">{t('createPlan.typeSavingsRisk')}</p>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">{t('createPlan.typeSavingsDesc')}</p>
                <ul className="space-y-1 text-sm text-muted-foreground">
                  {[t('createPlan.savingsEx1'), t('createPlan.savingsEx2'), t('createPlan.savingsEx3')].map(ex => (
                    <li key={ex} className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-primary/40 shrink-0" />
                      {ex}
                    </li>
                  ))}
                </ul>
              </motion.button>

              {/* Investment Plan */}
              <motion.button
                onClick={() => { setGoalClass('investment'); setIcon('📈'); setColor('#10B981'); setStep(2); }}
                whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                className="bg-card border-2 border-border hover:border-secondary rounded-2xl p-6 text-left transition-all group space-y-3"
              >
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-secondary/10 flex items-center justify-center">
                    <TrendingUp className="w-6 h-6 text-secondary" />
                  </div>
                  <div>
                    <h3 className="font-display text-lg group-hover:text-secondary transition-colors">{t('createPlan.typeInvestment')}</h3>
                    <p className="text-xs text-muted-foreground">{t('createPlan.typeInvestmentRisk')}</p>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">{t('createPlan.typeInvestmentDesc')}</p>
                <ul className="space-y-1 text-sm text-muted-foreground">
                  {[t('createPlan.investmentEx1'), t('createPlan.investmentEx2'), t('createPlan.investmentEx3')].map(ex => (
                    <li key={ex} className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-secondary/60 shrink-0" />
                      {ex}
                    </li>
                  ))}
                </ul>
              </motion.button>

              {/* Wealth Strategy */}
              <motion.button
                onClick={() => { setGoalClass('wealth'); setIcon('🚀'); setColor('#F59E0B'); setStep(2); }}
                whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
                className="bg-card border-2 border-border hover:border-amber-500 rounded-2xl p-6 text-left transition-all group space-y-3"
              >
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-amber-100 dark:bg-amber-950/40 flex items-center justify-center">
                    <Rocket className="w-6 h-6 text-amber-600 dark:text-amber-400" />
                  </div>
                  <div>
                    <h3 className="font-display text-lg group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors">{t('createPlan.typeWealth')}</h3>
                    <p className="text-xs text-muted-foreground">{t('createPlan.typeWealthRisk')}</p>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">{t('createPlan.typeWealthDesc')}</p>
                <ul className="space-y-1 text-sm text-muted-foreground">
                  {[t('createPlan.wealthEx1'), t('createPlan.wealthEx2'), t('createPlan.wealthEx3')].map(ex => (
                    <li key={ex} className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                      {ex}
                    </li>
                  ))}
                </ul>
              </motion.button>

            </div>
          </motion.div>
        )}

        {/* ── STEP 2 (SAFETY): Category ── */}
        {step === 2 && goalClass === 'safety' && (
          <motion.div key="step2-safety" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
            <div className="mb-6">
              <h2 className="text-2xl font-display mb-1">{t('createPlan.whatProtecting')}</h2>
              <p className="text-muted-foreground">{t('createPlan.whatProtectingSubtitle')}</p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {SAFETY_CATEGORIES.map(cat => (
                <motion.button
                  key={cat.id}
                  onClick={() => { setSavingsCategory(cat.id); setIcon(cat.icon); setColor(cat.color); setStep(3); }}
                  whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                  className="bg-card border-2 border-border hover:border-emerald-500 rounded-2xl p-5 text-left transition-all group"
                >
                  <div className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl mb-3" style={{ background: `${cat.color}18` }}>
                    {cat.icon}
                  </div>
                  <p className="font-display text-sm group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">{t(cat.labelKey)}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{t(cat.descKey)}</p>
                </motion.button>
              ))}
            </div>
          </motion.div>
        )}

        {/* ── STEP 2 (SAVINGS): Category ── */}
        {step === 2 && goalClass === 'savings' && (
          <motion.div key="step2-savings" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
            <div className="mb-6">
              <h2 className="text-2xl font-display mb-1">{t('createPlan.whatSavingFor')}</h2>
              <p className="text-muted-foreground">{t('createPlan.whatSavingSubtitle')}</p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {SAVINGS_CATEGORIES.map(cat => (
                <motion.button
                  key={cat.id}
                  onClick={() => { setSavingsCategory(cat.id); setIcon(cat.icon); setColor(cat.color); setStep(3); }}
                  whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                  className="bg-card border-2 border-border hover:border-primary rounded-2xl p-5 text-left transition-all group"
                >
                  <div className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl mb-3" style={{ background: `${cat.color}18` }}>
                    {cat.icon}
                  </div>
                  <p className="font-display text-sm group-hover:text-primary transition-colors">{t(cat.labelKey)}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{t(cat.descKey)}</p>
                </motion.button>
              ))}
            </div>
          </motion.div>
        )}

        {/* ── STEP 2 (INVESTMENT / WEALTH): Details ── */}
        {step === 2 && isCompoundGoal && (
          <motion.div key="step2-investment" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="max-w-2xl">
            <div className="mb-6">
              <h2 className="text-2xl font-display mb-1">
                {goalClass === 'wealth' ? t('createPlan.setupWealth') : t('createPlan.setupInvestment')}
              </h2>
              <p className="text-muted-foreground">
                {goalClass === 'wealth' ? t('createPlan.setupWealthSubtitle') : t('createPlan.setupInvestmentSubtitle')}
              </p>
            </div>
            <div className="bg-card border border-border rounded-2xl p-6 md:p-8 space-y-6">

              {/* Icon + Color */}
              <div className="flex items-start gap-6">
                <div>
                  <label className="block text-sm font-display mb-2">{t('createPlan.icon')}</label>
                  <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl border-2 border-border mb-2" style={{ background: `${color}20` }}>
                    {icon}
                  </div>
                  <div className="grid grid-cols-9 gap-1 max-w-[270px]">
                    {ICON_OPTIONS.map(ic => (
                      <button key={ic} onClick={() => setIcon(ic)}
                        className={`w-7 h-7 text-base rounded flex items-center justify-center transition-all ${icon === ic ? 'bg-primary/20 ring-1 ring-primary' : 'hover:bg-muted'}`}
                      >{ic}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-display mb-2">{t('createPlan.color')}</label>
                  <div className="grid grid-cols-5 gap-2">
                    {COLOR_OPTIONS.map(c => (
                      <button key={c} onClick={() => setColor(c)}
                        className={`w-8 h-8 rounded-full transition-all ${color === c ? 'ring-2 ring-offset-2 ring-primary scale-110' : 'hover:scale-105'}`}
                        style={{ background: c }}
                      />
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-display mb-2">{t('createPlan.planName')}</label>
                <input
                  type="text" autoFocus
                  placeholder={t('createPlan.planNamePlaceholder')}
                  className="w-full px-4 py-3 bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/50"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-sm font-display mb-2">{t('createPlan.descriptionOptional')}</label>
                <textarea
                  placeholder={t('createPlan.descriptionPlaceholder')}
                  rows={2}
                  className="w-full px-4 py-3 bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className="block text-sm font-display mb-1">{t('createPlan.monthlyContribution')}</label>
                  <p className="text-xs text-muted-foreground mb-2">{t('createPlan.monthlyContributionSubtitle')}</p>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground">€</span>
                    <input
                      type="number" min="0" step="50" autoFocus
                      placeholder="200"
                      className="w-full pl-8 pr-4 py-3 bg-background border-2 border-primary/30 focus:border-primary rounded-xl focus:outline-none text-lg font-display"
                      value={invMonthly}
                      onChange={e => setInvMonthly(e.target.value)}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-display mb-1">{t('createPlan.alreadyInvestedOptional')}</label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground">€</span>
                    <input type="number" min="0" placeholder="0"
                      className="w-full pl-8 pr-4 py-3 bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/50"
                      value={invCurrent}
                      onChange={e => setInvCurrent(e.target.value)}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-display mb-1">{t('createPlan.firstMilestoneOptional')}</label>
                  <p className="text-xs text-muted-foreground mb-1.5">{t('createPlan.firstMilestonePlaceholder')}</p>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground">€</span>
                    <input type="number" min="0" placeholder="50000"
                      className="w-full pl-8 pr-4 py-3 bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/50"
                      value={milestone}
                      onChange={e => setMilestone(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              {/* Live projection preview */}
              {parseFloat(invMonthly) > 0 && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-secondary/5 border border-secondary/20 rounded-xl p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-secondary" />
                    <p className="text-sm font-medium">{t('createPlan.projectionPreview', { amount: parseFloat(invMonthly).toLocaleString() })}</p>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    {invPreview?.map(row => (
                      <div key={row.label} className="text-center">
                        <p className="text-xs text-muted-foreground mb-1">{row.label}</p>
                        <p className="text-xs text-red-500">€{Math.round(row.pessimistic).toLocaleString()}</p>
                        <p className="text-sm font-display text-amber-600">€{Math.round(row.base).toLocaleString()}</p>
                        <p className="text-xs text-secondary">€{Math.round(row.optimistic).toLocaleString()}</p>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground text-center">
                    {`${compoundScenarios[0]} ${compoundRates[0]*100}% · ${compoundScenarios[1]} ${compoundRates[1]*100}% · ${compoundScenarios[2]} ${compoundRates[2]*100}% ${t('createPlan.annual')}`}
                  </p>
                </motion.div>
              )}

              <div className="flex gap-3 pt-2">
                <button onClick={() => setStep(1)} className="px-6 py-3 border border-border rounded-xl hover:bg-muted transition-colors">{t('createPlan.back')}</button>
                <button
                  onClick={() => setStep(3)}
                  disabled={!title || !invMonthly}
                  className={`flex-1 px-6 py-3 text-white rounded-xl hover:opacity-90 transition-colors disabled:opacity-50 ${goalClass === 'wealth' ? 'bg-amber-500' : 'bg-primary'}`}
                >
                  {t('createPlan.reviewPlan')}
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {/* ── STEP 3 (SAVINGS / SAFETY): Details ── */}
        {step === 3 && (goalClass === 'savings' || goalClass === 'safety') && (
          <motion.div key="step3-savings" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="max-w-2xl">
            <div className="mb-6">
              <h2 className="text-2xl font-display mb-1">{t('createPlan.planDetails')}</h2>
              <p className="text-muted-foreground">
                {goalClass === 'safety' ? t('createPlan.planDetailsSubtitle') : t('createPlan.planDetailsSubtitle2')}
              </p>
            </div>
            <div className="bg-card border border-border rounded-2xl p-6 md:p-8 space-y-6">

              {/* Icon + Color */}
              <div className="flex items-start gap-6">
                <div>
                  <label className="block text-sm font-display mb-2">{t('createPlan.icon')}</label>
                  <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl border-2 border-border mb-2" style={{ background: `${color}20` }}>
                    {icon}
                  </div>
                  <div className="grid grid-cols-9 gap-1 max-w-[270px]">
                    {ICON_OPTIONS.map(ic => (
                      <button key={ic} onClick={() => setIcon(ic)}
                        className={`w-7 h-7 text-base rounded flex items-center justify-center transition-all ${icon === ic ? 'bg-primary/20 ring-1 ring-primary' : 'hover:bg-muted'}`}
                      >{ic}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-display mb-2">{t('createPlan.color')}</label>
                  <div className="grid grid-cols-5 gap-2">
                    {COLOR_OPTIONS.map(c => (
                      <button key={c} onClick={() => setColor(c)}
                        className={`w-8 h-8 rounded-full transition-all ${color === c ? 'ring-2 ring-offset-2 ring-primary scale-110' : 'hover:scale-105'}`}
                        style={{ background: c }}
                      />
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-display mb-2">{t('createPlan.planName')}</label>
                <input type="text"
                  placeholder={selectedCategory ? t(selectedCategory.labelKey) : t('createPlan.planName')}
                  className="w-full px-4 py-3 bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/50"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-sm font-display mb-2">{t('createPlan.descriptionOptional')}</label>
                <textarea
                  placeholder={t('createPlan.descriptionPlanPlaceholder')}
                  rows={2}
                  className="w-full px-4 py-3 bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-display mb-2">{t('createPlan.targetAmount')}</label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground">€</span>
                    <input type="number" min="0" placeholder="10,000"
                      className="w-full pl-8 pr-4 py-3 bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/50"
                      value={targetAmount}
                      onChange={e => handleTargetChange(e.target.value)}
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-display mb-2">{t('createPlan.alreadySavedOptional')}</label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground">€</span>
                    <input type="number" min="0" placeholder="0"
                      className="w-full pl-8 pr-4 py-3 bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/50"
                      value={currentAmount}
                      onChange={e => handleCurrentChange(e.target.value)}
                    />
                  </div>
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-sm font-display mb-1 flex items-center gap-2">
                    <Calendar className="w-4 h-4" /> {t('createPlan.targetDateOptional')}
                  </label>
                  <input type="date"
                    min={new Date().toISOString().split('T')[0]}
                    className="w-full px-4 py-3 bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/50"
                    value={deadline}
                    onChange={e => handleDeadlineChange(e.target.value)}
                  />
                </div>
              </div>

              {/* Suggested monthly */}
              {monthlyContrib && (
                <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
                  className="bg-gradient-to-br from-primary/5 to-secondary/5 border border-primary/10 rounded-xl p-4"
                >
                  <p className="text-sm text-muted-foreground mb-1">{t('createPlan.suggestedContribution')}</p>
                  <p className="text-3xl font-display text-primary">€{parseInt(monthlyContrib).toLocaleString()}<span className="text-base text-muted-foreground font-normal">/mo</span></p>
                  <p className="text-xs text-muted-foreground mt-1">{t('createPlan.toReachGoal')}</p>
                </motion.div>
              )}

              <div className="flex gap-3 pt-2">
                <button onClick={() => setStep(2)} className="px-6 py-3 border border-border rounded-xl hover:bg-muted transition-colors">{t('createPlan.back')}</button>
                <button
                  onClick={() => setStep(4)}
                  disabled={!title || !targetAmount}
                  className="flex-1 px-6 py-3 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {t('createPlan.reviewPlan')}
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {/* ── STEP 3 (INVESTMENT/WEALTH) / STEP 4 (SAVINGS/SAFETY): Review ── */}
        {((step === 3 && isCompoundGoal) || (step === 4 && (goalClass === 'savings' || goalClass === 'safety'))) && (
          <motion.div key="review" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="max-w-2xl">
            <div className="mb-6">
              <h2 className="text-2xl font-display mb-1">{t('createPlan.reviewYourPlan')}</h2>
              <p className="text-muted-foreground">{t('createPlan.reviewSubtitle')}</p>
            </div>
            <div className="bg-card border border-border rounded-2xl p-6 md:p-8 space-y-6">

              {/* Plan header */}
              <div className="flex items-center gap-4 pb-6 border-b border-border">
                <div className="w-20 h-20 rounded-2xl flex items-center justify-center text-4xl shrink-0"
                  style={{ background: `${color}20`, border: `2px solid ${color}40` }}
                >
                  {icon}
                </div>
                <div>
                  <h3 className="text-2xl font-display mb-1">{title}</h3>
                  {description && <p className="text-muted-foreground text-sm">{description}</p>}
                  <span className={`inline-flex items-center gap-1.5 mt-1.5 px-3 py-1 rounded-full text-xs font-medium ${
                    goalClass === 'investment' ? 'bg-secondary/10 text-secondary'
                    : goalClass === 'wealth' ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400'
                    : goalClass === 'safety' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400'
                    : 'bg-primary/10 text-primary'
                  }`}>
                    {goalClass === 'investment' && <><TrendingUp className="w-3 h-3" /> {t('createPlan.typeInvestment')}</>}
                    {goalClass === 'wealth'     && <><TrendingUp className="w-3 h-3" /> {t('createPlan.typeWealth')}</>}
                    {goalClass === 'safety'     && <><Shield className="w-3 h-3" /> {t('createPlan.typeSafety')} · {selectedCategory ? t(selectedCategory.labelKey) : ''}</>}
                    {goalClass === 'savings'    && <><PiggyBank className="w-3 h-3" /> {t('createPlan.typeSavings')} · {selectedCategory ? t(selectedCategory.labelKey) : ''}</>}
                  </span>
                </div>
              </div>

              {/* Figures */}
              <div className="grid grid-cols-2 gap-4">
                {(goalClass === 'savings' || goalClass === 'safety') ? (
                  <>
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">{t('createPlan.targetAmount')}</p>
                      <p className="text-2xl font-display text-primary">€{parseFloat(targetAmount).toLocaleString()}</p>
                    </div>
                    {deadline && (
                      <div>
                        <p className="text-sm text-muted-foreground mb-1">{t('createPlan.targetDate')}</p>
                        <p className="text-2xl font-display">{new Date(deadline).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}</p>
                      </div>
                    )}
                    {monthlyContrib && (
                      <div>
                        <p className="text-sm text-muted-foreground mb-1">{t('createPlan.monthlyContribution')}</p>
                        <p className="text-2xl font-display text-secondary">€{parseInt(monthlyContrib).toLocaleString()}/mo</p>
                      </div>
                    )}
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">{t('createPlan.alreadySaved')}</p>
                      <p className="text-2xl font-display">€{parseFloat(currentAmount || '0').toLocaleString()}</p>
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">{t('createPlan.monthlyContribution')}</p>
                      <p className="text-2xl font-display text-secondary">€{parseFloat(invMonthly).toLocaleString()}/mo</p>
                    </div>
                    {invCurrent && (
                      <div>
                        <p className="text-sm text-muted-foreground mb-1">{t('createPlan.alreadyInvested')}</p>
                        <p className="text-2xl font-display">€{parseFloat(invCurrent).toLocaleString()}</p>
                      </div>
                    )}
                    {milestone && (
                      <div>
                        <p className="text-sm text-muted-foreground mb-1">{t('createPlan.firstMilestone')}</p>
                        <p className="text-2xl font-display text-primary">€{parseFloat(milestone).toLocaleString()}</p>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Compound projection summary in review */}
              {isCompoundGoal && invPreview && (
                <div className="bg-secondary/5 border border-secondary/20 rounded-xl p-4 space-y-3">
                  <p className="text-sm font-medium flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-secondary" /> {t('createPlan.projectionPreview', { amount: parseFloat(invMonthly).toLocaleString() })}
                  </p>
                  <div className="grid grid-cols-3 gap-3 text-center">
                    {invPreview.map(row => (
                      <div key={row.label} className="space-y-1">
                        <p className="text-xs font-medium text-muted-foreground">{row.label}</p>
                        <p className="text-xs text-red-500">€{Math.round(row.pessimistic).toLocaleString()}</p>
                        <p className="text-sm font-display text-amber-600">€{Math.round(row.base).toLocaleString()}</p>
                        <p className="text-xs text-secondary">€{Math.round(row.optimistic).toLocaleString()}</p>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground text-center">
                    {`${compoundScenarios[0]} ${compoundRates[0]*100}% · ${compoundScenarios[1]} ${compoundRates[1]*100}% · ${compoundScenarios[2]} ${compoundRates[2]*100}% ${t('createPlan.annual')}`}
                  </p>
                </div>
              )}

              <div className="bg-secondary/10 border border-secondary/20 rounded-xl p-4 flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-secondary mt-0.5 shrink-0" />
                <p className="text-sm text-muted-foreground">
                  {goalClass === 'investment' && t('createPlan.investmentProjectionNote')}
                  {goalClass === 'wealth'     && t('createPlan.wealthProjectionNote')}
                  {goalClass === 'safety'     && t('createPlan.safetyProjectionNote')}
                  {goalClass === 'savings'    && t('createPlan.savingsProjectionNote')}
                </p>
              </div>

              <div className="flex gap-3 pt-2">
                <button onClick={() => setStep(s => s - 1)} className="px-6 py-3 border border-border rounded-xl hover:bg-muted transition-colors">
                  {t('createPlan.back')}
                </button>
                <button
                  onClick={handleCreate} disabled={saving}
                  className="flex-1 px-6 py-3 bg-gradient-to-r from-primary to-secondary text-white rounded-xl hover:shadow-lg transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> {t('createPlan.creating')}</> : `${icon} ${t('createPlan.createPlan')}`}
                </button>
              </div>
            </div>
          </motion.div>
        )}

      </AnimatePresence>
    </div>
  );
}
