import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Loader2, Landmark, Search } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { apiErrorMessage } from '../../lib/apiErrors';
import type { BankInstitution, BankResult } from '../../hooks/useBanking';

interface BankPickerProps {
  open: boolean;
  onClose: () => void;
  fetchInstitutions: (country?: string) => Promise<BankResult<{ institutions: BankInstitution[] }>>;
  /** Consent is being started: the browser is about to leave for the bank. */
  connecting: boolean;
  onChoose: (institution: { name: string; country: string }) => void;
}

/** "Choose your bank": the same sheet in Accounts and Activity. */
export function BankPicker({ open, onClose, fetchInstitutions, connecting, onChoose }: BankPickerProps) {
  const { t } = useTranslation();
  const [institutions, setInstitutions] = useState<BankInstitution[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!open) return;
    setSearch('');
    setLoading(true);
    fetchInstitutions('ES').then(res => {
      setLoading(false);
      if (!res.ok) { toast.error(apiErrorMessage(t, { code: res.code, error: t('banking.errors.institutionsFailed') })); return; }
      setInstitutions(res.institutions);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const filtered = institutions.filter(i => i.name.toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-black/50 flex items-end md:items-center justify-center p-4"
          onClick={e => { if (e.target === e.currentTarget && !connecting) onClose(); }}
        >
          <motion.div
            initial={{ opacity: 0, y: 40, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 40, scale: 0.95 }}
            className="bg-card border border-border rounded-2xl p-6 w-full max-w-md space-y-4 max-h-[80vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-display">{t('banking.chooseBankTitle')}</h2>
              <button onClick={onClose} disabled={connecting} aria-label={t('banking.close')} className="p-2 rounded-lg hover:bg-muted transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-muted-foreground">{t('banking.chooseBankHint')}</p>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={t('banking.searchBank')}
                className="w-full pl-10 pr-4 py-3 border border-border rounded-xl bg-background outline-none focus:border-primary text-sm"
              />
            </div>
            {loading ? (
              <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
            ) : (
              <div className="space-y-2">
                {filtered.map(inst => (
                  <button
                    key={`${inst.country}:${inst.name}`}
                    onClick={() => onChoose({ name: inst.name, country: inst.country })}
                    disabled={connecting}
                    className="w-full flex items-center gap-3 p-3 rounded-xl border border-border hover:border-primary/40 hover:bg-muted/50 transition-colors text-left disabled:opacity-50"
                  >
                    {inst.logo ? (
                      <img src={inst.logo} alt="" className="w-8 h-8 rounded-lg object-contain shrink-0" />
                    ) : (
                      <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0"><Landmark className="w-4 h-4 text-muted-foreground" /></div>
                    )}
                    <span className="text-sm font-display truncate">{inst.name}</span>
                  </button>
                ))}
                {filtered.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">{t('banking.noInstitutions')}</p>
                )}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
