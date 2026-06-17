import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { LayoutDashboard, Sparkles, Wallet, Target, Settings, Menu, X, Activity as ActivityIcon, Crown, Zap, ChevronLeft, ChevronRight, Landmark, Users } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Toaster } from 'sonner';
import { Home } from './components/Home';
import { PlanningDashboard } from './components/PlanningDashboard';
import { CreatePlan } from './components/CreatePlan';
import { PlanDetail } from './components/PlanDetail';
import { AllocationFlow } from './components/AllocationFlow';
import { PlanningSettings } from './components/PlanningSettings';
import { Activity } from './components/Activity';
import { Accounts } from './components/Accounts';
import { FamilyDashboard } from './components/FamilyDashboard';
import { AddExpense } from './components/AddExpense';
import { AuthFlow } from './components/auth/AuthFlow';
import { PartnerInviteAccept } from './components/PartnerInviteAccept';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LanguageProvider, useLanguage } from './context/LanguageContext';
import { MonthProvider, useMonth, monthLabel } from './context/MonthContext';
import { useAllocations } from './hooks/useAllocations';
import { useAnalytics } from './hooks/useAnalytics';
import { useHousehold } from './hooks/useHousehold';
import { fetchInviteDetails, usePartner, type InviteDetails } from './hooks/usePartner';

type Screen = 'home' | 'dashboard' | 'create-plan' | 'plan-detail' | 'allocation' | 'activity' | 'accounts' | 'household' | 'settings';

function AppInner() {
  const { user, loading, logout, refreshUser } = useAuth();
  const { t } = useTranslation();
  const { darkMode, updateDarkMode, dbLanguage, updateLanguage } = useAllocations();
  const { household } = useHousehold();
  const inHousehold = (household?.members?.length ?? 0) > 1;
  const { language, setLanguage } = useLanguage();
  const locale = language === 'es' ? 'es-ES' : 'en-GB';
  const { selectedMonth, navigate: navigateMonth, isCurrentMonth: isCurrentMonthSelected, isFutureMonth } = useMonth();
  const { analytics } = useAnalytics(selectedMonth, selectedMonth);
  const alignmentPct = analytics?.alignment.pct ?? null;
  const alignmentLabel = alignmentPct === null
    ? t('sidebar.mostlyAligned')
    : alignmentPct >= 90 ? t('sidebar.aligned')
    : alignmentPct >= 60 ? t('sidebar.mostlyAligned')
    : t('sidebar.offTrack');
  const [currentScreen, setCurrentScreen] = useState<Screen>('home');
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showAddExpense, setShowAddExpense] = useState(false);

  // Partner invite: detect ?invite=TOKEN in URL
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [inviteDetails, setInviteDetails] = useState<InviteDetails | null>(null);
  const { acceptInvite } = usePartner();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('invite');
    if (token) {
      setInviteToken(token);
      fetchInviteDetails(token).then(details => setInviteDetails(details));
      // Clean the token from the URL without reloading
      const url = new URL(window.location.href);
      url.searchParams.delete('invite');
      window.history.replaceState({}, '', url.toString());
    }
  }, []);

  // Sync DB language to LanguageContext on load
  useEffect(() => {
    if (dbLanguage) setLanguage(dbLanguage as 'en' | 'es');
  }, [dbLanguage]);

  // Sync dark mode class
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  const navigation = [
    { id: 'home' as Screen,       label: t('nav.home'),      icon: LayoutDashboard },
    { id: 'dashboard' as Screen,  label: t('nav.lifePlans'), icon: Sparkles },
    { id: 'activity' as Screen,   label: t('nav.activity'),  icon: ActivityIcon },
    { id: 'allocation' as Screen, label: t('nav.allocate'),  icon: Wallet },
    { id: 'accounts' as Screen,   label: t('nav.accounts'),  icon: Landmark },
    ...(inHousehold ? [{ id: 'household' as Screen, label: t('nav.household'), icon: Users }] : []),
    { id: 'settings' as Screen,   label: t('nav.settings'),  icon: Settings },
  ];

  const handleViewPlan = (planId: string) => {
    setSelectedPlanId(planId);
    setCurrentScreen('plan-detail');
  };

  const renderScreen = () => {
    switch (currentScreen) {
      case 'home':
        return <Home onNavigate={(screen) => setCurrentScreen(screen as Screen)} />;
      case 'dashboard':
        return <PlanningDashboard onNavigate={(screen) => setCurrentScreen(screen as Screen)} onViewPlan={handleViewPlan} />;
      case 'activity':
        return <Activity onAddExpense={() => setShowAddExpense(true)} />;
      case 'create-plan':
        return <CreatePlan onBack={() => setCurrentScreen('dashboard')} />;
      case 'plan-detail':
        return selectedPlanId ? (
          <PlanDetail planId={selectedPlanId} onBack={() => setCurrentScreen('dashboard')} />
        ) : (
          <PlanningDashboard onNavigate={(screen) => setCurrentScreen(screen as Screen)} onViewPlan={handleViewPlan} />
        );
      case 'allocation':
        return <AllocationFlow />;
      case 'accounts':
        return <Accounts />;
      case 'household':
        return <FamilyDashboard />;
      case 'settings':
        return <PlanningSettings darkMode={darkMode} onToggleDarkMode={() => updateDarkMode(!darkMode)} onLanguageChange={updateLanguage} onLogout={() => logout()} />;
      default:
        return <Home onNavigate={(screen) => setCurrentScreen(screen as Screen)} />;
    }
  };

  // Show loading screen while checking auth
  if (loading) {
    return (
      <div className="size-full bg-background flex items-center justify-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5 }}
          className="text-center"
        >
          <div className="w-20 h-20 bg-gradient-to-br from-primary to-secondary rounded-3xl flex items-center justify-center shadow-2xl mx-auto mb-4">
            <Target className="w-11 h-11 text-white" />
          </div>
          <h2 className="text-2xl font-display text-primary mb-2">LifePlan</h2>
          <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin mx-auto" />
        </motion.div>
      </div>
    );
  }

  // Show auth flow if not authenticated
  if (!user) {
    return (
      <AuthFlow
        onAuthenticated={() => refreshUser()}
        inviteBanner={inviteDetails ? { senderName: inviteDetails.senderName, senderEmail: inviteDetails.senderEmail } : null}
      />
    );
  }

  return (
    <div className="size-full bg-background">
      {/* Mobile Header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 h-16 bg-card/80 backdrop-blur-xl border-b border-border z-50 flex items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-gradient-to-br from-primary to-secondary rounded-lg flex items-center justify-center">
            <Target className="w-5 h-5 text-white" />
          </div>
          <h2 className="font-display text-xl text-primary">LifePlan</h2>
        </div>
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="p-2 hover:bg-muted rounded-lg transition-colors"
        >
          {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      {/* Mobile Menu Overlay */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileMenuOpen(false)}
              className="lg:hidden fixed inset-0 bg-black/50 z-40 top-16"
            />
            <motion.div
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 25 }}
              className="lg:hidden fixed left-0 top-16 bottom-0 w-64 bg-card border-r border-border z-40 overflow-y-auto"
            >
              <nav className="p-4 space-y-2">
                {/* Global month selector */}
                <div className="pb-3 mb-1 border-b border-border">
                  <p className="text-xs text-muted-foreground mb-2 px-1">{t('sidebar.workingMonth')}</p>
                  <div className="flex items-center gap-1 bg-muted rounded-xl p-1">
                    <button onClick={() => navigateMonth(-1)} className="w-8 h-8 flex items-center justify-center hover:bg-background rounded-lg transition-colors shrink-0">
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <p className="flex-1 text-center text-sm font-display capitalize">{monthLabel(selectedMonth, locale)}</p>
                    <button onClick={() => navigateMonth(1)} disabled={isFutureMonth} className="w-8 h-8 flex items-center justify-center hover:bg-background rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed shrink-0">
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                {navigation.map((item) => {
                  const Icon = item.icon;
                  const isActive = currentScreen === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => {
                        setCurrentScreen(item.id);
                        setMobileMenuOpen(false);
                      }}
                      className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
                        item.highlighted
                          ? 'bg-gradient-to-r from-primary to-secondary text-white shadow-lg'
                          : isActive
                          ? 'bg-primary text-primary-foreground shadow-md'
                          : 'hover:bg-muted text-foreground'
                      }`}
                    >
                      <Icon className="w-5 h-5" />
                      <span className="font-display">{item.label}</span>
                    </button>
                  );
                })}
              </nav>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Desktop Sidebar */}
      <div className="hidden lg:block fixed left-0 top-0 bottom-0 w-72 bg-card border-r border-border overflow-y-auto">
        <div className="p-6 border-b border-border">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-12 h-12 bg-gradient-to-br from-primary to-secondary rounded-2xl flex items-center justify-center shadow-lg">
              <Target className="w-7 h-7 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-display text-primary">LifePlan</h1>
              <p className="text-xs text-muted-foreground">{t('sidebar.tagline')}</p>
            </div>
          </div>
          <p className="text-sm text-muted-foreground mt-3">
            {t('sidebar.planTagline')}
          </p>
        </div>
        {/* Global month selector */}
        <div className="px-4 py-3 border-b border-border">
          <p className="text-xs text-muted-foreground mb-2">{t('sidebar.workingMonth')}</p>
          <div className="flex items-center gap-1 bg-muted rounded-xl p-1">
            <button onClick={() => navigateMonth(-1)} className="w-8 h-8 flex items-center justify-center hover:bg-background rounded-lg transition-colors shrink-0">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="flex-1 text-center">
              <p className="text-sm font-display capitalize leading-tight">{monthLabel(selectedMonth, locale)}</p>
              {isFutureMonth && <p className="text-xs text-violet-500 leading-tight">{t('monthlyReview.nextMonth')}</p>}
              {isCurrentMonthSelected && <p className="text-xs text-primary/60 leading-tight">●</p>}
            </div>
            <button onClick={() => navigateMonth(1)} disabled={isFutureMonth} className="w-8 h-8 flex items-center justify-center hover:bg-background rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed shrink-0">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
        <nav className="p-4 space-y-2">
          {navigation.map((item) => {
            const Icon = item.icon;
            const isActive = currentScreen === item.id;
            return (
              <motion.button
                key={item.id}
                onClick={() => setCurrentScreen(item.id)}
                whileHover={{ scale: isActive ? 1 : 1.02 }}
                whileTap={{ scale: 0.98 }}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
                  item.highlighted
                    ? 'bg-gradient-to-r from-primary to-secondary text-white shadow-lg hover:shadow-xl'
                    : isActive
                    ? 'bg-primary text-primary-foreground shadow-md'
                    : 'hover:bg-muted text-foreground'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="font-display">{item.label}</span>
              </motion.button>
            );
          })}
        </nav>

        <div className="p-4 mt-auto space-y-3">
          {/* Plan badge */}
          {user?.plan === 'premium' ? (
            <div className="bg-gradient-to-r from-amber-500/20 to-yellow-500/10 border border-amber-400/30 rounded-xl p-3 flex items-center gap-2">
              <Crown className="w-4 h-4 text-amber-500 shrink-0" />
              <span className="text-sm font-display text-amber-600 dark:text-amber-400">{t('billing.premium')}</span>
            </div>
          ) : (
            <button
              onClick={() => setCurrentScreen('settings')}
              className="w-full bg-gradient-to-r from-primary to-secondary text-white rounded-xl p-3 flex items-center gap-2 hover:shadow-lg transition-all"
            >
              <Zap className="w-4 h-4 shrink-0" />
              <span className="text-sm font-display">{t('billing.upgradeNow')}</span>
            </button>
          )}

          {/* Spending Alignment Status */}
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-2 h-2 bg-secondary rounded-full animate-pulse" />
              <p className="text-xs text-muted-foreground">{t('sidebar.planStatus')}</p>
            </div>
            <p className="text-sm font-display">{alignmentLabel}</p>
            <div className="mt-3 h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-secondary to-primary rounded-full transition-all"
                style={{ width: `${alignmentPct ?? 0}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-2">{t('sidebar.onTrackPct', { pct: alignmentPct ?? 0 })}</p>
          </div>

          <div className="bg-gradient-to-br from-secondary/10 to-primary/10 border border-primary/10 rounded-xl p-4">
            <p className="text-sm font-display mb-2 text-primary">💡 {t('sidebar.planningTip')}</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {t('sidebar.planningTipBody')}
            </p>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="lg:ml-72 pt-16 lg:pt-0">
        <main className="container mx-auto px-4 lg:px-8 py-6 lg:py-8 max-w-7xl">
          <AnimatePresence mode="wait">
            <motion.div
              key={currentScreen}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3 }}
            >
              {renderScreen()}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      {/* Add Expense Modal */}
      <AddExpense isOpen={showAddExpense} onClose={() => setShowAddExpense(false)} />

      {/* Partner Invite Accept Modal — shown after login if ?invite= was in URL */}
      <AnimatePresence>
        {user && inviteToken && inviteDetails && (
          <PartnerInviteAccept
            token={inviteToken}
            invite={inviteDetails}
            onAccept={acceptInvite}
            onDismiss={() => { setInviteToken(null); setInviteDetails(null); refreshUser(); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

export default function App() {
  return (
    <LanguageProvider>
      <AuthProvider>
        <MonthProvider>
          <Toaster richColors position="top-right" />
          <AppInner />
        </MonthProvider>
      </AuthProvider>
    </LanguageProvider>
  );
}