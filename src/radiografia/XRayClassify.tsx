// Mandatory classification gate.
//
// Some movements are genuinely unknowable from a bank statement: a transfer to
// your own account in another bank, money sent to family, cash withdrawn to
// save — and the same is true in reverse for money coming IN: a cash re-deposit
// or a transfer from another account of yours isn't necessarily new income.
// Guessing either direction is what made the savings verdict untrustworthy — a
// single "Bizum, sin concepto" block, or a single "Ingreso en efectivo", can be
// a fifth of everything that moved through the account. So when that volume is
// material we stop and ask, BEFORE showing any score. An honest verdict is
// worth one extra step in the funnel.

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'motion/react';
import {
  PiggyBank, TrendingUp, ShoppingCart, HeartHandshake, Wallet, ArrowLeftRight,
  HelpCircle, ArrowRight,
} from 'lucide-react';
import { XRayMark } from './XRayMark';
import { money } from './format';
import type { MovementAnswer, IncomeAnswer, Overrides, UncertainItem } from './types';

// Ask about the groups that actually move the number: largest first until we've
// covered this share of the ambiguous volume, hard-capped so a statement with a
// long tail of tiny transfers never turns into a chore.
const COVERAGE_TARGET = 0.85;
const MAX_ASKED = 10;

// Savings and investment are separate answers, not one "wealth" bucket: the
// difference between parking money and putting it to work is exactly what the
// archetype needs to tell apart.
const OUTFLOW_ANSWERS: { value: MovementAnswer; icon: typeof PiggyBank }[] = [
  { value: 'consumption', icon: ShoppingCart },
  { value: 'savings', icon: PiggyBank },
  { value: 'investment', icon: TrendingUp },
  { value: 'giving', icon: HeartHandshake },
];
const INCOME_ANSWERS: { value: IncomeAnswer; icon: typeof PiggyBank }[] = [
  { value: 'income', icon: Wallet },
  { value: 'notIncome', icon: ArrowLeftRight },
];

// A row is answered when its first key is; they're always set together.
const rowKey = (it: UncertainItem) => it.keys[0] ?? '';

/** Largest-first selection covering COVERAGE_TARGET of the total, capped at MAX_ASKED. */
function pickRequired(items: UncertainItem[], total: number): UncertainItem[] {
  const sorted = [...items].sort((a, b) => b.total - a.total);
  const out: UncertainItem[] = [];
  let covered = 0;
  for (const it of sorted) {
    if (out.length >= MAX_ASKED) break;
    out.push(it);
    covered += it.total;
    if (total > 0 && covered / total >= COVERAGE_TARGET) break;
  }
  return out;
}

interface SectionProps<A extends string> {
  titleKey: string;
  subtitleKey: string;
  items: UncertainItem[];
  total: number;
  answerSet: { value: A; icon: typeof PiggyBank }[];
  answers: Overrides;
  busy: boolean;
  onAnswer: (keys: string[], value: A) => void;
  showAll: boolean;
  onShowAll: () => void;
  lang: 'es' | 'en';
}

function ClassifySection<A extends string>({
  titleKey, subtitleKey, items, total, answerSet, answers, busy, onAnswer, showAll, onShowAll, lang,
}: SectionProps<A>) {
  const { t } = useTranslation();
  const required = useMemo(() => pickRequired(items, total), [items, total]);
  const optional = items.filter(i => !required.includes(i));
  const visible = showAll ? [...items].sort((a, b) => b.total - a.total) : required;
  const answered = required.filter(i => answers[rowKey(i)]).length;

  if (items.length === 0) return null;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-display text-lg">{t(titleKey)}</h2>
        <p className="text-sm text-muted-foreground">{t(subtitleKey, { amount: money(total, lang) })}</p>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-primary"
            initial={{ width: 0 }}
            animate={{ width: `${(answered / Math.max(1, required.length)) * 100}%` }}
            transition={{ duration: 0.3 }}
          />
        </div>
        <span className="text-xs text-muted-foreground shrink-0 font-display">
          {answered}/{required.length}
        </span>
      </div>

      <div className="space-y-3">
        {visible.map(item => {
          const chosen = answers[rowKey(item)];
          return (
            <div
              key={rowKey(item)}
              className={`bg-card border rounded-2xl p-4 space-y-3 transition-colors ${
                chosen ? 'border-primary/40' : 'border-border'
              }`}
            >
              <div className="flex items-baseline justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-display truncate">
                    {item.detail ?? t('radiografia.classify.noName')}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {item.amountEach != null
                      ? t('radiografia.classify.repeated', { count: item.count, amount: money(item.amountEach, lang) })
                      : t('radiografia.classify.assorted', { count: item.count })}
                  </p>
                </div>
                <span className="font-display text-lg shrink-0">{money(item.total, lang)}</span>
              </div>

              <div className={`grid gap-2 ${answerSet.length > 2 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-2'}`}>
                {answerSet.map(({ value, icon: Icon }) => {
                  const active = chosen === value;
                  return (
                    <button
                      key={value}
                      onClick={() => onAnswer(item.keys, value)}
                      disabled={busy}
                      className={`flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl border text-xs transition-colors disabled:opacity-50 ${
                        active
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border hover:border-primary/40 text-muted-foreground'
                      }`}
                    >
                      <Icon className="w-5 h-5" />
                      {t(`radiografia.classify.answer.${value}`)}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {optional.length > 0 && !showAll && (
        <button
          onClick={onShowAll}
          className="w-full py-2.5 border border-dashed border-border rounded-xl text-sm text-muted-foreground hover:border-primary hover:text-primary transition-colors inline-flex items-center justify-center gap-1.5"
        >
          <HelpCircle className="w-4 h-4" />
          {t('radiografia.classify.showRest', { count: optional.length })}
        </button>
      )}
    </div>
  );
}

interface Props {
  outflowItems: UncertainItem[];
  outflowTotal: number;
  incomeItems: UncertainItem[];
  incomeTotal: number;
  busy: boolean;
  onAnswerOutflow: (keys: string[], value: MovementAnswer) => void;
  onAnswerIncome: (keys: string[], value: IncomeAnswer) => void;
  answers: Overrides;
  onDone: () => void;
}

export function XRayClassify({
  outflowItems, outflowTotal, incomeItems, incomeTotal, busy, onAnswerOutflow, onAnswerIncome, answers, onDone,
}: Props) {
  const { t } = useTranslation();
  const lang: 'es' | 'en' = 'es';
  const [showAllOutflow, setShowAllOutflow] = useState(false);
  const [showAllIncome, setShowAllIncome] = useState(false);

  const requiredOutflow = useMemo(() => pickRequired(outflowItems, outflowTotal), [outflowItems, outflowTotal]);
  const requiredIncome = useMemo(() => pickRequired(incomeItems, incomeTotal), [incomeItems, incomeTotal]);
  const totalRequired = requiredOutflow.length + requiredIncome.length;
  const totalAnswered =
    requiredOutflow.filter(i => answers[rowKey(i)]).length + requiredIncome.filter(i => answers[rowKey(i)]).length;
  const canContinue = totalAnswered === totalRequired && !busy;

  return (
    <div className="min-h-screen bg-background flex flex-col items-center px-6 py-16 md:py-24">
      <motion.div initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-2xl space-y-8">
        <div className="text-center space-y-3">
          <div className="inline-flex items-center gap-2.5 justify-center">
            <XRayMark className="w-7 h-7" />
            <span className="text-sm text-primary uppercase" style={{ letterSpacing: '0.1em' }}>
              {t('radiografia.classify.badge')}
            </span>
          </div>
          <h1 className="text-3xl md:text-4xl font-display tracking-tight leading-tight">
            {t('radiografia.classify.title')}
          </h1>
          <p className="text-muted-foreground max-w-lg mx-auto">{t('radiografia.classify.intro')}</p>
        </div>

        <ClassifySection
          titleKey="radiografia.classify.outflowTitle"
          subtitleKey="radiografia.classify.outflowSubtitle"
          items={outflowItems}
          total={outflowTotal}
          answerSet={OUTFLOW_ANSWERS}
          answers={answers}
          busy={busy}
          onAnswer={onAnswerOutflow}
          showAll={showAllOutflow}
          onShowAll={() => setShowAllOutflow(true)}
          lang={lang}
        />

        <ClassifySection
          titleKey="radiografia.classify.incomeTitle"
          subtitleKey="radiografia.classify.incomeSubtitle"
          items={incomeItems}
          total={incomeTotal}
          answerSet={INCOME_ANSWERS}
          answers={answers}
          busy={busy}
          onAnswer={onAnswerIncome}
          showAll={showAllIncome}
          onShowAll={() => setShowAllIncome(true)}
          lang={lang}
        />

        <button
          onClick={onDone}
          disabled={!canContinue}
          className="w-full py-3 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors font-display disabled:opacity-50 inline-flex items-center justify-center gap-2"
        >
          {canContinue
            ? t('radiografia.classify.submit')
            : t('radiografia.classify.pending', { count: totalRequired - totalAnswered })}
          {canContinue && <ArrowRight className="w-4 h-4" />}
        </button>

        <p className="text-xs text-muted-foreground text-center">{t('radiografia.classify.why')}</p>
      </motion.div>
    </div>
  );
}
