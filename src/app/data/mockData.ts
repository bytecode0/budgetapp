export interface Transaction {
  id: string;
  date: string;
  description: string;
  category: string;
  amount: number;
  type: 'income' | 'expense';
}

export interface Budget {
  category: string;
  allocated: number;
  spent: number;
  icon: string;
}

export interface Investment {
  name: string;
  type: string;
  value: number;
  change: number;
  changePercent: number;
}

export interface Goal {
  id: string;
  name: string;
  target: number;
  current: number;
  deadline: string;
  icon: string;
}

export const transactions: Transaction[] = [
  { id: '1', date: '2026-04-12', description: 'Salary - Tech Corp', category: 'Salary', amount: 5500, type: 'income' },
  { id: '2', date: '2026-04-11', description: 'Whole Foods Market', category: 'Food', amount: -127.45, type: 'expense' },
  { id: '3', date: '2026-04-10', description: 'Uber', category: 'Transport', amount: -24.80, type: 'expense' },
  { id: '4', date: '2026-04-09', description: 'Netflix', category: 'Entertainment', amount: -15.99, type: 'expense' },
  { id: '5', date: '2026-04-08', description: 'Electric Bill', category: 'Utilities', amount: -89.50, type: 'expense' },
  { id: '6', date: '2026-04-07', description: 'Amazon', category: 'Shopping', amount: -156.23, type: 'expense' },
  { id: '7', date: '2026-04-06', description: 'Gym Membership', category: 'Health', amount: -65.00, type: 'expense' },
  { id: '8', date: '2026-04-05', description: 'Freelance Project', category: 'Freelance', amount: 850, type: 'income' },
];

export const budgets: Budget[] = [
  { category: 'Food', allocated: 600, spent: 485.30, icon: 'utensils' },
  { category: 'Transport', allocated: 200, spent: 142.60, icon: 'car' },
  { category: 'Entertainment', allocated: 150, spent: 98.45, icon: 'film' },
  { category: 'Shopping', allocated: 300, spent: 412.80, icon: 'shopping-bag' },
  { category: 'Utilities', allocated: 250, spent: 189.50, icon: 'zap' },
  { category: 'Health', allocated: 150, spent: 95.00, icon: 'heart' },
];

export const investments: Investment[] = [
  { name: 'S&P 500 Index Fund', type: 'ETF', value: 25430, change: 342, changePercent: 1.36 },
  { name: 'Tech Stocks', type: 'Stocks', value: 12890, change: -156, changePercent: -1.20 },
  { name: 'Bonds', type: 'Bonds', value: 8500, change: 45, changePercent: 0.53 },
  { name: 'Real Estate Fund', type: 'REIT', value: 6200, change: 78, changePercent: 1.27 },
];

export const goals: Goal[] = [
  { id: '1', name: 'Emergency Fund', target: 15000, current: 8450, deadline: '2026-12-31', icon: 'shield' },
  { id: '2', name: 'Vacation to Japan', target: 5000, current: 2340, deadline: '2027-06-01', icon: 'plane' },
  { id: '3', name: 'New Car Down Payment', target: 10000, current: 6780, deadline: '2027-03-15', icon: 'car' },
  { id: '4', name: 'Home Renovation', target: 20000, current: 3200, deadline: '2027-09-01', icon: 'home' },
];

export const categoryColors: Record<string, string> = {
  'Food': '#F59E0B',
  'Transport': '#3B82F6',
  'Entertainment': '#8B5CF6',
  'Shopping': '#EC4899',
  'Utilities': '#10B981',
  'Health': '#EF4444',
  'Salary': '#10B981',
  'Freelance': '#34D399',
};

export const monthlyData = [
  { month: 'Oct', income: 5800, expenses: 3200 },
  { month: 'Nov', income: 6200, expenses: 3600 },
  { month: 'Dec', income: 5900, expenses: 4100 },
  { month: 'Jan', income: 6100, expenses: 3400 },
  { month: 'Feb', income: 5700, expenses: 3800 },
  { month: 'Mar', income: 6350, expenses: 3950 },
];
