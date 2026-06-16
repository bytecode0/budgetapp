import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Users, Loader2 } from 'lucide-react';
import { useHousehold, type FinancialModel, type VisibilityTier } from '../hooks/useHousehold';

// Household settings panel (Epic H1 UI). Shown inside Shared Finances when the
// user belongs to a household. Surfaces members + lets the owner pick the
// financial model and privacy tier. Enforcement of model (H3/H4) and privacy
// (H5) lands in later phases; this persists the household's configuration.
export function HouseholdPanel() {
  const { t } = useTranslation();
  const { household, loading, updateHousehold } = useHousehold();

  if (loading) {
    return <div className="flex justify-center py-3"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>;
  }
  if (!household) return null;

  const isOwner = household.members.some(m => m.role === 'owner');

  const setModel = async (financialModel: FinancialModel) => {
    if (financialModel === household.financialModel) return;
    const res = await updateHousehold({ financialModel });
    if (res.error) toast.error(res.error); else toast.success(t('household.updated'));
  };
  const setTier = async (visibilityTier: VisibilityTier) => {
    if (visibilityTier === household.visibilityTier) return;
    const res = await updateHousehold({ visibilityTier });
    if (res.error) toast.error(res.error); else toast.success(t('household.updated'));
  };

  const models: { id: FinancialModel; label: string; desc: string }[] = [
    { id: 'individual', label: t('household.modelIndividual'), desc: t('household.modelIndividualDesc') },
    { id: 'proportional', label: t('household.modelProportional'), desc: t('household.modelProportionalDesc') },
    { id: 'shared', label: t('household.modelShared'), desc: t('household.modelSharedDesc') },
  ];
  const tiers: { id: VisibilityTier; label: string; desc: string }[] = [
    { id: 'transparent', label: t('household.privacyTransparent'), desc: t('household.privacyTransparentDesc') },
    { id: 'shared_stats', label: t('household.privacyStats'), desc: t('household.privacyStatsDesc') },
  ];

  return (
    <div className="space-y-5 p-4 border border-border rounded-xl bg-muted/20">
      {/* Header + members */}
      <div className="flex items-center gap-2">
        <Users className="w-4 h-4 text-primary" />
        <p className="text-sm font-medium">{household.name}</p>
      </div>
      <div className="space-y-1.5">
        {household.members.map(m => (
          <div key={m.userId} className="flex items-center justify-between text-sm">
            <span className="truncate">{m.name ?? m.email ?? '—'}</span>
            <span className="text-xs text-muted-foreground capitalize">
              {m.role === 'owner' ? t('household.owner') : t('household.member')}
            </span>
          </div>
        ))}
      </div>

      {/* Financial model */}
      <div className="space-y-2">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{t('household.model')}</p>
        <div className="grid grid-cols-3 gap-2">
          {models.map(opt => (
            <button
              key={opt.id}
              onClick={() => isOwner && setModel(opt.id)}
              disabled={!isOwner}
              className={`p-2.5 rounded-xl border-2 text-left transition-all disabled:opacity-60 disabled:cursor-not-allowed ${
                household.financialModel === opt.id ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'
              }`}
            >
              <p className="text-sm font-medium">{opt.label}</p>
              <p className="text-[11px] text-muted-foreground leading-tight mt-0.5">{opt.desc}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Privacy tier */}
      <div className="space-y-2">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{t('household.privacy')}</p>
        <div className="space-y-2">
          {tiers.map(opt => (
            <button
              key={opt.id}
              onClick={() => isOwner && setTier(opt.id)}
              disabled={!isOwner}
              className={`w-full p-2.5 rounded-xl border-2 text-left transition-all disabled:opacity-60 disabled:cursor-not-allowed ${
                household.visibilityTier === opt.id ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'
              }`}
            >
              <p className="text-sm font-medium">{opt.label}</p>
              <p className="text-[11px] text-muted-foreground leading-tight mt-0.5">{opt.desc}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
