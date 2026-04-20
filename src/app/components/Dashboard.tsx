import { TrendingUp, TrendingDown, Sparkles } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { transactions, budgets, categoryColors, monthlyData } from '../data/mockData';
import { motion } from 'motion/react';

export function Dashboard() {
  const totalIncome = transactions
    .filter(t => t.type === 'income')
    .reduce((sum, t) => sum + t.amount, 0);

  const totalExpenses = Math.abs(
    transactions
      .filter(t => t.type === 'expense')
      .reduce((sum, t) => sum + t.amount, 0)
  );

  const balance = totalIncome - totalExpenses;
  const savingsRate = ((balance / totalIncome) * 100).toFixed(1);

  const expenseByCategory = budgets.map(b => ({
    name: b.category,
    value: b.spent,
    color: categoryColors[b.category] || '#6B7280'
  }));

  const recentTransactions = transactions.slice(0, 5);

  return (
    <div className="space-y-6 pb-8">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="space-y-2"
      >
        <h1 className="text-4xl tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">Welcome back! Here's your financial overview.</p>
      </motion.div>

      {/* Balance Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="bg-gradient-to-br from-primary to-primary/80 text-primary-foreground rounded-[var(--radius)] p-6 shadow-lg"
        >
          <div className="flex items-start justify-between mb-4">
            <div className="space-y-1">
              <p className="text-sm opacity-90">Monthly Balance</p>
              <p className="text-3xl font-display tracking-tight">${balance.toLocaleString()}</p>
            </div>
            <div className="bg-white/20 p-2 rounded-lg">
              <TrendingUp className="w-5 h-5" />
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="opacity-90">Income: ${totalIncome.toLocaleString()}</span>
            <span className="opacity-60">•</span>
            <span className="opacity-90">Expenses: ${totalExpenses.toLocaleString()}</span>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="bg-gradient-to-br from-secondary to-secondary/80 text-white rounded-[var(--radius)] p-6 shadow-lg"
        >
          <div className="flex items-start justify-between mb-4">
            <div className="space-y-1">
              <p className="text-sm opacity-90">Savings Rate</p>
              <p className="text-3xl font-display tracking-tight">{savingsRate}%</p>
            </div>
            <div className="bg-white/20 p-2 rounded-lg">
              <TrendingUp className="w-5 h-5" />
            </div>
          </div>
          <p className="text-sm opacity-90">You're saving ${balance.toLocaleString()} this month</p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="bg-card border border-border rounded-[var(--radius)] p-6 shadow-sm"
        >
          <div className="flex items-start justify-between mb-4">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Top Category</p>
              <p className="text-2xl font-display tracking-tight">{expenseByCategory[0]?.name}</p>
            </div>
            <div className="bg-accent/10 p-2 rounded-lg">
              <Sparkles className="w-5 h-5 text-accent" />
            </div>
          </div>
          <p className="text-sm text-muted-foreground">${expenseByCategory[0]?.value.toFixed(2)} spent</p>
        </motion.div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, delay: 0.4 }}
          className="bg-card border border-border rounded-[var(--radius)] p-6 shadow-sm"
        >
          <h3 className="mb-6">Expense Breakdown</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={expenseByCategory}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {expenseByCategory.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, delay: 0.5 }}
          className="bg-card border border-border rounded-[var(--radius)] p-6 shadow-sm"
        >
          <h3 className="mb-6">Income vs Expenses</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="month" stroke="var(--muted-foreground)" />
                <YAxis stroke="var(--muted-foreground)" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--card)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)'
                  }}
                />
                <Legend />
                <Bar dataKey="income" fill="var(--secondary)" radius={[8, 8, 0, 0]} />
                <Bar dataKey="expenses" fill="var(--accent)" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </motion.div>
      </div>

      {/* Smart Insights & Recent Transactions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.6 }}
          className="bg-gradient-to-br from-accent/10 to-accent/5 border border-accent/20 rounded-[var(--radius)] p-6"
        >
          <div className="flex items-start gap-3 mb-3">
            <div className="bg-accent/20 p-2 rounded-lg">
              <Sparkles className="w-5 h-5 text-accent" />
            </div>
            <div>
              <h4 className="font-display mb-1">Smart Insight</h4>
              <p className="text-sm text-muted-foreground">Based on your spending patterns</p>
            </div>
          </div>
          <p className="text-sm leading-relaxed">
            You spent <strong className="text-accent">37% more</strong> on shopping this month compared to your budget.
            Consider reducing non-essential purchases to meet your savings goals.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.7 }}
          className="lg:col-span-2 bg-card border border-border rounded-[var(--radius)] p-6 shadow-sm"
        >
          <h3 className="mb-4">Recent Transactions</h3>
          <div className="space-y-3">
            {recentTransactions.map((transaction, index) => (
              <motion.div
                key={transaction.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3, delay: 0.8 + (index * 0.05) }}
                className="flex items-center justify-between p-3 rounded-lg hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-display"
                    style={{ backgroundColor: categoryColors[transaction.category] || '#6B7280' }}
                  >
                    {transaction.category.slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <p className="font-display text-sm">{transaction.description}</p>
                    <p className="text-xs text-muted-foreground">{transaction.category} • {new Date(transaction.date).toLocaleDateString()}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <p className={`font-display ${transaction.type === 'income' ? 'text-secondary' : 'text-foreground'}`}>
                    {transaction.type === 'income' ? '+' : ''}{transaction.amount < 0 ? transaction.amount : `+${transaction.amount}`}
                  </p>
                  {transaction.type === 'income' ? (
                    <TrendingUp className="w-4 h-4 text-secondary" />
                  ) : (
                    <TrendingDown className="w-4 h-4 text-muted-foreground" />
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </div>
    </div>
  );
}
