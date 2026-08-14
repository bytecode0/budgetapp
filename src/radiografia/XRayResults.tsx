import { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'motion/react';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import {
  TrendingUp, TrendingDown, Bug, Repeat, Lightbulb, ArrowRight, PiggyBank, Landmark, HelpCircle, Banknote,
  ArrowRightLeft, Share2, Wallet, Plus, HeartHandshake, CreditCard, Calendar, ShoppingBag, AlertCircle, Car,
} from 'lucide-react';
import type { XRayResult, XRayCategory, Overrides, DebtKind } from './types';
import { money, pct, prettyMerchant } from './format';
import { shareCard } from './shareCard';
import { XRayMark } from './XRayMark';

const DONUT = ['#1F3D30', '#A9822F', '#6B8F7A', '#8C6A4A', '#55707A', '#B0906A', '#3F5A45', '#9A7B4F', '#748C82', '#6E5B47'];

interface Props {
  result: XRayResult;
  // True for a manual quick-estimate result (no statement uploaded): hides the
  // sections that need real transaction data (hero summary, category chart) so
  // the debts/health sections — the only real numbers — stand on their own.
  reduced?: boolean;
  lang: string;
  sessionId: string | null;
  track: (event: string, sessionId?: string | null) => void;
  onReclassify: (overrides: Overrides) => Promise<void>;
  onAddAccount: (files: File[]) => Promise<{ error?: string }>;
  onEmailCta: () => void;
}

// Mirrors Debts.tsx's kindIcon() for the same icon-per-kind mapping. Not
// imported directly — Debts.tsx is an authenticated component, this is public.
function debtKindIcon(kind: DebtKind) {
  switch (kind) {
    case 'credit_card': return CreditCard;
    case 'installment': return Calendar;
    case 'bnpl': return ShoppingBag;
    case 'payday_loan': return AlertCircle;
    case 'auto_loan': return Car;
    default: return Wallet;
  }
}

function Section({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.5 }}
      className={`w-full max-w-3xl mx-auto ${className}`}
    >
      {children}
    </motion.section>
  );
}

// One of the three wealth super-categories (Ahorro / Generosidad / Inversión) —
// each rendered as its own full Section, same visual weight as every other
// major block on this page (ant expenses, recurring, etc.), not a shared card.
function WealthSection({ icon, bg, border, fg, title, total, reframe, items, lang }: {
  icon: React.ReactNode;
  bg: string; border: string; fg: string;
  title: string;
  total: string;
  reframe: string;
  items: { merchant: string; total: number }[];
  lang: string;
}) {
  return (
    <Section>
      <div className="rounded-3xl p-8" style={{ background: bg, border: `1px solid ${border}` }}>
        <div className="flex items-center gap-2 mb-3" style={{ color: fg }}>
          {icon}
          <span className="font-display">{title}</span>
        </div>
        <p className="text-4xl font-display">{total}</p>
        <p className="text-muted-foreground mt-2">{reframe}</p>
        {items.length > 0 && (
          <div className="mt-6 space-y-2">
            {items.slice(0, 6).map(i => (
              <div key={i.merchant} className="flex items-center justify-between text-sm bg-card/60 rounded-xl px-4 py-2.5">
                <span className="font-display truncate">{prettyMerchant(i.merchant)}</span>
                <span className="text-muted-foreground shrink-0">{money(i.total, lang)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Section>
  );
}

export function XRayResults({ result, reduced = false, lang, sessionId, track, onReclassify, onAddAccount, onEmailCta }: Props) {
  const { t } = useTranslation();
  const { summary, categories, antExpenses, recurring, wealth, internalTransfers, balances, debts, health, archetype, income, opportunities } = result;

  const addInputRef = useRef<HTMLInputElement>(null);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState(false);
  const onAddFiles = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setAdding(true);
    setAddError(false);
    const { error } = await onAddAccount(Array.from(list));
    setAdding(false);
    if (error) setAddError(true);
  };

  const catLabel = (c: XRayCategory) => c.label ?? t(`radiografia.category.${c.key}`, prettyMerchant(c.key));
  const positive = summary.net >= 0;

  const [sharing, setSharing] = useState(false);
  const onShare = async () => {
    track('share_clicked', sessionId);
    setSharing(true);
    await shareCard({
      score: health.score,
      archetypeLabel: t(`radiografia.archetype.${archetype.key}`),
      archetypeKey: archetype.key,
      archetypeDesc: t(`radiografia.archetypeDesc.${archetype.key}`, ''),
      savingsRatePct: Math.max(0, Math.round(summary.savingsRate * 100)),
      strongestLabel: t(`radiografia.pillar.${health.strongestKey}`),
      lang: lang === 'es' ? 'es' : 'en',
      debtPctOfIncome: debts.monthlyTotal > 0 ? Math.round(debts.pctOfIncome * 100) : undefined,
    });
    setSharing(false);
  };

  // Correction card: the ambiguous movements are frozen from the first result so
  // toggling doesn't make rows disappear. Numbers/score update from the live prop.
  const [uncertainList] = useState(result.uncertain.items);
  const [overrides, setOverrides] = useState<Overrides>({});
  const [busy, setBusy] = useState(false);

  const setOverride = async (keys: string[], value: 'consumption' | 'wealth') => {
    const next = { ...overrides };
    for (const k of keys) next[k] = value;
    setOverrides(next);
    setBusy(true);
    await onReclassify(next);
    setBusy(false);
  };
  const classOf = (merchant: string) => overrides[merchant] ?? 'wealth'; // default: not spending

  return (
    <div className="min-h-screen bg-background pb-32">
      <div className="px-6 py-16 space-y-24">

        {/* 1 — Summary hero (needs a real statement — hidden in reduced/manual mode) */}
        {!reduced && (
          <Section>
            <p className="text-sm text-muted-foreground text-center mb-3">
              {t('radiografia.results.periodLabel', { months: result.period.months })}
            </p>
            <div className="bg-primary text-primary-foreground rounded-3xl p-8 md:p-12 shadow-2xl relative overflow-hidden">
              <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full blur-3xl -mr-32 -mt-32" />
              <div className="relative z-10 space-y-6">
                <p className="text-lg opacity-90">{t('radiografia.results.heroLead')}</p>
                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <p className="text-sm opacity-70">{t('radiografia.results.income')}</p>
                    <p className="text-3xl md:text-4xl font-display">{money(summary.totalIncome, lang)}</p>
                  </div>
                  <div>
                    <p className="text-sm opacity-70">{t('radiografia.results.expenses')}</p>
                    <p className="text-3xl md:text-4xl font-display">{money(summary.totalExpenses, lang)}</p>
                  </div>
                </div>
                <div className="pt-4 border-t border-white/20 flex items-end justify-between">
                  <div>
                    <p className="text-sm opacity-70">{positive ? t('radiografia.results.saved') : t('radiografia.results.overspent')}</p>
                    <p className="text-5xl font-display flex items-center gap-2">
                      {positive ? <TrendingUp className="w-8 h-8" /> : <TrendingDown className="w-8 h-8" />}
                      {money(Math.abs(summary.net), lang)}
                    </p>
                  </div>
                  <p className="text-2xl font-display opacity-90">{pct(summary.savingsRate, lang)}</p>
                </div>
              </div>
            </div>
            {/* Transparency: a smaller income than the raw statement total isn't a
                bug — say exactly what was excluded and why, so the number is
                trusted rather than second-guessed. */}
            {income.excluded.total > 0 && (
              <p className="text-xs text-muted-foreground text-center mt-3">
                {t('radiografia.results.incomeExcludedNote', {
                  amount: money(income.excluded.total, lang),
                  reasons: income.excluded.items.map(i => t(`radiografia.incomeReason.${i.reason}`)).join(', '),
                })}
              </p>
            )}
          </Section>
        )}

        {/* 1.5 — Liquid net worth (from the account balances) */}
        {balances.hasData && (
          <Section>
            <div className="bg-card border border-border rounded-3xl p-8">
              <div className="flex items-center gap-2 text-primary mb-3">
                <Landmark className="w-5 h-5" />
                <span className="font-display">{t('radiografia.results.balanceTitle')}</span>
              </div>
              <p className="text-4xl md:text-5xl font-display">{money(balances.total, lang)}</p>
              {balances.runwayMonths != null && (
                <p className="text-muted-foreground mt-2">
                  {t('radiografia.results.runway', { months: balances.runwayMonths })}
                </p>
              )}
              {balances.accounts.length > 1 && (
                <div className="mt-5 grid sm:grid-cols-2 gap-3">
                  {balances.accounts.map(a => (
                    <div key={a.fileIndex} className="flex items-center justify-between text-sm bg-muted/40 rounded-xl px-4 py-2.5">
                      <span className="font-display">{t('radiografia.results.account', { n: a.fileIndex + 1 })}</span>
                      <span className="text-muted-foreground">{money(a.balance, lang)}</span>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground mt-4">{t('radiografia.results.balanceNote')}</p>
            </div>
          </Section>
        )}

        {/* 1.6 — Futuro comprometido (debt/cuota detection) — the pivot's headline
             metric. Always shown, even at zero: a "no debt detected" reading is
             valuable and shareable, not a gap to hide. */}
        <Section>
          <div
            className="rounded-3xl p-8 md:p-10"
            style={{
              background: debts.monthlyTotal > 0 ? 'var(--xray-warn-bg)' : 'var(--xray-good-bg)',
              border: `1px solid ${debts.monthlyTotal > 0 ? 'var(--xray-warn-border)' : 'var(--xray-good-border)'}`,
            }}
          >
            <div className="flex items-center gap-2 mb-3" style={{ color: debts.monthlyTotal > 0 ? 'var(--xray-warn-fg)' : 'var(--xray-good-fg)' }}>
              <CreditCard className="w-5 h-5" />
              <span className="font-display">{t('radiografia.results.debtsTitle')}</span>
            </div>
            {debts.monthlyTotal > 0 ? (
              <>
                <p className="text-4xl md:text-5xl font-display">{pct(debts.pctOfIncome, lang)}</p>
                <p className="text-muted-foreground mt-2">
                  {t('radiografia.results.debtsReframe', { count: Math.max(1, Math.round(debts.pctOfIncome * 30)), amount: money(debts.monthlyTotal, lang, { decimals: true }) })}
                </p>
                <div className="mt-6 space-y-2">
                  {debts.items.map((item, i) => {
                    const Icon = debtKindIcon(item.kind);
                    return (
                      <div key={`${i}-${item.merchant}`} className="flex items-center gap-3 text-sm bg-card/60 rounded-xl px-4 py-2.5">
                        <Icon className="w-4 h-4 shrink-0" />
                        <span className="font-display truncate flex-1">{prettyMerchant(item.merchant)}</span>
                        <span className="text-muted-foreground shrink-0">{money(item.monthlyAmount, lang, { decimals: true })}</span>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <p className="text-muted-foreground">{t('radiografia.results.debtsNone')}</p>
            )}
            {debts.mortgage?.detected && (
              <p className="text-xs text-muted-foreground mt-4">
                {t('radiografia.results.mortgageNote', { amount: money(debts.mortgage.monthlyAmount, lang, { decimals: true }) })}
              </p>
            )}
          </div>
        </Section>

        {/* 2 — Where the money goes (needs a real statement — hidden in reduced/manual mode) */}
        {!reduced && (
          <Section>
            <h2 className="text-2xl font-display mb-1">{t('radiografia.results.categoriesTitle')}</h2>
            <p className="text-muted-foreground mb-6">{t('radiografia.results.categoriesSubtitle')}</p>
            <div className="grid md:grid-cols-2 gap-6 items-center">
              <div className="h-60">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={categories} dataKey="total" nameKey="key" innerRadius={62} outerRadius={100} paddingAngle={2} stroke="none">
                      {categories.map((_, i) => <Cell key={i} fill={DONUT[i % DONUT.length]} />)}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-3">
                {categories.slice(0, 6).map((c, i) => (
                  <div key={c.key} className="flex items-center gap-3">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: DONUT[i % DONUT.length] }} />
                    <span className="text-lg">{c.icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-display truncate">{catLabel(c)}</p>
                      <p className="text-xs text-muted-foreground">{t('radiografia.results.perYear', { amount: money(c.annualized, lang) })}</p>
                    </div>
                    <p className="text-sm font-display shrink-0">{money(c.total, lang)}</p>
                  </div>
                ))}
              </div>
            </div>
          </Section>
        )}

        {/* 3 — Gastos hormiga (the bomb) */}
        {antExpenses.items.length > 0 && (
          <Section>
            <div className="rounded-3xl p-8 md:p-10" style={{ background: 'var(--xray-warn-bg)', border: '1px solid var(--xray-warn-border)' }}>
              <div className="flex items-center gap-2 mb-3" style={{ color: 'var(--xray-warn-fg)' }}>
                <Bug className="w-5 h-5" />
                <span className="font-display">{t('radiografia.results.antTitle')}</span>
              </div>
              <p className="text-4xl md:text-5xl font-display">{money(antExpenses.annualized, lang)}<span className="text-xl text-muted-foreground">/{t('radiografia.results.year')}</span></p>
              <p className="text-muted-foreground mt-2">{t('radiografia.results.antReframe', { amount: money(antExpenses.annualized * 5, lang) })}</p>
              <div className="mt-6 space-y-2">
                {antExpenses.items.slice(0, 5).map(item => (
                  <div key={item.merchant} className="flex items-center justify-between text-sm bg-card/60 rounded-xl px-4 py-2.5">
                    <span className="font-display">{prettyMerchant(item.merchant)}</span>
                    <span className="text-muted-foreground">{t('radiografia.results.antItem', { count: item.count, avg: money(item.avgTicket, lang, { decimals: true }) })}</span>
                  </div>
                ))}
              </div>
            </div>
          </Section>
        )}

        {/* 4 — Recurring / subscriptions */}
        {recurring.count > 0 && (
          <Section>
            <h2 className="text-2xl font-display mb-1 flex items-center gap-2"><Repeat className="w-5 h-5 text-primary" />{t('radiografia.results.recurringTitle')}</h2>
            <p className="text-muted-foreground mb-6">{t('radiografia.results.recurringSubtitle', { count: recurring.count, amount: money(recurring.monthlyTotal, lang) })}</p>
            <div className="grid sm:grid-cols-2 gap-3">
              {recurring.items.map(item => (
                <div key={item.merchant} className="bg-card border border-border rounded-2xl p-4 flex items-center justify-between">
                  <div>
                    <p className="font-display">{prettyMerchant(item.merchant)}</p>
                    <p className="text-xs text-muted-foreground">{t('radiografia.results.perYear', { amount: money(item.annualized, lang) })}</p>
                  </div>
                  <p className="font-display">{money(item.monthlyAmount, lang, { decimals: true })}</p>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* 4.5 — Savings, giving & investment detected: three fully separate sections,
             not variants of one — Ahorro/Generosidad/Inversión are distinct concepts. */}
        {wealth.savings > 0 && (
          <WealthSection
            icon={<PiggyBank className="w-5 h-5" style={{ color: 'var(--xray-good-fg)' }} />}
            bg="var(--xray-good-bg)" border="var(--xray-good-border)" fg="var(--xray-good-fg)"
            title={t('radiografia.results.savingsCardTitle')}
            total={money(wealth.savings, lang)}
            reframe={t('radiografia.results.savingsReframe')}
            items={wealth.items.filter(i => i.kind === 'savings')}
            lang={lang}
          />
        )}
        {wealth.giving > 0 && (
          <WealthSection
            icon={<HeartHandshake className="w-5 h-5" style={{ color: 'var(--xray-giving-fg)' }} />}
            bg="var(--xray-giving-bg)" border="var(--xray-giving-border)" fg="var(--xray-giving-fg)"
            title={t('radiografia.results.givingCardTitle')}
            total={money(wealth.giving, lang)}
            reframe={t('radiografia.results.givingReframe')}
            items={wealth.items.filter(i => i.kind === 'giving')}
            lang={lang}
          />
        )}
        {wealth.investment > 0 && (
          <WealthSection
            icon={<TrendingUp className="w-5 h-5" style={{ color: 'var(--xray-good-fg)' }} />}
            bg="var(--xray-good-bg)" border="var(--xray-good-border)" fg="var(--xray-good-fg)"
            title={t('radiografia.results.investmentCardTitle')}
            total={money(wealth.investment, lang)}
            reframe={t('radiografia.results.investmentReframe')}
            items={wealth.items.filter(i => i.kind === 'investment')}
            lang={lang}
          />
        )}

        {/* 4.55 — Internal transfers reconciled between the user's own accounts */}
        {internalTransfers.count > 0 && (
          <Section>
            <div className="bg-card border border-border rounded-3xl p-8">
              <div className="flex items-center gap-2 mb-1">
                <ArrowRightLeft className="w-5 h-5 text-primary" />
                <h2 className="text-2xl font-display">{t('radiografia.results.internalTitle')}</h2>
              </div>
              <p className="text-muted-foreground mb-5">
                {t('radiografia.results.internalReconciled', { count: internalTransfers.count, amount: money(internalTransfers.total, lang) })}
              </p>
              <div className="grid sm:grid-cols-2 gap-3">
                {internalTransfers.items.slice(0, 6).map((i, idx) => (
                  <div key={idx} className="flex items-center justify-between text-sm bg-muted/40 rounded-xl px-4 py-2.5">
                    <span className="font-display truncate">{i.detail ?? t('radiografia.results.transferGeneric')}</span>
                    <span className="text-muted-foreground shrink-0">{money(i.total, lang)}</span>
                  </div>
                ))}
              </div>
            </div>
          </Section>
        )}

        {/* 4.6 — Correction card: is this saving or spending? */}
        {uncertainList.length > 0 && (
          <Section>
            <div className="bg-card border border-border rounded-3xl p-8">
              <div className="flex items-center gap-2 mb-1">
                <HelpCircle className="w-5 h-5 text-primary" />
                <h2 className="text-2xl font-display">{t('radiografia.results.reviewTitle')}</h2>
              </div>
              <p className="text-muted-foreground mb-6">{t('radiografia.results.reviewSubtitle')}</p>
              <div className="space-y-2">
                {uncertainList.map(item => {
                  const cls = classOf(item.keys[0] ?? '');
                  const label = item.detail ?? (prettyMerchant(item.merchant) || t('radiografia.results.transferGeneric'));
                  return (
                    <div key={item.keys[0]} className="flex items-center gap-3 bg-muted/40 rounded-xl px-4 py-3">
                      <span className="w-8 h-8 rounded-lg bg-background flex items-center justify-center shrink-0">
                        {item.kind === 'cash' ? <Banknote className="w-4 h-4 text-muted-foreground" /> : <ArrowRightLeft className="w-4 h-4 text-muted-foreground" />}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-display truncate">{label}</p>
                        <p className="text-xs text-muted-foreground">{money(item.total, lang)} · {item.count}×</p>
                      </div>
                      <div className="flex gap-1 bg-background rounded-lg p-1 shrink-0">
                        <button
                          disabled={busy}
                          onClick={() => setOverride(item.keys, 'wealth')}
                          style={cls === 'wealth' ? { background: 'var(--xray-good-fg)', color: 'var(--primary-foreground)' } : undefined}
                          className={`px-3 py-1.5 rounded-md text-xs font-display transition-colors ${cls === 'wealth' ? '' : 'text-muted-foreground hover:bg-muted'}`}
                        >
                          {t('radiografia.results.isSaving')}
                        </button>
                        <button
                          disabled={busy}
                          onClick={() => setOverride(item.keys, 'consumption')}
                          className={`px-3 py-1.5 rounded-md text-xs font-display transition-colors ${cls === 'consumption' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}
                        >
                          {t('radiografia.results.isSpending')}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </Section>
        )}

        {/* 4.7 — Add another account (completes the picture, reconciles transfers) */}
        {sessionId && (
          <Section>
            <div className="bg-primary/5 border border-primary/15 rounded-3xl p-6 flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                <Wallet className="w-5 h-5 text-primary" />
              </div>
              <div className="flex-1">
                <p className="font-display">{t('radiografia.results.addAccountCta')}</p>
                <p className="text-sm text-muted-foreground mt-0.5">{t('radiografia.results.addAccountHint')}</p>
                {addError && <p className="text-sm text-destructive mt-1">{t('radiografia.errors.unrecognized_format')}</p>}
              </div>
              <input ref={addInputRef} type="file" accept=".csv,.xlsx,.xls" multiple className="hidden" onChange={e => { onAddFiles(e.target.files); e.target.value = ''; }} />
              <button
                onClick={() => addInputRef.current?.click()}
                disabled={adding}
                className="px-5 py-2.5 rounded-xl bg-primary text-primary-foreground font-display text-sm hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-2 shrink-0"
              >
                <Plus className="w-4 h-4" />
                {adding ? t('radiografia.results.adding') : t('radiografia.results.addAccountButton')}
              </button>
            </div>
          </Section>
        )}

        {/* 5 — Health index */}
        <motion.section
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.5 }}
          onViewportEnter={() => track('wow_reached', sessionId)}
          className="w-full max-w-3xl mx-auto"
        >
          <div
            className="text-center space-y-6 rounded-3xl p-8 md:p-12"
            style={{ background: 'var(--xray-film)', color: 'var(--xray-film-line)' }}
          >
            <XRayMark variant="negative" className="w-9 h-9 mx-auto opacity-90" />
            <h2 className="text-2xl font-display">{t('radiografia.results.healthTitle')}</h2>
            <ScoreRing score={health.score} />
            <div>
              <p className="text-xl font-display" style={{ color: 'var(--xray-film-gold)' }}>{t(`radiografia.archetype.${archetype.key}`)}</p>
                  <p className="text-sm mt-2 max-w-md mx-auto" style={{ color: 'var(--xray-film-muted)' }}>
                    {t(`radiografia.archetypeDesc.${archetype.key}`)}
                  </p>
                  {!archetype.givingAssessed && (
                    <p className="text-xs mt-3 max-w-md mx-auto" style={{ color: 'var(--xray-film-muted)' }}>
                      {t('radiografia.archetypeUnassessed')}
                    </p>
                  )}
              <p className="mt-1 max-w-md mx-auto" style={{ color: 'var(--xray-film-muted)' }}>
                {t('radiografia.results.strongest', { pillar: t(`radiografia.pillar.${health.strongestKey}`) })}
              </p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 max-w-2xl mx-auto pt-2">
              {health.pillars.map(p => (
                <div key={p.key} className="rounded-2xl p-3" style={{ background: 'var(--xray-film-card)', border: '1px solid var(--xray-film-border)' }}>
                  <p className="text-2xl font-display" style={{ color: scoreColor(p.score) }}>{p.score}</p>
                  <p className="text-xs mt-1" style={{ color: 'var(--xray-film-muted)' }}>{t(`radiografia.pillar.${p.key}`)}</p>
                </div>
              ))}
            </div>
            <button
              onClick={onShare}
              disabled={sharing}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl transition-colors text-sm font-display disabled:opacity-50 hover:bg-white/5"
              style={{ border: '1px solid var(--xray-film-border)', color: 'var(--xray-film-line)' }}
            >
              <Share2 className="w-4 h-4" />
              {t('radiografia.results.share')}
            </button>
            <p
              className="font-display italic text-base pt-6 mt-2 max-w-md mx-auto"
              style={{ borderTop: '1px solid var(--xray-film-border)', color: 'var(--xray-film-line)' }}
            >
              {t('radiografia.results.reflection')}
            </p>
          </div>
        </motion.section>

        {/* 6 — Opportunities */}
        {opportunities.length > 0 && (
          <Section>
            <h2 className="text-2xl font-display mb-1 flex items-center gap-2"><Lightbulb className="w-5 h-5 text-accent" />{t('radiografia.results.opportunitiesTitle')}</h2>
            <p className="text-muted-foreground mb-6">{t('radiografia.results.opportunitiesSubtitle')}</p>
            <div className="space-y-3">
              {opportunities.map(o => (
                <div key={o.id} className="bg-card border border-border rounded-2xl p-5 flex items-start gap-4">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                    <PiggyBank className="w-5 h-5 text-primary" />
                  </div>
                  <div className="flex-1">
                    <p className="font-display">{t(`radiografia.opportunity.${o.id}.title`, opportunityParams(o, lang))}</p>
                    <p className="text-sm text-muted-foreground mt-0.5">{t(`radiografia.opportunity.${o.id}.detail`, opportunityParams(o, lang))}</p>
                  </div>
                  {o.annualSaving > 0 && (
                    <span className="shrink-0 text-sm font-display text-accent whitespace-nowrap">
                      +{money(o.annualSaving, lang)}/{t('radiografia.results.year')}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* 7 — CTA to the full report */}
        <Section>
          <div className="bg-primary text-primary-foreground rounded-3xl p-10 text-center shadow-2xl relative overflow-hidden">
            <div className="absolute bottom-0 left-0 w-64 h-64 bg-white/5 rounded-full blur-3xl -ml-32 -mb-32" />
            <div className="relative z-10 space-y-5">
              <XRayMark variant="negative" className="w-10 h-10 mx-auto" />
              <h2 className="text-3xl font-display">{t('radiografia.results.ctaTitle')}</h2>
              <p className="opacity-90 max-w-md mx-auto">{t('radiografia.results.ctaSubtitle')}</p>
              <button
                onClick={onEmailCta}
                className="inline-flex items-center gap-2 px-8 py-4 rounded-xl bg-card text-primary font-display hover:scale-105 transition-transform"
              >
                {t('radiografia.results.ctaButton')}
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}

// Interpolation values available to opportunity copy.
function opportunityParams(o: { annualSaving: number; params: Record<string, number> }, lang: string) {
  const p: Record<string, string | number> = { ...o.params, saving: money(o.annualSaving, lang) };
  if (o.params.target !== undefined) p.target = money(o.params.target, lang);
  return p;
}

function scoreColor(score: number): string {
  if (score >= 70) return '#6FA37D';
  if (score >= 45) return '#D3B27A';
  return '#C97B65';
}

function ScoreRing({ score }: { score: number }) {
  const r = 76;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  return (
    <div className="relative w-52 h-52 mx-auto">
      <svg viewBox="0 0 180 180" className="w-full h-full -rotate-90">
        <circle cx="90" cy="90" r={r} fill="none" stroke="var(--xray-film-border)" strokeWidth="12" />
        <motion.circle
          cx="90" cy="90" r={r} fill="none" stroke={scoreColor(score)} strokeWidth="12" strokeLinecap="round"
          strokeDasharray={circ}
          initial={{ strokeDashoffset: circ }}
          whileInView={{ strokeDashoffset: circ - dash }}
          viewport={{ once: true }}
          transition={{ duration: 1.2, ease: 'easeOut' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-5xl font-display">{score}</span>
        <span className="text-sm" style={{ color: 'var(--xray-film-muted)' }}>/ 100</span>
      </div>
    </div>
  );
}
