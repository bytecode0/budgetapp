import { useState } from 'react';
import { X, Plus, Trash2, Loader2, Wand2, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { useRules } from '../hooks/useRules';
import { useAllocations } from '../hooks/useAllocations';

interface RulesManagerProps {
  isOpen: boolean;
  onClose: () => void;
}

const MATCH_TYPES = ['contains', 'equals', 'regex'] as const;

export function RulesManager({ isOpen, onClose }: RulesManagerProps) {
  const { t } = useTranslation();
  const { rules, loading, createRule, updateRule, deleteRule } = useRules();
  const { allocations } = useAllocations();

  const [matchType, setMatchType] = useState<string>('contains');
  const [pattern, setPattern] = useState('');
  const [allocationId, setAllocationId] = useState('');
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!pattern.trim()) { toast.error(t('rules.patternRequired')); return; }
    if (!allocationId) { toast.error(t('rules.categoryRequired')); return; }
    setCreating(true);
    const result = await createRule({ matchType, pattern: pattern.trim(), allocationId });
    setCreating(false);
    if ('error' in result) { toast.error(result.error as string); return; }
    toast.success(t('rules.created'));
    setPattern('');
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    const result = await deleteRule(id);
    setDeletingId(null);
    if ('error' in result) toast.error(result.error as string);
    else toast.success(t('rules.deleted'));
  };

  const handleReassign = async (id: string, newAllocationId: string) => {
    const result = await updateRule(id, { allocationId: newAllocationId });
    if ('error' in result) toast.error(result.error as string);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-black/50 flex items-end md:items-center justify-center p-4"
          onClick={e => { if (e.target === e.currentTarget) onClose(); }}
        >
          <motion.div
            initial={{ opacity: 0, y: 40, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 40, scale: 0.95 }}
            className="bg-card border border-border rounded-2xl p-6 w-full max-w-lg space-y-5 max-h-[85vh] overflow-y-auto"
          >
            {/* Header */}
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gradient-to-br from-primary to-secondary rounded-xl flex items-center justify-center text-white">
                  <Wand2 className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-xl font-display">{t('rules.title')}</h2>
                  <p className="text-sm text-muted-foreground">{t('rules.subtitle')}</p>
                </div>
              </div>
              <button onClick={onClose} className="w-8 h-8 flex items-center justify-center hover:bg-muted rounded-lg transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Create form */}
            <div className="bg-muted/40 border border-border rounded-2xl p-4 space-y-3">
              <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">{t('rules.newRule')}</p>
              <div className="flex gap-2">
                <select
                  value={matchType}
                  onChange={e => setMatchType(e.target.value)}
                  className="border border-border rounded-xl px-3 py-2.5 bg-background outline-none focus:border-primary text-sm shrink-0"
                >
                  {MATCH_TYPES.map(mt => <option key={mt} value={mt}>{t(`rules.match.${mt}`)}</option>)}
                </select>
                <input
                  value={pattern}
                  onChange={e => setPattern(e.target.value)}
                  placeholder={t('rules.patternPlaceholder')}
                  className="flex-1 min-w-0 border border-border rounded-xl px-4 py-2.5 bg-background outline-none focus:border-primary text-sm"
                />
              </div>
              <div className="flex gap-2">
                <select
                  value={allocationId}
                  onChange={e => setAllocationId(e.target.value)}
                  className="flex-1 border border-border rounded-xl px-3 py-2.5 bg-background outline-none focus:border-primary text-sm"
                >
                  <option value="">{t('rules.chooseCategory')}</option>
                  {allocations.map(a => <option key={a.id} value={a.id}>{a.icon} {a.name}</option>)}
                </select>
                <button
                  onClick={handleCreate}
                  disabled={creating}
                  className="px-4 py-2.5 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors flex items-center gap-2 text-sm disabled:opacity-50 shrink-0"
                >
                  {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  {t('rules.add')}
                </button>
              </div>
            </div>

            {/* Rules list */}
            {loading ? (
              <div className="flex items-center justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
            ) : rules.length === 0 ? (
              <div className="text-center py-10 space-y-3">
                <div className="w-14 h-14 bg-muted rounded-2xl flex items-center justify-center mx-auto">
                  <Wand2 className="w-7 h-7 text-muted-foreground" />
                </div>
                <p className="font-display">{t('rules.emptyTitle')}</p>
                <p className="text-sm text-muted-foreground">{t('rules.emptyDesc')}</p>
              </div>
            ) : (
              <div className="space-y-2">
                {rules.map(rule => (
                  <div key={rule.id} className="flex items-center gap-2 bg-card border border-border rounded-xl p-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{t(`rules.match.${rule.matchType}`)}</span>
                        <span className="text-sm font-medium truncate">"{rule.pattern}"</span>
                        {rule.source === 'learned' && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-secondary/10 text-secondary flex items-center gap-1">
                            <Sparkles className="w-3 h-3" /> {t('rules.learned')}
                          </span>
                        )}
                      </div>
                    </div>
                    <select
                      value={rule.allocationId}
                      onChange={e => handleReassign(rule.id, e.target.value)}
                      className="border border-border rounded-lg px-2 py-1.5 bg-background outline-none focus:border-primary text-sm max-w-[40%]"
                    >
                      {allocations.map(a => <option key={a.id} value={a.id}>{a.icon} {a.name}</option>)}
                    </select>
                    <button
                      onClick={() => handleDelete(rule.id)}
                      disabled={deletingId === rule.id}
                      className="w-8 h-8 flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg transition-colors disabled:opacity-50 shrink-0"
                    >
                      {deletingId === rule.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
