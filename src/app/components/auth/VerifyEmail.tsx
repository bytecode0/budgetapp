import { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Mail, ArrowLeft, Target } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';

interface VerifyEmailProps {
  email: string;
  onVerified: () => void;
  onBack: () => void;
}

export function VerifyEmail({ email, onVerified, onBack }: VerifyEmailProps) {
  const { t } = useTranslation();
  const { refreshUser } = useAuth();
  const [otp, setOtp] = useState(['', '', '', '', '']);
  const [isLoading, setIsLoading] = useState(false);
  const [timer, setTimer] = useState(60);
  const [timerActive, setTimerActive] = useState(true);

  useEffect(() => {
    if (!timerActive) return;
    if (timer <= 0) { setTimerActive(false); return; }
    const id = setTimeout(() => setTimer((t) => t - 1), 1000);
    return () => clearTimeout(id);
  }, [timer, timerActive]);

  const startTimer = () => { setTimer(60); setTimerActive(true); };

  const handleOtpChange = (index: number, value: string) => {
    if (value.length <= 1 && /^\d*$/.test(value)) {
      const newOtp = [...otp];
      newOtp[index] = value;
      setOtp(newOtp);
      if (value && index < 4) {
        document.getElementById(`verify-otp-${index + 1}`)?.focus();
      }
    }
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      document.getElementById(`verify-otp-${index - 1}`)?.focus();
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = otp.join('');
    if (code.length < 5) return;
    setIsLoading(true);
    try {
      const res = await fetch('/api/auth/verify-email', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp: code }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Verification failed');
        return;
      }
      toast.success('Email verified! Welcome to LifePlan!');
      onVerified();
    } catch {
      toast.error('Something went wrong. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleResend = async () => {
    if (timerActive) return;
    try {
      const res = await fetch('/api/auth/resend-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, type: 'email_verification' }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Could not resend code');
        return;
      }
      toast.success('New verification code sent!');
      setOtp(['', '', '', '', '']);
      startTimer();
    } catch {
      toast.error('Something went wrong');
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <motion.button
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.4 }}
          onClick={onBack}
          className="flex items-center gap-2 text-muted-foreground hover:text-foreground mb-8 transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
          <span className="text-sm">{t('auth.verifyEmail.back')}</span>
        </motion.button>

        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-center mb-8"
        >
          <div className="flex justify-center mb-4">
            <div className="w-16 h-16 bg-gradient-to-br from-primary/10 to-secondary/10 border-2 border-primary/20 rounded-2xl flex items-center justify-center">
              <Mail className="w-8 h-8 text-primary" />
            </div>
          </div>
          <h1 className="text-3xl font-display text-primary mb-2">{t('auth.verifyEmail.title')}</h1>
          <p className="text-muted-foreground">
            {t('auth.verifyEmail.sentCodeTo')}{' '}
            <span className="font-display text-foreground">{email}</span>
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="bg-card border border-border rounded-3xl p-8 shadow-lg"
        >
          <form onSubmit={handleVerify} className="space-y-6">
            <div>
              <label className="block text-sm font-display mb-4 text-center">{t('auth.verifyEmail.enterCode')}</label>
              <div className="flex gap-3 justify-center">
                {otp.map((digit, index) => (
                  <input
                    key={index}
                    id={`verify-otp-${index}`}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleOtpChange(index, e.target.value)}
                    onKeyDown={(e) => handleOtpKeyDown(index, e)}
                    className="w-14 h-16 text-center text-2xl font-bold rounded-xl border-2 bg-background transition-all focus:outline-none"
                    style={{
                      borderColor: digit ? 'var(--color-primary)' : 'var(--color-border)',
                      color: 'var(--color-foreground)',
                    }}
                  />
                ))}
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading || otp.join('').length < 5}
              className="w-full py-3 bg-gradient-to-r from-primary to-secondary text-white rounded-xl font-display hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? t('auth.verifyEmail.verifying') : t('auth.verifyEmail.verifyEmail')}
            </button>
          </form>

          <div className="text-center mt-5 space-y-2">
            <p className="text-sm text-muted-foreground">
              {t('auth.verifyEmail.didntReceive')}{' '}
              <button
                type="button"
                onClick={handleResend}
                disabled={timerActive}
                className="font-display text-primary disabled:opacity-40 hover:text-primary/80 transition-colors"
              >
                {t('auth.verifyEmail.resendCode')}
              </button>
            </p>
            {timerActive && (
              <p className="text-xs text-muted-foreground">
                {t('auth.verifyEmail.resendAvailableIn')} 0:{timer.toString().padStart(2, '0')}
              </p>
            )}
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="mt-6 bg-gradient-to-br from-secondary/10 to-primary/10 border border-primary/20 rounded-2xl p-4 flex items-center gap-3"
        >
          <div className="w-10 h-10 bg-gradient-to-br from-primary to-secondary rounded-lg flex items-center justify-center flex-shrink-0">
            <Target className="w-5 h-5 text-white" />
          </div>
          <p className="text-sm text-muted-foreground">
            {t('auth.verifyEmail.tagline')}
          </p>
        </motion.div>
      </div>
    </div>
  );
}
