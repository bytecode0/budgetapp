import { useState } from 'react';
import { Plus, Filter, Search, Calendar, DollarSign } from 'lucide-react';
import { transactions, categoryColors } from '../data/mockData';
import { motion } from 'motion/react';

export function Expenses() {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  const categories = ['all', ...Array.from(new Set(transactions.map(t => t.category)))];

  const filteredTransactions = transactions.filter(t => {
    const matchesSearch = t.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         t.category.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === 'all' || t.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const totalExpenses = Math.abs(
    filteredTransactions
      .filter(t => t.type === 'expense')
      .reduce((sum, t) => sum + t.amount, 0)
  );

  const totalIncome = filteredTransactions
    .filter(t => t.type === 'income')
    .reduce((sum, t) => sum + t.amount, 0);

  return (
    <div className="space-y-6 pb-8">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="flex items-start justify-between"
      >
        <div className="space-y-2">
          <h1 className="text-4xl tracking-tight">Transactions</h1>
          <p className="text-muted-foreground">Track and manage all your expenses</p>
        </div>
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          className="bg-primary text-primary-foreground px-6 py-3 rounded-full flex items-center gap-2 shadow-lg hover:shadow-xl transition-shadow"
        >
          <Plus className="w-5 h-5" />
          <span className="font-display">Add Expense</span>
        </motion.button>
      </motion.div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="bg-card border border-border rounded-[var(--radius)] p-6"
        >
          <div className="flex items-center gap-3 mb-2">
            <div className="bg-destructive/10 p-2 rounded-lg">
              <DollarSign className="w-5 h-5 text-destructive" />
            </div>
            <p className="text-sm text-muted-foreground">Total Expenses</p>
          </div>
          <p className="text-3xl font-display tracking-tight">${totalExpenses.toLocaleString()}</p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="bg-card border border-border rounded-[var(--radius)] p-6"
        >
          <div className="flex items-center gap-3 mb-2">
            <div className="bg-secondary/10 p-2 rounded-lg">
              <DollarSign className="w-5 h-5 text-secondary" />
            </div>
            <p className="text-sm text-muted-foreground">Total Income</p>
          </div>
          <p className="text-3xl font-display tracking-tight">${totalIncome.toLocaleString()}</p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="bg-card border border-border rounded-[var(--radius)] p-6"
        >
          <div className="flex items-center gap-3 mb-2">
            <div className="bg-primary/10 p-2 rounded-lg">
              <Calendar className="w-5 h-5 text-primary" />
            </div>
            <p className="text-sm text-muted-foreground">Transactions</p>
          </div>
          <p className="text-3xl font-display tracking-tight">{filteredTransactions.length}</p>
        </motion.div>
      </div>

      {/* Filters */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5, delay: 0.4 }}
        className="bg-card border border-border rounded-[var(--radius)] p-4"
      >
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search transactions..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
          <div className="flex items-center gap-2">
            <Filter className="w-5 h-5 text-muted-foreground" />
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="px-4 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              {categories.map(cat => (
                <option key={cat} value={cat}>
                  {cat === 'all' ? 'All Categories' : cat}
                </option>
              ))}
            </select>
          </div>
        </div>
      </motion.div>

      {/* Transactions List */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.5 }}
        className="bg-card border border-border rounded-[var(--radius)] overflow-hidden"
      >
        <div className="divide-y divide-border">
          {filteredTransactions.map((transaction, index) => (
            <motion.div
              key={transaction.id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.3, delay: 0.6 + (index * 0.03) }}
              className="p-4 hover:bg-muted/30 transition-colors cursor-pointer"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div
                    className="w-12 h-12 rounded-xl flex items-center justify-center text-white font-display shadow-md"
                    style={{ backgroundColor: categoryColors[transaction.category] || '#6B7280' }}
                  >
                    {transaction.category.slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <p className="font-display">{transaction.description}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span
                        className="px-2 py-0.5 rounded-full text-xs"
                        style={{
                          backgroundColor: `${categoryColors[transaction.category] || '#6B7280'}20`,
                          color: categoryColors[transaction.category] || '#6B7280'
                        }}
                      >
                        {transaction.category}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(transaction.date).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric'
                        })}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <p
                    className={`text-xl font-display ${
                      transaction.type === 'income' ? 'text-secondary' : 'text-foreground'
                    }`}
                  >
                    {transaction.type === 'income' ? '+' : ''}
                    ${Math.abs(transaction.amount).toLocaleString()}
                  </p>
                  <p className="text-xs text-muted-foreground capitalize mt-1">{transaction.type}</p>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </motion.div>

      {filteredTransactions.length === 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-center py-12 text-muted-foreground"
        >
          <p>No transactions found matching your criteria</p>
        </motion.div>
      )}
    </div>
  );
}
