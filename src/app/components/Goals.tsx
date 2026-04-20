import { Target, Plus, Calendar, TrendingUp } from 'lucide-react';
import { goals } from '../data/mockData';
import { motion } from 'motion/react';
import { differenceInDays } from 'date-fns';

export function Goals() {
  const totalTargetAmount = goals.reduce((sum, g) => sum + g.target, 0);
  const totalCurrentAmount = goals.reduce((sum, g) => sum + g.current, 0);
  const overallProgress = ((totalCurrentAmount / totalTargetAmount) * 100).toFixed(1);

  const getIconComponent = (iconName: string) => {
    const icons: Record<string, any> = {
      shield: '🛡️',
      plane: '✈️',
      car: '🚗',
      home: '🏠',
    };
    return icons[iconName] || '🎯';
  };

  return (
    <div className="space-y-6 pb-8">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="flex items-start justify-between"
      >
        <div className="space-y-2">
          <h1 className="text-4xl tracking-tight">Financial Goals</h1>
          <p className="text-muted-foreground">Track your progress toward your dreams</p>
        </div>
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          className="bg-primary text-primary-foreground px-6 py-3 rounded-full flex items-center gap-2 shadow-lg hover:shadow-xl transition-shadow"
        >
          <Plus className="w-5 h-5" />
          <span className="font-display">New Goal</span>
        </motion.button>
      </motion.div>

      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="bg-gradient-to-br from-primary to-primary/80 text-primary-foreground rounded-[var(--radius)] p-6 shadow-lg"
        >
          <div className="flex items-start justify-between mb-4">
            <div className="space-y-1">
              <p className="text-sm opacity-90">Total Goals</p>
              <p className="text-3xl font-display tracking-tight">{goals.length}</p>
            </div>
            <div className="bg-white/20 p-2 rounded-lg">
              <Target className="w-5 h-5" />
            </div>
          </div>
          <p className="text-sm opacity-75">Active financial targets</p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="bg-gradient-to-br from-secondary to-secondary/80 text-white rounded-[var(--radius)] p-6 shadow-lg"
        >
          <div className="flex items-start justify-between mb-4">
            <div className="space-y-1">
              <p className="text-sm opacity-90">Overall Progress</p>
              <p className="text-3xl font-display tracking-tight">{overallProgress}%</p>
            </div>
            <div className="bg-white/20 p-2 rounded-lg">
              <TrendingUp className="w-5 h-5" />
            </div>
          </div>
          <p className="text-sm opacity-75">Across all goals</p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="bg-card border border-border rounded-[var(--radius)] p-6"
        >
          <div className="flex items-start justify-between mb-4">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Total Saved</p>
              <p className="text-3xl font-display tracking-tight">${totalCurrentAmount.toLocaleString()}</p>
            </div>
            <div className="bg-accent/10 p-2 rounded-lg">
              <TrendingUp className="w-5 h-5 text-accent" />
            </div>
          </div>
          <p className="text-sm text-muted-foreground">of ${totalTargetAmount.toLocaleString()}</p>
        </motion.div>
      </div>

      {/* Goals List */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {goals.map((goal, index) => {
          const progress = (goal.current / goal.target) * 100;
          const remaining = goal.target - goal.current;
          const daysLeft = differenceInDays(new Date(goal.deadline), new Date());
          const monthlyRequired = daysLeft > 0 ? (remaining / (daysLeft / 30)).toFixed(2) : '0';

          return (
            <motion.div
              key={goal.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.4 + (index * 0.1) }}
              className="bg-card border border-border rounded-[var(--radius)] p-6 shadow-sm hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-gradient-to-br from-primary/10 to-primary/5 rounded-xl flex items-center justify-center text-2xl">
                    {getIconComponent(goal.icon)}
                  </div>
                  <div>
                    <h4 className="font-display">{goal.name}</h4>
                    <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                      <Calendar className="w-3 h-3" />
                      <span>
                        {daysLeft > 0
                          ? `${daysLeft} days left`
                          : daysLeft === 0
                          ? 'Due today'
                          : `${Math.abs(daysLeft)} days overdue`}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-display text-primary">{progress.toFixed(0)}%</p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="relative h-3 bg-muted rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min(progress, 100)}%` }}
                    transition={{ duration: 1, delay: 0.5 + (index * 0.1), ease: 'easeOut' }}
                    className="absolute top-0 left-0 h-full rounded-full bg-gradient-to-r from-primary to-primary/80"
                  />
                </div>

                <div className="flex items-center justify-between text-sm">
                  <div>
                    <p className="text-muted-foreground">Current</p>
                    <p className="font-display text-lg">${goal.current.toLocaleString()}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-muted-foreground">Remaining</p>
                    <p className="font-display text-lg text-accent">${remaining.toLocaleString()}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-muted-foreground">Target</p>
                    <p className="font-display text-lg">${goal.target.toLocaleString()}</p>
                  </div>
                </div>

                <div className="pt-4 border-t border-border">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Monthly target to reach goal:</span>
                    <span className="font-display text-primary">${monthlyRequired}</span>
                  </div>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Tips */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.8 }}
        className="bg-gradient-to-br from-secondary/10 to-secondary/5 border border-secondary/20 rounded-[var(--radius)] p-6"
      >
        <div className="flex items-start gap-3 mb-4">
          <div className="bg-secondary/20 p-2 rounded-lg">
            <Target className="w-5 h-5 text-secondary" />
          </div>
          <div>
            <h4 className="font-display mb-1">Goal Setting Tips</h4>
            <p className="text-sm text-muted-foreground">Make your financial dreams a reality</p>
          </div>
        </div>
        <ul className="space-y-2 text-sm">
          <li className="flex items-start gap-2">
            <span className="text-secondary mt-1">•</span>
            <span>Break large goals into smaller milestones to stay motivated and track progress more effectively.</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-secondary mt-1">•</span>
            <span>Automate your savings by setting up automatic transfers to your goal accounts each month.</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-secondary mt-1">•</span>
            <span>Review and adjust your goals quarterly to ensure they remain realistic and aligned with your priorities.</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-secondary mt-1">•</span>
            <span>You're on track to complete {goals.filter(g => g.current / g.target >= 0.5).length} goal{goals.filter(g => g.current / g.target >= 0.5).length !== 1 ? 's' : ''} ahead of schedule!</span>
          </li>
        </ul>
      </motion.div>
    </div>
  );
}
