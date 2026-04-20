import { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Mail, Lock, Eye, EyeOff, Target } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';

interface LoginProps {
  onLogin: () => void;
  onSwitchToSignup: () => void;
  onForgotPassword: () => void;
  onNeedVerification: (email: string) => void;
  googleError?: string | null;
}

export function Login({ onLogin, onSwitchToSignup, onForgotPassword, onNeedVerification, googleError }: LoginProps) {
  const { t } = useTranslation();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (googleError === 'google_denied') toast.info(t('auth.login.googleCancelled'));
    else if (googleError) toast.error(t('auth.login.googleFailed'));
  }, [googleError]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    const result = await login(email, password);
    setIsLoading(false);
    if (result.error) {
      if (result.code === 'EMAIL_NOT_VERIFIED') {
        toast.info(t('auth.login.verifyEmailFirst'));
        onNeedVerification(email);
      } else {
        toast.error(result.error);
      }
      return;
    }
    toast.success(t('auth.login.welcomeBack'));
    onLogin();
  };

  const handleGoogleLogin = () => {
    window.location.href = '/api/auth/google';
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-center mb-8"
        >
          <div className="flex justify-center mb-4">
            <div className="w-16 h-16 bg-gradient-to-br from-primary to-secondary rounded-2xl flex items-center justify-center shadow-lg">
              <Target className="w-9 h-9 text-white" />
            </div>
          </div>
          <h1 className="text-3xl font-display text-primary mb-2">{t('auth.login.title')}</h1>
          <p className="text-muted-foreground">{t('auth.login.subtitle')}</p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="bg-card border border-border rounded-3xl p-8 shadow-lg"
        >
          <button
            type="button"
            onClick={handleGoogleLogin}
            disabled={isLoading}
            className="w-full py-3 bg-background border border-border rounded-xl font-display hover:bg-muted transition-all flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed mb-5"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            {t('auth.login.continueGoogle')}
          </button>

          <div className="relative mb-5">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-4 bg-card text-muted-foreground">{t('auth.login.orEmail')}</span>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="email" className="block text-sm font-display mb-2">{t('auth.login.email')}</label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  className="w-full pl-12 pr-4 py-3 bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                />
              </div>
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-display mb-2">{t('auth.login.password')}</label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="w-full pl-12 pr-12 py-3 bg-background border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            <div className="flex justify-end">
              <button type="button" onClick={onForgotPassword} className="text-sm text-primary hover:text-primary/80 transition-colors">
                {t('auth.login.forgotPassword')}
              </button>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 bg-gradient-to-r from-primary to-secondary text-white rounded-xl font-display hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? t('auth.login.signingIn') : t('auth.login.signIn')}
            </button>
          </form>

          <p className="text-center text-sm text-muted-foreground mt-6">
            {t('auth.login.noAccount')}{' '}
            <button onClick={onSwitchToSignup} className="text-primary hover:text-primary/80 font-display transition-colors">
              {t('auth.login.signUpFree')}
            </button>
          </p>
        </motion.div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="text-center text-xs text-muted-foreground mt-6"
        >
          {t('auth.login.terms')}
        </motion.p>
      </div>
    </div>
  );
}
