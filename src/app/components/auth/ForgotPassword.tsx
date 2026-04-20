import { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Mail, ArrowLeft, Lock, Eye, EyeOff, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';

interface ForgotPasswordProps {
  onBack: () => void;
}

export function ForgotPassword({ onBack }: ForgotPasswordProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState(['', '', '', '', '']);
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [timer, setTimer] = useState(60);
  const [timerActive, setTimerActive] = useState(false);

  useEffect(() => {
    if (!timerActive) return;
    if (timer <= 0) { setTimerActive(false); return; }
    const id = setTimeout(() => setTimer((t) => t - 1), 1000);
    return () => clearTimeout(id);
  }, [timer, timerActive]);

  const startTimer = () => { setTimer(60); setTimerActive(true); };

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const res = await fetch('/api/auth/send-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || 'Could not send reset code'); return; }
      toast.success('Reset code sent to your email!');
      startTimer();
      setStep(2);
    } catch {
      toast.error('Something went wrong. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (otp.join('').length < 5) return;
    setIsLoading(true);
    try {
      const res = await fetch('/api/auth/verify-reset-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp: otp.join('') }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || 'Verification failed'); return; }
      setResetToken(data.resetToken);
      toast.success('Code verified!');
      setStep(3);
    } catch {
      toast.error('Something went wrong. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendOtp = async () => {
    if (timerActive) return;
    try {
      const res = await fetch('/api/auth/resend-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, type: 'password_reset' }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || 'Could not resend code'); return; }
      toast.success('New code sent!');
      setOtp(['', '', '', '', '']);
      startTimer();
    } catch {
      toast.error('Something went wrong');
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) { toast.error("Passwords don't match"); return; }
    if (newPassword.length < 8) { toast.error('Password must be at least 8 characters'); return; }
    setIsLoading(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resetToken, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || 'Could not reset password'); return; }
      toast.success('Password updated successfully!');
      setStep(4);
    } catch {
      toast.error('Something went wrong. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleOtpChange = (index: number, value: string) => {
    if (value.length <= 1 && /^\d*$/.test(value)) {
      const newOtp = [...otp];
      newOtp[index] = value;
      setOtp(newOtp);
      if (value && index < 4) document.getElementById(`reset-otp-${index + 1}`)?.focus();
    }
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      document.getElementById(`reset-otp-${index - 1}`)?.focus();
    }
  };

  const getPasswordStrength = (password: string) => {
    if (password.length === 0) return 0;
    if (password.length < 6) return 1;
    if (password.length < 10) return 2;
    if (password.length < 12) return 3;
    return 4;
  };

  const strength = getPasswordStrength(newPassword);
  const strengthColors = ['#EF4444', '#EF4444', '#F59E0B', '#10B981'];
  const passwordsMatch = newPassword === confirmPassword && newPassword.length > 0;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {step !== 4 && (
          <motion.button
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.4 }}
            onClick={() => step === 1 ? onBack() : setStep((s) => Math.max(1, s - 1) as any)}
            className="flex items-center gap-2 text-muted-foreground hover:text-foreground mb-8 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
            <span className="text-sm">{step === 1 ? t('auth.forgotPassword.backToLogin') : t('auth.forgotPassword.back')}</span>
          </motion.button>
        )}

        {/* Step 1: Email */}
        {step === 1 && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            <div className="text-center mb-8">
              <div className="flex justify-center mb-4">
                <div className="w-16 h-16 bg-gradient-to-br from-primary/10 to-secondary/10 border-2 border-primary/20 rounded-2xl flex items-center justify-center">
                  <Lock className="w-8 h-8 text-primary" />
                </div>
              </div>
              <h1 className="text-3xl font-display text-primary mb-2">{t('auth.forgotPassword.title')}</h1>
              <p className="text-muted-foreground">{t('auth.forgotPassword.subtitle')}</p>
            </div>

            <div className="bg-card border border-border rounded-3xl p-8 shadow-lg">
              <form onSubmit={handleSendCode} className="space-y-5">
                <div>
                  <label className="block text-sm font-display mb-2">{t('auth.forgotPassword.email')}</label>
                  <div className="relative">
                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      required
                      className="w-full pl-12 pr-4 py-3 bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full py-3 bg-gradient-to-r from-primary to-secondary text-white rounded-xl font-display hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isLoading ? t('auth.forgotPassword.sending') : t('auth.forgotPassword.sendCode')}
                </button>
              </form>
              <p className="text-center text-sm text-muted-foreground mt-6">
                {t('auth.forgotPassword.rememberIt')}{' '}
                <button onClick={onBack} className="text-primary hover:text-primary/80 font-display transition-colors">
                  {t('auth.forgotPassword.signIn')}
                </button>
              </p>
            </div>
          </motion.div>
        )}

        {/* Step 2: OTP */}
        {step === 2 && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            <div className="text-center mb-8">
              <div className="flex justify-center mb-4">
                <div className="w-16 h-16 bg-gradient-to-br from-primary/10 to-secondary/10 border-2 border-primary/20 rounded-2xl flex items-center justify-center">
                  <Mail className="w-8 h-8 text-primary" />
                </div>
              </div>
              <h1 className="text-3xl font-display text-primary mb-2">{t('auth.forgotPassword.checkInbox')}</h1>
              <p className="text-muted-foreground">
                {t('auth.forgotPassword.sentCodeTo')} <span className="font-display text-foreground">{email}</span>
              </p>
            </div>

            <div className="bg-card border border-border rounded-3xl p-8 shadow-lg">
              <form onSubmit={handleVerifyOtp} className="space-y-6">
                <div className="flex gap-3 justify-center">
                  {otp.map((digit, index) => (
                    <input
                      key={index}
                      id={`reset-otp-${index}`}
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
                <button
                  type="submit"
                  disabled={isLoading || otp.join('').length < 5}
                  className="w-full py-3 bg-gradient-to-r from-primary to-secondary text-white rounded-xl font-display hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isLoading ? t('auth.forgotPassword.verifying') : t('auth.forgotPassword.verifyCode')}
                </button>
              </form>
              <div className="text-center mt-5 space-y-2">
                <p className="text-sm text-muted-foreground">
                  {t('auth.forgotPassword.didntReceive')}{' '}
                  <button
                    onClick={handleResendOtp}
                    disabled={timerActive}
                    className="font-display text-primary disabled:opacity-40 hover:text-primary/80 transition-colors"
                  >
                    {t('auth.forgotPassword.resendCode')}
                  </button>
                </p>
                {timerActive && (
                  <p className="text-xs text-muted-foreground">
                    {t('auth.forgotPassword.resendAvailableIn')} 0:{timer.toString().padStart(2, '0')}
                  </p>
                )}
              </div>
            </div>
          </motion.div>
        )}

        {/* Step 3: New Password */}
        {step === 3 && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            <div className="text-center mb-8">
              <h1 className="text-3xl font-display text-primary mb-2">{t('auth.forgotPassword.setNewPassword')}</h1>
              <p className="text-muted-foreground">{t('auth.forgotPassword.chooseStrong')}</p>
            </div>

            <div className="bg-card border border-border rounded-3xl p-8 shadow-lg">
              <form onSubmit={handleResetPassword} className="space-y-5">
                <div>
                  <label className="block text-sm font-display mb-2">{t('auth.forgotPassword.newPassword')}</label>
                  <div className="relative">
                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="••••••••"
                      required
                      className="w-full pl-12 pr-12 py-3 bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                    />
                    <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                      {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </div>
                  {newPassword.length > 0 && (
                    <div className="flex gap-1 mt-2">
                      {[0, 1, 2, 3].map((i) => (
                        <div key={i} className="h-1 flex-1 rounded-full transition-all" style={{ background: strength > i ? strengthColors[strength - 1] : '#E5E7EB' }} />
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-display mb-2">{t('auth.forgotPassword.confirmPassword')}</label>
                  <div className="relative">
                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                    <input
                      type={showConfirmPassword ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="••••••••"
                      required
                      className="w-full pl-12 pr-12 py-3 bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                    />
                    <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)} className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                      {showConfirmPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </div>
                  {passwordsMatch && <p className="text-xs text-secondary mt-1 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> {t('auth.forgotPassword.passwordsMatch')}</p>}
                </div>

                <button
                  type="submit"
                  disabled={isLoading || !passwordsMatch || newPassword.length < 8}
                  className="w-full py-3 bg-gradient-to-r from-primary to-secondary text-white rounded-xl font-display hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isLoading ? t('auth.forgotPassword.updating') : t('auth.forgotPassword.resetPassword')}
                </button>
              </form>
            </div>
          </motion.div>
        )}

        {/* Step 4: Success */}
        {step === 4 && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5 }}
            className="bg-card border border-border rounded-3xl p-8 shadow-lg text-center"
          >
            <div className="w-20 h-20 bg-gradient-to-br from-secondary/10 to-secondary/20 border-2 border-secondary/30 rounded-full flex items-center justify-center mx-auto mb-6">
              <CheckCircle2 className="w-10 h-10 text-secondary" />
            </div>
            <h1 className="text-3xl font-display text-primary mb-2">{t('auth.forgotPassword.passwordUpdated')}</h1>
            <p className="text-muted-foreground mb-8">
              {t('auth.forgotPassword.canNowSignIn')}
            </p>
            <button
              onClick={onBack}
              className="w-full py-3 bg-gradient-to-r from-primary to-secondary text-white rounded-xl font-display hover:shadow-lg transition-all"
            >
              {t('auth.forgotPassword.goToLogin')}
            </button>
          </motion.div>
        )}
      </div>
    </div>
  );
}
