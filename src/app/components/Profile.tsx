import { User, Bell, Moon, Sun, Shield, HelpCircle, LogOut, ChevronRight } from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';

export function Profile({ darkMode, onToggleDarkMode }: { darkMode: boolean; onToggleDarkMode: () => void }) {
  const [notifications, setNotifications] = useState({
    email: true,
    push: true,
    budgetAlerts: true,
    goalReminders: true,
  });

  const settingsSections = [
    {
      title: 'Account',
      items: [
        { icon: User, label: 'Personal Information', value: 'Update profile details' },
        { icon: Shield, label: 'Security & Privacy', value: 'Manage your security settings' },
      ],
    },
    {
      title: 'Notifications',
      items: [
        { icon: Bell, label: 'Budget Alerts', toggle: true, value: notifications.budgetAlerts, key: 'budgetAlerts' },
        { icon: Bell, label: 'Goal Reminders', toggle: true, value: notifications.goalReminders, key: 'goalReminders' },
        { icon: Bell, label: 'Email Notifications', toggle: true, value: notifications.email, key: 'email' },
        { icon: Bell, label: 'Push Notifications', toggle: true, value: notifications.push, key: 'push' },
      ],
    },
    {
      title: 'Support',
      items: [
        { icon: HelpCircle, label: 'Help Center', value: 'Get support and tutorials' },
      ],
    },
  ];

  const handleToggle = (key: string) => {
    setNotifications(prev => ({ ...prev, [key]: !prev[key as keyof typeof prev] }));
  };

  return (
    <div className="space-y-6 pb-8">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="space-y-2"
      >
        <h1 className="text-4xl tracking-tight">Profile & Settings</h1>
        <p className="text-muted-foreground">Manage your account and preferences</p>
      </motion.div>

      {/* Profile Card */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1 }}
        className="bg-gradient-to-br from-primary to-primary/80 text-primary-foreground rounded-[var(--radius)] p-8 shadow-lg"
      >
        <div className="flex items-center gap-6">
          <div className="w-20 h-20 bg-white/20 rounded-full flex items-center justify-center backdrop-blur-sm">
            <User className="w-10 h-10" />
          </div>
          <div className="flex-1">
            <h2 className="text-2xl font-display mb-1">Sarah Anderson</h2>
            <p className="text-sm opacity-90 mb-3">sarah.anderson@email.com</p>
            <div className="flex items-center gap-4 text-sm">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-secondary rounded-full" />
                <span className="opacity-90">Premium Member</span>
              </div>
              <span className="opacity-60">•</span>
              <span className="opacity-90">Member since Jan 2025</span>
            </div>
          </div>
          <button className="px-4 py-2 bg-white/20 hover:bg-white/30 rounded-lg transition-colors backdrop-blur-sm">
            Edit Profile
          </button>
        </div>
      </motion.div>

      {/* Appearance */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.2 }}
        className="bg-card border border-border rounded-[var(--radius)] p-6"
      >
        <h3 className="mb-4">Appearance</h3>
        <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg">
          <div className="flex items-center gap-3">
            {darkMode ? (
              <Moon className="w-5 h-5 text-primary" />
            ) : (
              <Sun className="w-5 h-5 text-accent" />
            )}
            <div>
              <p className="font-display">Dark Mode</p>
              <p className="text-sm text-muted-foreground">
                {darkMode ? 'Currently using dark theme' : 'Currently using light theme'}
              </p>
            </div>
          </div>
          <button
            onClick={onToggleDarkMode}
            className={`relative w-14 h-7 rounded-full transition-colors ${
              darkMode ? 'bg-primary' : 'bg-muted'
            }`}
          >
            <motion.div
              animate={{ x: darkMode ? 28 : 2 }}
              transition={{ type: 'spring', stiffness: 500, damping: 30 }}
              className="absolute top-1 w-5 h-5 bg-white rounded-full shadow-md"
            />
          </button>
        </div>
      </motion.div>

      {/* Settings Sections */}
      {settingsSections.map((section, sectionIndex) => (
        <motion.div
          key={section.title}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 + (sectionIndex * 0.1) }}
          className="bg-card border border-border rounded-[var(--radius)] overflow-hidden"
        >
          <div className="px-6 py-4 border-b border-border">
            <h3 className="text-sm uppercase tracking-wide text-muted-foreground">{section.title}</h3>
          </div>
          <div className="divide-y divide-border">
            {section.items.map((item, itemIndex) => (
              <motion.div
                key={item.label}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3, delay: 0.4 + (sectionIndex * 0.1) + (itemIndex * 0.05) }}
                className="p-4 hover:bg-muted/30 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                      <item.icon className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-display">{item.label}</p>
                      {!item.toggle && (
                        <p className="text-sm text-muted-foreground mt-0.5">{item.value}</p>
                      )}
                    </div>
                  </div>
                  {item.toggle ? (
                    <button
                      onClick={() => handleToggle(item.key!)}
                      className={`relative w-14 h-7 rounded-full transition-colors ${
                        item.value ? 'bg-primary' : 'bg-muted'
                      }`}
                    >
                      <motion.div
                        animate={{ x: item.value ? 28 : 2 }}
                        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                        className="absolute top-1 w-5 h-5 bg-white rounded-full shadow-md"
                      />
                    </button>
                  ) : (
                    <ChevronRight className="w-5 h-5 text-muted-foreground" />
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>
      ))}

      {/* Danger Zone */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.7 }}
        className="bg-card border border-destructive/20 rounded-[var(--radius)] p-6"
      >
        <h3 className="text-destructive mb-4">Danger Zone</h3>
        <button className="w-full flex items-center justify-between p-4 bg-destructive/5 hover:bg-destructive/10 rounded-lg transition-colors group">
          <div className="flex items-center gap-3">
            <LogOut className="w-5 h-5 text-destructive" />
            <div className="text-left">
              <p className="font-display text-destructive">Sign Out</p>
              <p className="text-sm text-muted-foreground">Sign out of your account</p>
            </div>
          </div>
          <ChevronRight className="w-5 h-5 text-destructive group-hover:translate-x-1 transition-transform" />
        </button>
      </motion.div>
    </div>
  );
}
