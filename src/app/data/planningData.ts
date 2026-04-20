export interface LifePlan {
  id: string;
  title: string;
  type: 'vacation' | 'investment' | 'emergency' | 'purchase' | 'education';
  targetAmount: number;
  currentAmount: number;
  deadline: string;
  monthlyContribution: number;
  icon: string;
  color: string;
  description: string;
  status: 'on-track' | 'ahead' | 'behind';
  spendingImpact?: {
    status: 'positive' | 'neutral' | 'negative';
    message: string;
    adjustment?: string;
  };
}

export interface MoneyAllocation {
  category: string;
  allocated: number;
  percentage: number;
  type: 'essential' | 'investment' | 'plan' | 'flexible';
  icon: string;
  actual?: number;
  status?: 'on-track' | 'behind' | 'exceeded';
}

export interface UpcomingAction {
  id: string;
  title: string;
  date: string;
  amount: number;
  type: 'income' | 'transfer' | 'payment' | 'review';
  icon: string;
  status: 'pending' | 'scheduled' | 'completed';
}

export interface SmartRecommendation {
  id: string;
  title: string;
  description: string;
  impact: 'high' | 'medium' | 'low';
  type: 'opportunity' | 'warning' | 'insight';
  action?: string;
}

export interface DeviationAlert {
  id: string;
  title: string;
  description: string;
  severity: 'critical' | 'warning' | 'info';
  category: string;
}

export const lifePlans: LifePlan[] = [
  {
    id: '1',
    title: 'Summer Adventure in Greece',
    type: 'vacation',
    targetAmount: 4500,
    currentAmount: 2890,
    deadline: '2026-07-15',
    monthlyContribution: 450,
    icon: '✈️',
    color: '#3B82F6',
    description: '2 weeks exploring Athens, Santorini, and Crete',
    status: 'on-track',
    spendingImpact: {
      status: 'neutral',
      message: 'You are on track for this goal',
      adjustment: 'Your spending is aligned with your vacation savings plan'
    }
  },
  {
    id: '2',
    title: 'Investment Portfolio Growth',
    type: 'investment',
    targetAmount: 25000,
    currentAmount: 18200,
    deadline: '2026-12-31',
    monthlyContribution: 800,
    icon: '📈',
    color: '#10B981',
    description: 'Build a diversified long-term portfolio',
    status: 'ahead',
    spendingImpact: {
      status: 'negative',
      message: 'Recent spending is affecting your investment contributions',
      adjustment: 'You contributed $650 instead of planned $800 this month. Reduce flexible spending by $150 to stay on track.'
    }
  },
  {
    id: '3',
    title: 'Emergency Safety Net',
    type: 'emergency',
    targetAmount: 15000,
    currentAmount: 11200,
    deadline: '2027-03-01',
    monthlyContribution: 400,
    icon: '🛡️',
    color: '#F59E0B',
    description: '6 months of living expenses',
    status: 'on-track',
    spendingImpact: {
      status: 'positive',
      message: 'Excellent discipline on your emergency fund',
      adjustment: 'You are consistently meeting your $400/month target'
    }
  },
  {
    id: '4',
    title: 'New MacBook Pro',
    type: 'purchase',
    targetAmount: 3200,
    currentAmount: 1450,
    deadline: '2026-09-01',
    monthlyContribution: 350,
    icon: '💻',
    color: '#8B5CF6',
    description: 'Upgrade work equipment',
    status: 'behind',
    spendingImpact: {
      status: 'negative',
      message: 'Your recent spending is slowing this plan',
      adjustment: 'At this pace, you will reach this goal 6 weeks later than expected. Increase contribution to $500/month or reduce leisure spending.'
    }
  },
];

export const monthlyIncome = 6500;

export const moneyAllocation: MoneyAllocation[] = [
  { category: 'Living Essentials', allocated: 2200, percentage: 34, type: 'essential', icon: '🏠', actual: 2150, status: 'on-track' },
  { category: 'Investment Portfolio', allocated: 800, percentage: 12, type: 'investment', icon: '📈', actual: 650, status: 'behind' },
  { category: 'Greece Vacation', allocated: 450, percentage: 7, type: 'plan', icon: '✈️', actual: 450, status: 'on-track' },
  { category: 'Emergency Fund', allocated: 400, percentage: 6, type: 'plan', icon: '🛡️', actual: 400, status: 'on-track' },
  { category: 'MacBook Pro', allocated: 350, percentage: 5, type: 'plan', icon: '💻', actual: 250, status: 'behind' },
  { category: 'Flexible Spending', allocated: 1200, percentage: 18, type: 'flexible', icon: '🎯', actual: 1580, status: 'exceeded' },
  { category: 'Unassigned', allocated: 1100, percentage: 17, type: 'flexible', icon: '💰', actual: 0, status: 'on-track' },
];

export const upcomingActions: UpcomingAction[] = [
  {
    id: '1',
    title: 'Monthly Salary',
    date: '2026-04-25',
    amount: 6500,
    type: 'income',
    icon: '💵',
    status: 'scheduled',
  },
  {
    id: '2',
    title: 'Auto-transfer to Investment',
    date: '2026-04-26',
    amount: -800,
    type: 'transfer',
    icon: '📈',
    status: 'scheduled',
  },
  {
    id: '3',
    title: 'Greece Vacation Fund',
    date: '2026-04-26',
    amount: -450,
    type: 'transfer',
    icon: '✈️',
    status: 'scheduled',
  },
  {
    id: '4',
    title: 'Review Investment Portfolio',
    date: '2026-04-30',
    amount: 0,
    type: 'review',
    icon: '📊',
    status: 'pending',
  },
];

export const smartRecommendations: SmartRecommendation[] = [
  {
    id: '1',
    title: 'Flexible spending trending high',
    description: 'You spent 30% more on flexible spending this week. This may affect your vacation goal if it continues.',
    impact: 'high',
    type: 'warning',
    action: 'Review spending',
  },
  {
    id: '2',
    title: 'Great discipline on essentials',
    description: 'Your living essentials spending is $50 under budget. You\'re staying aligned with your plan beautifully.',
    impact: 'medium',
    type: 'insight',
    action: null,
  },
  {
    id: '3',
    title: 'Investment contribution recovery',
    description: 'You can still reach your investment target by adding the missed $150 to next month\'s contribution.',
    impact: 'high',
    type: 'opportunity',
    action: 'Adjust next month',
  },
];

export const deviationAlerts: DeviationAlert[] = [
  {
    id: '1',
    title: 'MacBook plan falling behind',
    description: 'You need to increase contributions by €150/month to meet your September deadline',
    severity: 'warning',
    category: 'MacBook Pro',
  },
];

export interface Expense {
  id: string;
  date: string;
  description: string;
  amount: number;
  category: string;
  planImpact?: string;
}

export const recentExpenses: Expense[] = [
  { id: '1', date: '2026-04-13', description: 'Whole Foods Market', amount: 87.45, category: 'Living Essentials' },
  { id: '2', date: '2026-04-13', description: 'Coffee & Co', amount: 12.50, category: 'Flexible Spending' },
  { id: '3', date: '2026-04-12', description: 'Netflix Subscription', amount: 15.99, category: 'Flexible Spending' },
  { id: '4', date: '2026-04-12', description: 'Dinner with friends', amount: 68.00, category: 'Flexible Spending' },
  { id: '5', date: '2026-04-11', description: 'Uber rides', amount: 24.80, category: 'Living Essentials' },
  { id: '6', date: '2026-04-11', description: 'Gym class', amount: 35.00, category: 'Flexible Spending' },
  { id: '7', date: '2026-04-10', description: 'Grocery store', amount: 124.30, category: 'Living Essentials' },
  { id: '8', date: '2026-04-10', description: 'Concert tickets', amount: 95.00, category: 'Flexible Spending', planImpact: 'Greece Vacation' },
  { id: '9', date: '2026-04-09', description: 'Online shopping', amount: 156.00, category: 'Flexible Spending' },
  { id: '10', date: '2026-04-08', description: 'Gas station', amount: 55.00, category: 'Living Essentials' },
];

export const planStatus = {
  overallProgress: 68,
  status: 'aligned' as 'aligned' | 'drifting' | 'off-track',
  message: 'You are aligned with your financial life plan',
  plansOnTrack: 3,
  totalPlans: 4,
  spendingAlignment: 'good' as 'good' | 'warning' | 'critical',
};
