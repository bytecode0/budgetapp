import { useTranslation } from 'react-i18next';
import { XRayMark } from '../XRayMark';
import { money } from '../format';
import {
  ActionCard, Badge, Eyebrow, Focus, Hero, HeroAside, MoneyRow, Panel, PanelTitle,
  SectionHead, StatCard, TargetBar, type Tone,
} from '../ui/primitives';

interface Allocation { pct: number; targetPct: number; deviation: number }

// The full report, as data. Shared by the permanent page at /informe/<token>
// and by the last step of the onboarding, which renders the very same thing
// inline — the report is the promised deliverable, so it must not sit behind a
// click, an email that may never arrive, or both.
export interface ReportData {
  stageId: string | null;
  stageName: string | null;
  stageDescription: string | null;
  headline: string;
  allocations: { giving: Allocation; essentials: Allocation; savingsAndInvestment: Allocation; enjoyment: Allocation };
  categories: { key: string; label: string; monthlyEur: number; annualEur: number; pct: number }[];
  antExpenses: { monthlyEur: number; annualEur: number; names: string[] } | null;
  recurring: { monthlyEur: number; annualEur: number; count: number; names: string[] } | null;
  debtPressure: { monthlyEur: number; pctOfIncome: number; alarming: boolean } | null;
  nextSteps: { title: string; detail: string; annualSaving: number }[];
  archetype: { key: string; label: string; description: string; givingAssessed: boolean } | null;
}

interface Props {
  report: ReportData;
  // `embedded` is the onboarding's last step, where the report is rendered
  // under a confirmation block that already carries the page chrome: no
  // min-h-screen (it would append an empty viewport) and no topbar.
  embedded?: boolean;
}

// Spending more than the target on essentials is the problem; spending less
// than the target on the other three is. One helper each, rather than a single
// signed rule that reads correctly for one of the four and backwards for the
// rest.
function toneOver(a: Allocation): Tone {
  if (a.deviation > 10) return 'bad';
  if (a.deviation > 0) return 'warn';
  return 'good';
}
function toneUnder(a: Allocation): Tone {
  if (a.deviation < -10) return 'bad';
  if (a.deviation < 0) return 'warn';
  return 'good';
}

export function ReportView({ report, embedded = false }: Props) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;

  const allocationRows = [
    { key: 'giving' as const, label: t('radiografia.report.allocGiving'), tone: toneUnder(report.allocations.giving) },
    { key: 'essentials' as const, label: t('radiografia.report.allocEssentials'), tone: toneOver(report.allocations.essentials) },
    { key: 'savingsAndInvestment' as const, label: t('radiografia.report.allocSavings'), tone: toneUnder(report.allocations.savingsAndInvestment) },
    { key: 'enjoyment' as const, label: t('radiografia.report.allocEnjoyment'), tone: toneUnder(report.allocations.enjoyment) },
  ];

  // The four opening figures. `recurring`, `antExpenses` and `debtPressure` are
  // all null for a statement where nothing of the sort was detected, so this is
  // a priority list rather than a fixed layout: the four allocations at the end
  // always exist, which is what guarantees four cards and never a hole or a
  // meaningless "0 €".
  const targetNote = (a: Allocation) => t('radiografia.report.statTargetNote', { target: a.targetPct });
  const stats = [
    {
      label: t('radiografia.report.allocEssentials'),
      value: `${report.allocations.essentials.pct}%`,
      note: targetNote(report.allocations.essentials),
      tone: toneOver(report.allocations.essentials),
    },
    {
      label: t('radiografia.report.allocSavings'),
      value: `${report.allocations.savingsAndInvestment.pct}%`,
      note: targetNote(report.allocations.savingsAndInvestment),
      tone: toneUnder(report.allocations.savingsAndInvestment),
    },
    ...(report.recurring ? [{
      label: t('radiografia.report.subscriptionsLabel'),
      value: money(report.recurring.annualEur, lang),
      note: t('radiografia.report.statSubsNote', { count: report.recurring.count }),
      tone: 'warn' as Tone,
    }] : []),
    ...(report.debtPressure ? [{
      label: t('radiografia.report.debtTitle'),
      value: `${report.debtPressure.pctOfIncome}%`,
      note: t('radiografia.report.statDebtNote'),
      tone: (report.debtPressure.alarming ? 'bad' : 'info') as Tone,
    }] : []),
    ...(report.antExpenses ? [{
      label: t('radiografia.report.antTitle'),
      value: money(report.antExpenses.annualEur, lang),
      note: t('radiografia.report.statAntNote'),
      tone: 'warn' as Tone,
    }] : []),
    {
      label: t('radiografia.report.allocGiving'),
      value: `${report.allocations.giving.pct}%`,
      note: targetNote(report.allocations.giving),
      tone: toneUnder(report.allocations.giving),
    },
    {
      label: t('radiografia.report.allocEnjoyment'),
      value: `${report.allocations.enjoyment.pct}%`,
      note: targetNote(report.allocations.enjoyment),
      tone: toneUnder(report.allocations.enjoyment),
    },
  ].slice(0, 4);

  // Bars are drawn relative to the biggest category, not to 100%: at 48% the
  // largest slice would otherwise fill less than half its track and the whole
  // list would read as empty.
  const maxCategory = Math.max(...report.categories.map(c => c.monthlyEur), 0);
  const hasLever = !!(report.recurring || report.antExpenses);

  return (
    <div className={embedded ? 'w-full' : 'xray-scope min-h-screen'}>
      <div className={`max-w-[1180px] mx-auto space-y-9 ${embedded ? '' : 'px-4 md:px-7 py-7'}`}>
        {!embedded && (
          <div className="flex items-center justify-between gap-5 no-print">
            <div className="flex items-center gap-3">
              <XRayMark className="w-9 h-9" />
              <span className="text-[13px] font-bold uppercase" style={{ letterSpacing: '0.14em', color: 'var(--primary)' }}>
                {t('radiografia.report.badge')}
              </span>
            </div>
            <button
              onClick={() => window.print()}
              className="rounded-xl border px-3.5 py-2.5 text-sm font-semibold transition-colors hover:bg-muted"
              style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
            >
              {t('radiografia.report.savePdf')}
            </button>
          </div>
        )}

        <Hero
          kicker={t('radiografia.report.heroKicker')}
          title={report.headline}
          intro={report.stageDescription ?? undefined}
          aside={report.stageName
            ? <HeroAside label={t('radiografia.report.stageBadge')} title={report.stageName} />
            : undefined}
        />

        <section>
          <SectionHead
            eyebrow={t('radiografia.report.statsEyebrow')}
            title={t('radiografia.report.statsTitle')}
            intro={t('radiografia.report.statsIntro')}
          />
          <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
            {stats.map(s => <StatCard key={s.label} {...s} />)}
          </div>
        </section>

        <section>
          <SectionHead
            eyebrow={t('radiografia.report.readingEyebrow')}
            title={t('radiografia.report.allocationsTitle')}
            intro={t('radiografia.report.readingIntro')}
          />
          <Panel>
            {allocationRows.map(({ key, label }) => (
              <TargetBar
                key={key}
                label={label}
                pct={report.allocations[key].pct}
                targetPct={report.allocations[key].targetPct}
                deviation={report.allocations[key].deviation}
                deviationLabel={t('radiografia.report.currentSituation')}
              />
            ))}
          </Panel>
        </section>

        {(report.categories.length > 0 || hasLever) && (
          <section>
            <SectionHead
              eyebrow={t('radiografia.report.categoriesEyebrow')}
              title={t('radiografia.report.categoriesTitle')}
              intro={t('radiografia.report.categoriesIntro')}
            />
            <div className={`grid gap-4 ${report.categories.length > 0 && hasLever ? 'lg:grid-cols-[1.15fr_0.85fr]' : ''}`}>
              {report.categories.length > 0 && (
                <Panel>
                  <PanelTitle title={t('radiografia.report.categoriesPanelTitle')} sub={t('radiografia.report.categoriesPanelSub')} />
                  <div className="grid gap-3.5">
                    {report.categories.map(c => (
                      <MoneyRow
                        key={c.key}
                        label={c.label}
                        fraction={maxCategory > 0 ? c.monthlyEur / maxCategory : 0}
                        value={`${c.pct}%`}
                      />
                    ))}
                  </div>
                </Panel>
              )}

              {hasLever && (
                <Panel>
                  <Badge>{t('radiografia.report.leverBadge')}</Badge>
                  <div className="mt-3">
                    <PanelTitle title={t('radiografia.report.leverTitle')} sub={t('radiografia.report.leverIntro')} />
                  </div>
                  {report.recurring && (
                    <Focus
                      label={t('radiografia.report.subscriptionsLabel')}
                      value={`${money(report.recurring.annualEur, lang)}${t('radiografia.report.perYear')}`}
                      // The merchant names, when they were captured. Absent on a
                      // report built before consent existed — hence the fallback
                      // to the plain count rather than an empty line.
                      detail={report.recurring.names.length > 0
                        ? report.recurring.names.join(' · ')
                        : t('radiografia.report.recurringTitle', { count: report.recurring.count })}
                    />
                  )}
                  {report.antExpenses && (
                    <Focus
                      label={t('radiografia.report.antTitle')}
                      value={`${money(report.antExpenses.annualEur, lang)}${t('radiografia.report.perYear')}`}
                      detail={report.antExpenses.names.length > 0
                        ? report.antExpenses.names.join(' · ')
                        : t('radiografia.report.antDetected')}
                    />
                  )}
                </Panel>
              )}
            </div>
          </section>
        )}

        {report.nextSteps.length > 0 && (
          <section>
            <SectionHead
              eyebrow={t('radiografia.report.nextStepsEyebrow')}
              title={t('radiografia.report.nextStepsTitle')}
              intro={t('radiografia.report.nextStepsIntro')}
            />
            <div className="grid gap-4 md:grid-cols-3">
              {report.nextSteps.map((s, i) => (
                <ActionCard
                  key={s.title}
                  index={i + 1}
                  title={s.title}
                  detail={s.detail}
                  impact={s.annualSaving > 0 ? t('radiografia.report.impact', { amount: money(s.annualSaving, lang) }) : undefined}
                />
              ))}
            </div>
          </section>
        )}

        {report.archetype && (
          <section>
            <Panel dark>
              <Eyebrow color="rgba(255,255,255,0.75)">{t('radiografia.report.archetypeEyebrow')}</Eyebrow>
              <h2 className="font-display text-3xl mt-1.5">{report.archetype.label}</h2>
              <p className="max-w-3xl text-[15px] text-white/80 mt-2">{report.archetype.description}</p>
              <div className="flex flex-wrap gap-2.5 mt-5">
                {report.stageName && (
                  <span className="rounded-full bg-white/10 px-3 py-2 text-xs">{t('radiografia.report.chipStage', { stage: report.stageName })}</span>
                )}
                {report.debtPressure && (
                  <span className="rounded-full bg-white/10 px-3 py-2 text-xs">{t('radiografia.report.chipDebt', { pct: report.debtPressure.pctOfIncome })}</span>
                )}
              </div>
            </Panel>
          </section>
        )}

        <div className="flex flex-wrap justify-between gap-4 border-t pt-6 pb-2 text-xs text-muted-foreground" style={{ borderColor: 'var(--border)' }}>
          <p><strong className="text-foreground">{t('radiografia.report.badge')}</strong><br />{t('radiografia.report.footerNote')}</p>
        </div>
      </div>
    </div>
  );
}
