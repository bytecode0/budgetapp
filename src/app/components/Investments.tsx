import { TrendingUp, TrendingDown, PieChart as PieChartIcon, DollarSign } from 'lucide-react';
import { investments } from '../data/mockData';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { motion } from 'motion/react';

export function Investments() {
  const totalValue = investments.reduce((sum, inv) => sum + inv.value, 0);
  const totalChange = investments.reduce((sum, inv) => sum + inv.change, 0);
  const totalChangePercent = ((totalChange / (totalValue - totalChange)) * 100).toFixed(2);

  const portfolioData = investments.map(inv => ({
    name: inv.name,
    value: inv.value,
  }));

  const COLORS = ['#1E3A8A', '#10B981', '#F59E0B', '#3B82F6', '#8B5CF6'];

  return (
    <div className="space-y-6 pb-8">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="space-y-2"
      >
        <h1 className="text-4xl tracking-tight">Investments</h1>
        <p className="text-muted-foreground">Track your portfolio performance and asset allocation</p>
      </motion.div>

      {/* Portfolio Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="bg-gradient-to-br from-primary to-primary/80 text-primary-foreground rounded-[var(--radius)] p-6 shadow-lg"
        >
          <div className="flex items-start justify-between mb-4">
            <div className="space-y-1">
              <p className="text-sm opacity-90">Total Portfolio Value</p>
              <p className="text-3xl font-display tracking-tight">${totalValue.toLocaleString()}</p>
            </div>
            <div className="bg-white/20 p-2 rounded-lg">
              <DollarSign className="w-5 h-5" />
            </div>
          </div>
          <p className="text-sm opacity-75">Across {investments.length} investments</p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className={`rounded-[var(--radius)] p-6 shadow-lg ${
            totalChange >= 0
              ? 'bg-gradient-to-br from-secondary to-secondary/80 text-white'
              : 'bg-gradient-to-br from-destructive to-destructive/80 text-white'
          }`}
        >
          <div className="flex items-start justify-between mb-4">
            <div className="space-y-1">
              <p className="text-sm opacity-90">Total Gain/Loss</p>
              <p className="text-3xl font-display tracking-tight">
                {totalChange >= 0 ? '+' : ''}${totalChange.toLocaleString()}
              </p>
            </div>
            <div className="bg-white/20 p-2 rounded-lg">
              {totalChange >= 0 ? (
                <TrendingUp className="w-5 h-5" />
              ) : (
                <TrendingDown className="w-5 h-5" />
              )}
            </div>
          </div>
          <p className="text-sm opacity-75">
            {totalChange >= 0 ? '+' : ''}{totalChangePercent}% overall return
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="bg-card border border-border rounded-[var(--radius)] p-6"
        >
          <div className="flex items-start justify-between mb-4">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Best Performer</p>
              <p className="text-xl font-display tracking-tight">
                {investments.reduce((max, inv) => inv.changePercent > max.changePercent ? inv : max).name.split(' ')[0]}
              </p>
            </div>
            <div className="bg-secondary/10 p-2 rounded-lg">
              <TrendingUp className="w-5 h-5 text-secondary" />
            </div>
          </div>
          <p className="text-sm text-secondary">
            +{investments.reduce((max, inv) => inv.changePercent > max.changePercent ? inv : max).changePercent.toFixed(2)}%
          </p>
        </motion.div>
      </div>

      {/* Asset Allocation & Holdings */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, delay: 0.4 }}
          className="bg-card border border-border rounded-[var(--radius)] p-6"
        >
          <div className="flex items-center gap-2 mb-6">
            <PieChartIcon className="w-5 h-5 text-primary" />
            <h3>Asset Allocation</h3>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={portfolioData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name.split(' ')[0]} ${(percent * 100).toFixed(0)}%`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {portfolioData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value: number) => `$${value.toLocaleString()}`}
                  contentStyle={{
                    backgroundColor: 'var(--card)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)'
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="grid grid-cols-2 gap-3 mt-4">
            {investments.map((inv, index) => (
              <div key={inv.name} className="flex items-center gap-2">
                <div
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: COLORS[index % COLORS.length] }}
                />
                <span className="text-xs text-muted-foreground">{inv.type}</span>
              </div>
            ))}
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, delay: 0.5 }}
          className="bg-card border border-border rounded-[var(--radius)] p-6"
        >
          <h3 className="mb-6">Holdings</h3>
          <div className="space-y-4">
            {investments.map((investment, index) => (
              <motion.div
                key={investment.name}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.6 + (index * 0.1) }}
                className="p-4 bg-muted/30 rounded-lg hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className="font-display">{investment.name}</p>
                    <p className="text-xs text-muted-foreground mt-1">{investment.type}</p>
                  </div>
                  <div
                    className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs ${
                      investment.change >= 0
                        ? 'bg-secondary/10 text-secondary'
                        : 'bg-destructive/10 text-destructive'
                    }`}
                  >
                    {investment.change >= 0 ? (
                      <TrendingUp className="w-3 h-3" />
                    ) : (
                      <TrendingDown className="w-3 h-3" />
                    )}
                    {investment.changePercent >= 0 ? '+' : ''}
                    {investment.changePercent.toFixed(2)}%
                  </div>
                </div>
                <div className="flex items-end justify-between">
                  <div>
                    <p className="text-2xl font-display tracking-tight">
                      ${investment.value.toLocaleString()}
                    </p>
                    <p className={`text-sm mt-1 ${investment.change >= 0 ? 'text-secondary' : 'text-destructive'}`}>
                      {investment.change >= 0 ? '+' : ''}${investment.change.toLocaleString()}
                    </p>
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    {((investment.value / totalValue) * 100).toFixed(1)}% of portfolio
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </div>

      {/* Investment Insights */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.9 }}
        className="bg-gradient-to-br from-primary/5 to-primary/10 border border-primary/20 rounded-[var(--radius)] p-6"
      >
        <div className="flex items-start gap-3 mb-4">
          <div className="bg-primary/20 p-2 rounded-lg">
            <TrendingUp className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h4 className="font-display mb-1">Investment Insights</h4>
            <p className="text-sm text-muted-foreground">Portfolio analysis and recommendations</p>
          </div>
        </div>
        <ul className="space-y-2 text-sm">
          <li className="flex items-start gap-2">
            <span className="text-primary mt-1">•</span>
            <span>Your portfolio is well-diversified across different asset types. Consider rebalancing if any single asset exceeds 50% of your portfolio.</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-primary mt-1">•</span>
            <span>S&P 500 Index Fund is performing strongly with a {investments[0].changePercent.toFixed(2)}% gain. This represents {((investments[0].value / totalValue) * 100).toFixed(0)}% of your total portfolio.</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-primary mt-1">•</span>
            <span>Consider dollar-cost averaging to reduce market timing risk and build wealth consistently over time.</span>
          </li>
        </ul>
      </motion.div>
    </div>
  );
}
