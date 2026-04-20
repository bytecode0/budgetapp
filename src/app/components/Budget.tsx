import { AlertCircle, CheckCircle, TrendingUp } from 'lucide-react';
import { budgets, categoryColors } from '../data/mockData';
import { motion } from 'motion/react';

export function Budget() {
  const totalBudget = budgets.reduce((sum, b) => sum + b.allocated, 0);
  const totalSpent = budgets.reduce((sum, b) => sum + b.spent, 0);
  const remainingBudget = totalBudget - totalSpent;

  const getProgressColor = (spent: number, allocated: number) => {
    const percentage = (spent / allocated) * 100;
    if (percentage >= 100) return 'text-destructive';
    if (percentage >= 80) return 'text-accent';
    return 'text-secondary';
  };

  const getProgressBarColor = (spent: number, allocated: number) => {
    const percentage = (spent / allocated) * 100;
    if (percentage >= 100) return 'var(--destructive)';
    if (percentage >= 80) return 'var(--accent)';
    return 'var(--secondary)';
  };

  return (
    <div className="space-y-6 pb-8">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="space-y-2"
      >
        <h1 className="text-4xl tracking-tight">Budget</h1>
        <p className="text-muted-foreground">Monitor your spending limits and stay on track</p>
      </motion.div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="bg-gradient-to-br from-primary to-primary/80 text-primary-foreground rounded-[var(--radius)] p-6 shadow-lg"
        >
          <p className="text-sm opacity-90 mb-2">Total Budget</p>
          <p className="text-3xl font-display tracking-tight mb-1">${totalBudget.toLocaleString()}</p>
          <p className="text-sm opacity-75">Set for this month</p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="bg-card border border-border rounded-[var(--radius)] p-6"
        >
          <p className="text-sm text-muted-foreground mb-2">Total Spent</p>
          <p className="text-3xl font-display tracking-tight mb-1">${totalSpent.toLocaleString()}</p>
          <p className="text-sm text-muted-foreground">
            {((totalSpent / totalBudget) * 100).toFixed(1)}% of budget
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="bg-gradient-to-br from-secondary to-secondary/80 text-white rounded-[var(--radius)] p-6 shadow-lg"
        >
          <p className="text-sm opacity-90 mb-2">Remaining</p>
          <p className="text-3xl font-display tracking-tight mb-1">${remainingBudget.toLocaleString()}</p>
          <p className="text-sm opacity-75">Available to spend</p>
        </motion.div>
      </div>

      {/* Budget Progress */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.4 }}
        className="bg-card border border-border rounded-[var(--radius)] p-6"
      >
        <h3 className="mb-6">Budget by Category</h3>
        <div className="space-y-6">
          {budgets.map((budget, index) => {
            const percentage = (budget.spent / budget.allocated) * 100;
            const remaining = budget.allocated - budget.spent;
            const isOverBudget = percentage >= 100;
            const isWarning = percentage >= 80 && percentage < 100;

            return (
              <motion.div
                key={budget.category}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3, delay: 0.5 + (index * 0.1) }}
                className="space-y-3"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-10 h-10 rounded-lg flex items-center justify-center text-white text-sm font-display shadow-sm"
                      style={{ backgroundColor: categoryColors[budget.category] || '#6B7280' }}
                    >
                      {budget.category.slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-display">{budget.category}</p>
                        {isOverBudget && (
                          <div className="flex items-center gap-1 text-xs text-destructive bg-destructive/10 px-2 py-0.5 rounded-full">
                            <AlertCircle className="w-3 h-3" />
                            Over budget
                          </div>
                        )}
                        {isWarning && (
                          <div className="flex items-center gap-1 text-xs text-accent bg-accent/10 px-2 py-0.5 rounded-full">
                            <AlertCircle className="w-3 h-3" />
                            Warning
                          </div>
                        )}
                        {!isOverBudget && !isWarning && (
                          <div className="flex items-center gap-1 text-xs text-secondary bg-secondary/10 px-2 py-0.5 rounded-full">
                            <CheckCircle className="w-3 h-3" />
                            On track
                          </div>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">
                        ${budget.spent.toLocaleString()} of ${budget.allocated.toLocaleString()}
                        {remaining >= 0 ? (
                          <span className="text-secondary"> • ${remaining.toLocaleString()} left</span>
                        ) : (
                          <span className="text-destructive"> • ${Math.abs(remaining).toLocaleString()} over</span>
                        )}
                      </p>
                    </div>
                  </div>
                  <p className={`text-2xl font-display ${getProgressColor(budget.spent, budget.allocated)}`}>
                    {percentage.toFixed(0)}%
                  </p>
                </div>

                <div className="relative h-3 bg-muted rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min(percentage, 100)}%` }}
                    transition={{ duration: 1, delay: 0.5 + (index * 0.1), ease: 'easeOut' }}
                    className="absolute top-0 left-0 h-full rounded-full transition-all"
                    style={{ backgroundColor: getProgressBarColor(budget.spent, budget.allocated) }}
                  />
                  {percentage > 100 && (
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${percentage - 100}%` }}
                      transition={{ duration: 1, delay: 0.5 + (index * 0.1), ease: 'easeOut' }}
                      className="absolute top-0 left-0 h-full bg-destructive/40 rounded-full"
                      style={{ left: '100%' }}
                    />
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      </motion.div>

      {/* Insights */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.8 }}
        className="bg-gradient-to-br from-accent/10 to-accent/5 border border-accent/20 rounded-[var(--radius)] p-6"
      >
        <div className="flex items-start gap-3 mb-4">
          <div className="bg-accent/20 p-2 rounded-lg">
            <TrendingUp className="w-5 h-5 text-accent" />
          </div>
          <div>
            <h4 className="font-display mb-1">Budget Tips</h4>
            <p className="text-sm text-muted-foreground">Recommendations based on your spending</p>
          </div>
        </div>
        <ul className="space-y-2 text-sm">
          <li className="flex items-start gap-2">
            <span className="text-accent mt-1">•</span>
            <span>You're over budget on Shopping by ${(budgets.find(b => b.category === 'Shopping')?.spent! - budgets.find(b => b.category === 'Shopping')?.allocated!).toFixed(2)}. Consider reducing non-essential purchases.</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-accent mt-1">•</span>
            <span>Great job on Food spending! You're {(100 - (budgets.find(b => b.category === 'Food')?.spent! / budgets.find(b => b.category === 'Food')?.allocated!) * 100).toFixed(0)}% under budget.</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-accent mt-1">•</span>
            <span>Your Transport budget is well managed. Keep up the good work!</span>
          </li>
        </ul>
      </motion.div>
    </div>
  );
}
