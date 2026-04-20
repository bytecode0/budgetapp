import { useEffect } from 'react';
import { motion } from 'motion/react';
import { Target, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface GoogleCallbackProps {
  token: string;
  onSuccess: () => void;
  onError: (error: string) => void;
}

export function GoogleCallback({ token, onSuccess, onError }: GoogleCallbackProps) {
  useEffect(() => {
    if (!token) {
      onError('google_failed');
      return;
    }

    fetch('/api/auth/google/exchange', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).error ?? 'Exchange failed');
        // JWT cookie is set — parent will call refreshUser via onSuccess
        onSuccess();
      })
      .catch(() => {
        toast.error('Google sign-in failed. Please try again.');
        onError('google_failed');
      });
  }, [token]);

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-6">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4 }}
        className="text-center"
      >
        <div className="w-16 h-16 bg-gradient-to-br from-primary to-secondary rounded-2xl flex items-center justify-center shadow-lg mx-auto mb-4">
          <Target className="w-9 h-9 text-white" />
        </div>
        <h2 className="text-xl font-display text-primary mb-2">LifePlan</h2>
        <Loader2 className="w-6 h-6 animate-spin text-primary mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">Signing you in...</p>
      </motion.div>
    </div>
  );
}
