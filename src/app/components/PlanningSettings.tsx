import { User, Bell, Moon, Sun, Shield, HelpCircle, LogOut, ChevronRight, Wallet, Heart, Send, X, Loader2, CheckCircle2, AlertTriangle, Link2Off, Globe, Crown, Zap, CreditCard } from 'lucide-react';
import { motion } from 'motion/react';
import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { usePlans } from '../hooks/usePlans';
import { usePartner } from '../hooks/usePartner';
import { HouseholdPanel } from './HouseholdPanel';
import { useLanguage } from '../context/LanguageContext';
import {
  createCheckoutSession,
  confirmSession,
  getBillingInfo,
  cancelSubscription,
  reactivateSubscription,
  type BillingInfo,
} from '../../api/stripe';

export function PlanningSettings({ darkMode, onToggleDarkMode, onLanguageChange, onLogout }: { darkMode: boolean; onToggleDarkMode: () => void; onLanguageChange?: (lang: string) => void; onLogout?: () => void }) {
  const { t } = useTranslation();
  const { user, refreshUser } = useAuth();
  const { plans } = usePlans();
  const activePlans = plans.length;
  const { language, setLanguage } = useLanguage();

  const { status: partnerStatus, loading: partnerLoading, sendInvite, cancelInvite, unlink } = usePartner();
  const [inviteEmail, setInviteEmail] = useState('');
  const [sendingInvite, setSendingInvite] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Billing state
  const [billingInfo, setBillingInfo] = useState<BillingInfo | null>(null);
  const [billingLoading, setBillingLoading] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [reactivateLoading, setReactivateLoading] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [upgradeLoading, setUpgradeLoading] = useState(false);

  useEffect(() => {
    // Handle post-checkout redirect: ?session_id=xxx
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get('session_id');
    if (sessionId) {
      const url = new URL(window.location.href);
      url.searchParams.delete('session_id');
      window.history.replaceState({}, '', url.toString());
      confirmSession(sessionId)
        .then((info) => {
          setBillingInfo(info);
          refreshUser();
          toast.success(t('billing.planActivated'));
        })
        .catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (user?.plan === 'premium') {
      setBillingLoading(true);
      getBillingInfo()
        .then(setBillingInfo)
        .finally(() => setBillingLoading(false));
    }
  }, [user?.plan]);

  const handleUpgrade = async () => {
    setUpgradeLoading(true);
    try {
      const { url } = await createCheckoutSession();
      window.location.href = url;
    } catch {
      setUpgradeLoading(false);
    }
  };

  const handleCancel = async () => {
    if (!confirmCancel) { setConfirmCancel(true); return; }
    setCancelLoading(true);
    try {
      const info = await cancelSubscription();
      setBillingInfo(info);
      refreshUser();
      toast.success(t('billing.cancelSuccess'));
    } catch {
      toast.error('Failed to cancel subscription');
    } finally {
      setCancelLoading(false);
      setConfirmCancel(false);
    }
  };

  const handleReactivate = async () => {
    setReactivateLoading(true);
    try {
      const info = await reactivateSubscription();
      setBillingInfo(info);
      refreshUser();
      toast.success(t('billing.reactivateSuccess'));
    } catch {
      toast.error('Failed to reactivate subscription');
    } finally {
      setReactivateLoading(false);
    }
  };

  const handleSendInvite = async () => {
    if (!inviteEmail.trim()) return;
    setSendingInvite(true);
    setFallbackUrl(null);
    const result = await sendInvite(inviteEmail.trim());
    setSendingInvite(false);
    if (result.error) {
      toast.error(result.error);
    } else if (result.warning && result.acceptUrl) {
      setInviteEmail('');
      setFallbackUrl(result.acceptUrl);
      toast.warning(t('toast.inviteFallback'));
    } else {
      toast.success(t('toast.inviteSent'));
      setInviteEmail('');
    }
  };

  const handleCopyUrl = async () => {
    if (!fallbackUrl) return;
    await navigator.clipboard.writeText(fallbackUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCancelInvite = async () => {
    const result = await cancelInvite();
    if (result.error) toast.error(result.error);
    else toast.success(t('toast.inviteCancelled'));
  };

  const handleUnlink = async () => {
    if (!confirmUnlink) { setConfirmUnlink(true); return; }
    setUnlinking(true);
    const result = await unlink();
    setUnlinking(false);
    setConfirmUnlink(false);
    if (result.error) toast.error(result.error);
    else toast.success(t('toast.accountsUnlinked'));
  };

  const [notifications, setNotifications] = useState({
    planMilestones: true,
    monthlyReminders: true,
    budgetAlerts: true,
    smartInsights: true,
  });

  const handleToggle = (key: string) => {
    setNotifications(prev => ({ ...prev, [key]: !prev[key as keyof typeof prev] }));
  };

  const initials = user?.name
    ? user.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
    : '?';

  return (
    <div className="space-y-6 pb-8">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-2"
      >
        <h1 className="text-4xl tracking-tight">{t('settings.title')}</h1>
        <p className="text-muted-foreground">{t('settings.subtitle')}</p>
      </motion.div>

      {/* Profile Card */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="bg-gradient-to-br from-primary to-primary/90 text-primary-foreground rounded-3xl p-8 shadow-2xl relative overflow-hidden"
      >
        <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full blur-3xl -mr-32 -mt-32" />

        <div className="relative z-10 flex items-center gap-6">
          <div className="w-20 h-20 bg-white/20 rounded-full flex items-center justify-center backdrop-blur-sm shrink-0">
            {user?.image ? (
              <img src={user.image} alt={user.name ?? ''} className="w-full h-full rounded-full object-cover" />
            ) : (
              <span className="text-2xl font-display">{initials}</span>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-2xl font-display mb-1 truncate">{user?.name ?? '—'}</h2>
            <p className="text-sm opacity-90 mb-3 truncate">{user?.email ?? '—'}</p>
            <div className="flex items-center gap-4 text-sm flex-wrap">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-secondary rounded-full" />
                <span className="opacity-90 capitalize">{user?.plan ?? 'Free'} Plan</span>
              </div>
              <span className="opacity-60">•</span>
              <span className="opacity-90">
                {t('settings.profile.activePlans', { count: activePlans })}
              </span>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Financial Preferences */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="bg-card border border-border rounded-2xl overflow-hidden"
      >
        <div className="px-6 py-4 border-b border-border">
          <h3 className="text-sm uppercase tracking-wide text-muted-foreground">{t('settings.financial.sectionTitle')}</h3>
        </div>
        <div className="divide-y divide-border">
          <div className="p-5 hover:bg-muted/30 transition-colors cursor-pointer">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                  <Wallet className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="font-display">{t('settings.financial.monthlyIncome')}</p>
                  <p className="text-sm text-muted-foreground">{t('settings.financial.monthlyIncomeSubtitle')}</p>
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-muted-foreground" />
            </div>
          </div>
          <div className="p-5 hover:bg-muted/30 transition-colors cursor-pointer">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-secondary/10 rounded-lg flex items-center justify-center">
                  <User className="w-5 h-5 text-secondary" />
                </div>
                <div>
                  <p className="font-display">{t('settings.financial.riskProfile')}</p>
                  <p className="text-sm text-muted-foreground">{t('settings.financial.riskProfileSubtitle')}</p>
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-muted-foreground" />
            </div>
          </div>
        </div>
      </motion.div>

      {/* Appearance */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="bg-card border border-border rounded-2xl p-6 space-y-4"
      >
        <h3 className="text-sm uppercase tracking-wide text-muted-foreground">{t('settings.appearance.sectionTitle')}</h3>

        {/* Dark Mode Toggle */}
        <div className="flex items-center justify-between p-4 bg-muted/30 rounded-xl">
          <div className="flex items-center gap-3">
            {darkMode ? (
              <Moon className="w-5 h-5 text-primary" />
            ) : (
              <Sun className="w-5 h-5 text-accent" />
            )}
            <div>
              <p className="font-display">{t('settings.appearance.darkMode')}</p>
              <p className="text-sm text-muted-foreground">
                {darkMode ? t('settings.appearance.darkModeOn') : t('settings.appearance.darkModeOff')}
              </p>
            </div>
          </div>
          <button
            onClick={onToggleDarkMode}
            className={`relative w-14 h-7 rounded-full transition-colors ${
              darkMode ? 'bg-primary' : 'bg-muted'
            }`}
          >
            <motion.div
              animate={{ x: darkMode ? 28 : 2 }}
              transition={{ type: 'spring', stiffness: 500, damping: 30 }}
              className="absolute top-1 w-5 h-5 bg-white rounded-full shadow-md"
            />
          </button>
        </div>

        {/* Language Selector */}
        <div className="flex items-center justify-between p-4 bg-muted/30 rounded-xl">
          <div className="flex items-center gap-3">
            <Globe className="w-5 h-5 text-primary" />
            <div>
              <p className="font-display">{t('settings.appearance.language')}</p>
              <p className="text-sm text-muted-foreground">{t('settings.appearance.languageSubtitle')}</p>
            </div>
          </div>
          <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
            <button
              onClick={() => { setLanguage('en'); onLanguageChange?.('en'); }}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                language === 'en'
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              EN
            </button>
            <button
              onClick={() => { setLanguage('es'); onLanguageChange?.('es'); }}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                language === 'es'
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              ES
            </button>
          </div>
        </div>
      </motion.div>

      {/* Notifications */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        className="bg-card border border-border rounded-2xl overflow-hidden"
      >
        <div className="px-6 py-4 border-b border-border">
          <h3 className="text-sm uppercase tracking-wide text-muted-foreground">{t('settings.notifications.sectionTitle')}</h3>
        </div>
        <div className="divide-y divide-border">
          <div className="p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                  <Bell className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="font-display">{t('settings.notifications.planMilestones')}</p>
                  <p className="text-sm text-muted-foreground">{t('settings.notifications.planMilestonesSubtitle')}</p>
                </div>
              </div>
              <button
                onClick={() => handleToggle('planMilestones')}
                className={`relative w-14 h-7 rounded-full transition-colors ${
                  notifications.planMilestones ? 'bg-primary' : 'bg-muted'
                }`}
              >
                <motion.div
                  animate={{ x: notifications.planMilestones ? 28 : 2 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                  className="absolute top-1 w-5 h-5 bg-white rounded-full shadow-md"
                />
              </button>
            </div>
          </div>
          <div className="p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-secondary/10 rounded-lg flex items-center justify-center">
                  <Bell className="w-5 h-5 text-secondary" />
                </div>
                <div>
                  <p className="font-display">{t('settings.notifications.monthlyReminders')}</p>
                  <p className="text-sm text-muted-foreground">{t('settings.notifications.monthlyRemindersSubtitle')}</p>
                </div>
              </div>
              <button
                onClick={() => handleToggle('monthlyReminders')}
                className={`relative w-14 h-7 rounded-full transition-colors ${
                  notifications.monthlyReminders ? 'bg-primary' : 'bg-muted'
                }`}
              >
                <motion.div
                  animate={{ x: notifications.monthlyReminders ? 28 : 2 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                  className="absolute top-1 w-5 h-5 bg-white rounded-full shadow-md"
                />
              </button>
            </div>
          </div>
          <div className="p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-accent/10 rounded-lg flex items-center justify-center">
                  <Bell className="w-5 h-5 text-accent" />
                </div>
                <div>
                  <p className="font-display">{t('settings.notifications.smartInsights')}</p>
                  <p className="text-sm text-muted-foreground">{t('settings.notifications.smartInsightsSubtitle')}</p>
                </div>
              </div>
              <button
                onClick={() => handleToggle('smartInsights')}
                className={`relative w-14 h-7 rounded-full transition-colors ${
                  notifications.smartInsights ? 'bg-primary' : 'bg-muted'
                }`}
              >
                <motion.div
                  animate={{ x: notifications.smartInsights ? 28 : 2 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                  className="absolute top-1 w-5 h-5 bg-white rounded-full shadow-md"
                />
              </button>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Support & Legal */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
        className="bg-card border border-border rounded-2xl overflow-hidden"
      >
        <div className="px-6 py-4 border-b border-border">
          <h3 className="text-sm uppercase tracking-wide text-muted-foreground">{t('settings.support.sectionTitle')}</h3>
        </div>
        <div className="divide-y divide-border">
          <div className="p-5 hover:bg-muted/30 transition-colors cursor-pointer">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                  <HelpCircle className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="font-display">{t('settings.support.helpCenter')}</p>
                  <p className="text-sm text-muted-foreground">{t('settings.support.helpCenterSubtitle')}</p>
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-muted-foreground" />
            </div>
          </div>
          <div className="p-5 hover:bg-muted/30 transition-colors cursor-pointer">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-secondary/10 rounded-lg flex items-center justify-center">
                  <Shield className="w-5 h-5 text-secondary" />
                </div>
                <div>
                  <p className="font-display">{t('settings.support.privacy')}</p>
                  <p className="text-sm text-muted-foreground">{t('settings.support.privacySubtitle')}</p>
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-muted-foreground" />
            </div>
          </div>
        </div>
      </motion.div>

      {/* Shared Finances */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.55 }}
        className="bg-card border border-border rounded-2xl overflow-hidden"
      >
        <div className="px-6 py-4 border-b border-border flex items-center gap-2">
          <Heart className="w-4 h-4 text-pink-500" />
          <h3 className="text-sm uppercase tracking-wide text-muted-foreground">{t('settings.sharedFinances.sectionTitle')}</h3>
        </div>

        <div className="p-6 space-y-4">
          {/* Household settings (Epic H1) — shown when the user belongs to a household */}
          <HouseholdPanel />

          {partnerLoading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : partnerStatus?.state === 'linked_secondary' ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-4 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 rounded-xl">
                <div className="w-10 h-10 bg-emerald-100 dark:bg-emerald-950/40 rounded-full flex items-center justify-center shrink-0">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                </div>
                <div className="min-w-0">
                  <p className="font-medium text-sm">{t('settings.sharedFinances.linkedTo', { name: partnerStatus.linkedTo?.name })}</p>
                  <p className="text-xs text-muted-foreground truncate">{partnerStatus.linkedTo?.email}</p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">{t('settings.sharedFinances.viewingShared')}</p>
              <button
                onClick={handleUnlink}
                disabled={unlinking}
                className={`w-full py-2.5 rounded-xl border text-sm flex items-center justify-center gap-2 transition-colors ${
                  confirmUnlink
                    ? 'border-red-300 bg-red-50 text-red-600 dark:bg-red-950/20 dark:border-red-800'
                    : 'border-border hover:bg-muted text-muted-foreground'
                }`}
              >
                {unlinking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2Off className="w-4 h-4" />}
                {confirmUnlink ? t('settings.sharedFinances.confirmUnlink') : t('settings.sharedFinances.unlinkAccount')}
              </button>
            </div>
          ) : partnerStatus?.state === 'linked_primary' ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-4 bg-violet-50 dark:bg-violet-950/20 border border-violet-200 dark:border-violet-800 rounded-xl">
                <div className="w-10 h-10 bg-violet-100 dark:bg-violet-950/40 rounded-full flex items-center justify-center shrink-0">
                  <Heart className="w-5 h-5 text-violet-600" />
                </div>
                <div className="min-w-0">
                  <p className="font-medium text-sm">{t('settings.sharedFinances.partnerLinked', { name: partnerStatus.linkedPartner?.name })}</p>
                  <p className="text-xs text-muted-foreground truncate">{partnerStatus.linkedPartner?.email}</p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">{t('settings.sharedFinances.primaryAccount')}</p>
              <button
                onClick={handleUnlink}
                disabled={unlinking}
                className={`w-full py-2.5 rounded-xl border text-sm flex items-center justify-center gap-2 transition-colors ${
                  confirmUnlink
                    ? 'border-red-300 bg-red-50 text-red-600 dark:bg-red-950/20 dark:border-red-800'
                    : 'border-border hover:bg-muted text-muted-foreground'
                }`}
              >
                {unlinking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2Off className="w-4 h-4" />}
                {confirmUnlink ? t('settings.sharedFinances.confirmRemoveLink') : t('settings.sharedFinances.removeLink')}
              </button>
            </div>
          ) : partnerStatus?.state === 'invite_pending' ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-4 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-xl">
                <div className="w-10 h-10 bg-amber-100 dark:bg-amber-950/40 rounded-full flex items-center justify-center shrink-0">
                  <Send className="w-5 h-5 text-amber-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-sm">{t('settings.sharedFinances.invitationSent')}</p>
                  <p className="text-xs text-muted-foreground truncate">{t('settings.sharedFinances.waitingFor', { email: partnerStatus.pendingInvite?.email })}</p>
                </div>
                <button
                  onClick={handleCancelInvite}
                  className="w-7 h-7 flex items-center justify-center hover:bg-amber-100 dark:hover:bg-amber-900/40 rounded-lg transition-colors shrink-0"
                  title="Cancel invite"
                >
                  <X className="w-4 h-4 text-amber-600" />
                </button>
              </div>
              <p className="text-xs text-muted-foreground">{t('settings.sharedFinances.inviteExpiry')}</p>
              {fallbackUrl && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-amber-700 dark:text-amber-400 flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    {t('settings.sharedFinances.emailNotSent')}
                  </p>
                  <div className="flex gap-2">
                    <input
                      readOnly
                      value={fallbackUrl}
                      className="flex-1 text-xs bg-background border border-border rounded-lg px-3 py-2 outline-none truncate font-mono"
                    />
                    <button
                      onClick={handleCopyUrl}
                      className="px-3 py-2 bg-primary text-white rounded-lg text-xs hover:bg-primary/90 transition-colors shrink-0"
                    >
                      {copied ? t('settings.sharedFinances.copied') : t('settings.sharedFinances.copy')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground leading-relaxed">
                {t('settings.sharedFinances.inviteDescription')}
              </p>
              <div className="flex gap-2">
                <input
                  type="email"
                  placeholder={t('settings.sharedFinances.invitePlaceholder')}
                  value={inviteEmail}
                  onChange={e => setInviteEmail(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleSendInvite(); }}
                  className="flex-1 border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:border-primary bg-background"
                />
                <button
                  onClick={handleSendInvite}
                  disabled={sendingInvite || !inviteEmail.trim()}
                  className="px-4 py-2.5 bg-gradient-to-r from-primary to-secondary text-white rounded-xl text-sm flex items-center gap-2 disabled:opacity-50 hover:shadow-md transition-all"
                >
                  {sendingInvite ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </button>
              </div>
              <div className="flex items-start gap-2 text-xs text-muted-foreground">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>{t('settings.sharedFinances.inviteWarning')}</span>
              </div>
            </div>
          )}
        </div>
      </motion.div>

      {/* Billing & Plan */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.56 }}
        className="bg-card border border-border rounded-2xl overflow-hidden"
      >
        <div className="px-6 py-4 border-b border-border flex items-center gap-2">
          <Crown className="w-4 h-4 text-amber-500" />
          <h3 className="text-sm uppercase tracking-wide text-muted-foreground">{t('billing.title')}</h3>
        </div>
        <div className="p-6 space-y-4">
          {user?.plan === 'premium' ? (
            <>
              {billingLoading ? (
                <div className="flex justify-center py-4">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <>
                  {/* Current plan badge */}
                  <div className="flex items-center gap-3 p-4 bg-gradient-to-r from-amber-500/10 to-yellow-500/5 border border-amber-400/30 rounded-xl">
                    <div className="w-10 h-10 bg-amber-100 dark:bg-amber-950/40 rounded-full flex items-center justify-center shrink-0">
                      <Crown className="w-5 h-5 text-amber-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-display text-sm">{t('billing.premium')}</p>
                      {billingInfo?.cancelAtPeriodEnd && billingInfo?.currentPeriodEnd ? (
                        <p className="text-xs text-muted-foreground">
                          {t('billing.cancelAtEnd')} {new Date(billingInfo.currentPeriodEnd).toLocaleDateString()}
                        </p>
                      ) : billingInfo?.currentPeriodEnd ? (
                        <p className="text-xs text-muted-foreground">
                          {t('billing.renewsOn')} {new Date(billingInfo.currentPeriodEnd).toLocaleDateString()}
                        </p>
                      ) : null}
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      billingInfo?.subscriptionStatus === 'active'
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400'
                        : 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400'
                    }`}>
                      {billingInfo?.subscriptionStatus === 'active' ? t('billing.active') : t('billing.pastDue')}
                    </span>
                  </div>

                  {/* Payment method */}
                  {billingInfo?.paymentMethod ? (
                    <div className="flex items-center gap-3 p-4 bg-muted/30 rounded-xl">
                      <CreditCard className="w-5 h-5 text-muted-foreground" />
                      <div className="text-sm">
                        <span className="capitalize">{billingInfo.paymentMethod.brand}</span>{' '}
                        {t('billing.cardEnding')} {billingInfo.paymentMethod.last4}
                        <span className="text-muted-foreground ml-2">
                          {t('billing.expires')} {billingInfo.paymentMethod.expMonth}/{billingInfo.paymentMethod.expYear}
                        </span>
                      </div>
                    </div>
                  ) : null}

                  {/* Cancel / Reactivate */}
                  {billingInfo?.cancelAtPeriodEnd ? (
                    <button
                      onClick={handleReactivate}
                      disabled={reactivateLoading}
                      className="w-full py-2.5 rounded-xl bg-gradient-to-r from-primary to-secondary text-white text-sm font-display flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      {reactivateLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                      {t('billing.reactivate')}
                    </button>
                  ) : (
                    <button
                      onClick={handleCancel}
                      disabled={cancelLoading}
                      className={`w-full py-2.5 rounded-xl border text-sm flex items-center justify-center gap-2 transition-colors ${
                        confirmCancel
                          ? 'border-red-300 bg-red-50 text-red-600 dark:bg-red-950/20 dark:border-red-800'
                          : 'border-border hover:bg-muted text-muted-foreground'
                      }`}
                    >
                      {cancelLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                      {confirmCancel ? t('billing.cancelConfirmBtn') : t('billing.cancelSubscription')}
                    </button>
                  )}
                  {confirmCancel && (
                    <p className="text-xs text-muted-foreground text-center">{t('billing.cancelConfirmDesc')}</p>
                  )}
                </>
              )}
            </>
          ) : (
            /* Free plan — upgrade CTA */
            <div className="space-y-4">
              <div className="bg-gradient-to-br from-primary/10 to-secondary/10 border border-primary/20 rounded-xl p-5">
                <h4 className="font-display text-primary mb-1">{t('billing.upgradeTitle')}</h4>
                <p className="text-sm text-muted-foreground mb-4">{t('billing.upgradeDesc')}</p>
                <button
                  onClick={handleUpgrade}
                  disabled={upgradeLoading}
                  className="w-full py-3 bg-gradient-to-r from-primary to-secondary text-white rounded-xl font-display text-sm flex items-center justify-center gap-2 hover:shadow-lg transition-all disabled:opacity-70"
                >
                  {upgradeLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Crown className="w-4 h-4" />
                  )}
                  {t('billing.upgradeBtn')}
                </button>
              </div>
            </div>
          )}
        </div>
      </motion.div>

      {/* Sign Out */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6 }}
        className="bg-card border border-destructive/20 rounded-2xl p-6"
      >
        <button
          onClick={onLogout}
          className="w-full flex items-center justify-between p-4 bg-destructive/5 hover:bg-destructive/10 rounded-xl transition-colors group"
        >
          <div className="flex items-center gap-3">
            <LogOut className="w-5 h-5 text-destructive" />
            <div className="text-left">
              <p className="font-display text-destructive">{t('settings.signOut.button')}</p>
              <p className="text-sm text-muted-foreground">{t('settings.signOut.subtitle')}</p>
            </div>
          </div>
          <ChevronRight className="w-5 h-5 text-destructive group-hover:translate-x-1 transition-transform" />
        </button>
      </motion.div>
    </div>
  );
}
