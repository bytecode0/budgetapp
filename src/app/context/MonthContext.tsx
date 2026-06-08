import { createContext, useContext, useState, type ReactNode } from 'react';

export function currentMonthKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function monthKeyOffset(base: string, offset: number): string {
  const [y, m] = base.split('-').map(Number);
  const d = new Date(y, m - 1 + offset, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function monthLabel(key: string, locale: string): string {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(locale, { month: 'long', year: 'numeric' });
}

interface MonthContextValue {
  selectedMonth: string;
  navigate: (dir: -1 | 1) => void;
  isCurrentMonth: boolean;
  isFutureMonth: boolean;
}

const MonthContext = createContext<MonthContextValue>({
  selectedMonth: currentMonthKey(),
  navigate: () => {},
  isCurrentMonth: true,
  isFutureMonth: false,
});

export function MonthProvider({ children }: { children: ReactNode }) {
  const [selectedMonth, setSelectedMonth] = useState(() => currentMonthKey());

  const navigate = (dir: -1 | 1) => {
    setSelectedMonth(prev => {
      const current = currentMonthKey();
      const maxMonth = monthKeyOffset(current, 1);
      const next = monthKeyOffset(prev, dir);
      if (next > maxMonth) return prev;
      return next;
    });
  };

  const current = currentMonthKey();

  return (
    <MonthContext.Provider value={{
      selectedMonth,
      navigate,
      isCurrentMonth: selectedMonth === current,
      isFutureMonth: selectedMonth > current,
    }}>
      {children}
    </MonthContext.Provider>
  );
}

export function useMonth() {
  return useContext(MonthContext);
}
