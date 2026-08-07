import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { currentPeriodKey, periodKeyOffset, periodLabel, periodRangeLabel } from '../lib/period';
import { useAuth } from './AuthContext';

// Re-exported under their previous names so existing call sites (App.tsx,
// screens) don't need to change.
export { periodLabel as monthLabel, periodRangeLabel };
export { currentPeriodKey as currentMonthKey, periodKeyOffset as monthKeyOffset };

interface MonthContextValue {
  selectedMonth: string;
  navigate: (dir: -1 | 1) => void;
  isCurrentMonth: boolean;
  isFutureMonth: boolean;
  /** The user's payday (1-28). 1 = calendar month (the default). Exposed so
   *  screens can show the actual date range a period covers alongside its label. */
  cycleStartDay: number;
  /** Re-fetch cycleStartDay from the server — call after PlanningSettings
   *  successfully updates the payday, so the whole app picks it up immediately
   *  without a full reload. */
  refreshCycleStartDay: () => Promise<void>;
}

const MonthContext = createContext<MonthContextValue>({
  selectedMonth: currentPeriodKey(1),
  navigate: () => {},
  isCurrentMonth: true,
  isFutureMonth: false,
  cycleStartDay: 1,
  refreshCycleStartDay: async () => {},
});

export function MonthProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [cycleStartDay, setCycleStartDay] = useState(1);
  // Starts on the calendar-month guess (cycleStartDay=1); corrected below once
  // the real payday loads, unless the user has already navigated away from it.
  const [selectedMonth, setSelectedMonth] = useState(() => currentPeriodKey(1));

  const loadCycleStartDay = async () => {
    try {
      const res = await fetch('/api/allocations', { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json();
      const day = Number(data.cycleStartDay) || 1;
      setCycleStartDay(day);
      // Only overwrite the selection if it's still the pre-load default guess
      // (a functional update reads the latest value, so this can't clobber a
      // navigation that happened while the fetch was in flight).
      setSelectedMonth(prev => (prev === currentPeriodKey(1) ? currentPeriodKey(day) : prev));
    } catch { /* best-effort */ }
  };

  useEffect(() => {
    if (!user) return;
    loadCycleStartDay();
  }, [user]);

  const navigate = (dir: -1 | 1) => {
    setSelectedMonth(prev => {
      const current = currentPeriodKey(cycleStartDay);
      const maxMonth = periodKeyOffset(current, 1);
      const next = periodKeyOffset(prev, dir);
      if (next > maxMonth) return prev;
      return next;
    });
  };

  const current = currentPeriodKey(cycleStartDay);

  return (
    <MonthContext.Provider value={{
      selectedMonth,
      navigate,
      isCurrentMonth: selectedMonth === current,
      isFutureMonth: selectedMonth > current,
      cycleStartDay,
      refreshCycleStartDay: loadCycleStartDay,
    }}>
      {children}
    </MonthContext.Provider>
  );
}

export function useMonth() {
  return useContext(MonthContext);
}
