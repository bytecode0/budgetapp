import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Login } from './Login';
import { Signup } from './Signup';
import { ForgotPassword } from './ForgotPassword';
import { Welcome } from './Welcome';
import { VerifyEmail } from './VerifyEmail';
import { GoogleCallback } from './GoogleCallback';

type AuthScreen =
  | 'login'
  | 'signup'
  | 'verify-email'
  | 'forgot-password'
  | 'welcome'
  | 'google-callback';

interface AuthFlowProps {
  onAuthenticated: () => void;
  inviteBanner?: { senderName: string; senderEmail: string } | null;
}

export function AuthFlow({ onAuthenticated, inviteBanner }: AuthFlowProps) {
  const { t } = useTranslation();
  const [currentScreen, setCurrentScreen] = useState<AuthScreen>('login');
  const [pendingEmail, setPendingEmail] = useState('');
  const [googleToken, setGoogleToken] = useState<string | null>(null);
  const [googleError, setGoogleError] = useState<string | null>(null);

  // Detect Google OAuth callback or error from URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const error = params.get('error');
    const path = window.location.pathname;

    if (path === '/auth/google/callback') {
      const token = params.get('token');
      if (token) {
        setGoogleToken(token);
        setCurrentScreen('google-callback');
      } else {
        setGoogleError('google_failed');
        setCurrentScreen('login');
      }
      // Clean up URL
      window.history.replaceState({}, '', '/');
    } else if (error) {
      setGoogleError(error);
      setCurrentScreen('login');
      window.history.replaceState({}, '', '/');
    }
  }, []);

  const renderScreen = () => {
    switch (currentScreen) {
      case 'login':
        return (
          <Login
            onLogin={onAuthenticated}
            onSwitchToSignup={() => setCurrentScreen('signup')}
            onForgotPassword={() => setCurrentScreen('forgot-password')}
            onNeedVerification={(email) => {
              setPendingEmail(email);
              setCurrentScreen('verify-email');
            }}
            googleError={googleError}
          />
        );
      case 'signup':
        return (
          <Signup
            onSignupSuccess={(email) => {
              setPendingEmail(email);
              setCurrentScreen('verify-email');
            }}
            onSwitchToLogin={() => setCurrentScreen('login')}
          />
        );
      case 'verify-email':
        return (
          <VerifyEmail
            email={pendingEmail}
            onVerified={() => setCurrentScreen('welcome')}
            onBack={() => setCurrentScreen('signup')}
          />
        );
      case 'forgot-password':
        return (
          <ForgotPassword onBack={() => setCurrentScreen('login')} />
        );
      case 'welcome':
        return (
          <Welcome onContinue={onAuthenticated} />
        );
      case 'google-callback':
        return (
          <GoogleCallback
            token={googleToken!}
            onSuccess={onAuthenticated}
            onError={(error) => {
              setGoogleError(error);
              setCurrentScreen('login');
            }}
          />
        );
    }
  };

  return (
    <>
      {inviteBanner && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-gradient-to-r from-primary to-secondary text-white px-5 py-3 rounded-2xl shadow-xl text-sm flex items-center gap-2 max-w-sm mx-4">
          <span>💑</span>
          <span><strong>{inviteBanner.senderName}</strong> {t('auth.authFlow.inviteBannerSuffix')}</span>
        </div>
      )}
      {renderScreen()}
    </>
  );
}
