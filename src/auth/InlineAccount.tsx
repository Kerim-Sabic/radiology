import { useCallback, useEffect, useRef, useState } from 'react';
import { ClerkFailed, ClerkLoading, ClerkProvider, SignIn, SignUp, useAuth, useClerk, useUser } from '@clerk/react';

type Mode = 'signup' | 'login';
interface Props { publishableKey: string; mode: Mode; onModeChange: (mode: Mode) => void; onSuccess: () => Promise<void>; }
const appearance = {
  variables: { colorPrimary: '#8bd4ff', colorPrimaryForeground: '#102331', colorBackground: '#141f2b', colorForeground: '#e7ebf0', colorMutedForeground: '#aab9c9', colorInput: '#0b141e', colorInputForeground: '#e7ebf0', borderRadius: '0.6rem', fontFamily: 'inherit' },
  elements: { rootBox: 'inline-account-root', cardBox: 'inline-account-cardbox', card: 'inline-account-card', footerAction: 'inline-account-hidden', formButtonPrimary: 'inline-account-submit' },
};

function AccountForm({ mode, complete, onSuccess }: { mode: Mode; complete: boolean; onSuccess: () => Promise<void> }) {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const { user } = useUser();
  const clerk = useClerk();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const hasShownForm = useRef(false);
  const exchanging = useRef(false);
  if (isLoaded && !isSignedIn) hasShownForm.current = true;

  const continueSession = useCallback(async () => {
    if (exchanging.current) return;
    exchanging.current = true; setBusy(true); setError('');
    try {
      const token = await getToken();
      if (!token) throw new Error('Please finish verifying your email.');
      const response = await fetch('/api/auth/session', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Sign-in could not be completed. Please try again.');
      await onSuccess();
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to complete sign-in.'); }
    finally { exchanging.current = false; setBusy(false); }
  }, [getToken, onSuccess]);
  const autoAttempted = useRef(false);
  useEffect(() => {
    if (isLoaded && isSignedIn && (complete || hasShownForm.current) && !autoAttempted.current) {
      autoAttempted.current = true; void continueSession();
    }
  }, [isLoaded, isSignedIn, complete, continueSession]);

  return <>
    <ClerkLoading><p className="auth-waiting" role="status">Loading secure sign-in…</p></ClerkLoading>
    <ClerkFailed><p className="membership-message" role="alert">Sign-in couldn’t load. Check your connection, then close and reopen this form.</p></ClerkFailed>
    {isLoaded && !isSignedIn && (mode === 'signup'
      ? <SignUp routing="hash" forceRedirectUrl="/?account=verified" signInUrl="/?account=login" />
      : <SignIn routing="hash" withSignUp forceRedirectUrl="/?account=verified" signUpForceRedirectUrl="/?account=verified" signUpUrl="/?account=signup" />)}
    {isLoaded && isSignedIn && <div className="inline-account-continue">
      <p>Signed in as <strong>{user?.primaryEmailAddress?.emailAddress || 'your account'}</strong></p>
      <button className="email-signin" disabled={busy} onClick={() => void continueSession()}>{busy ? 'Opening your account…' : 'Continue to radiology.monster'}</button>
      <button className="text-button" disabled={busy} onClick={() => { hasShownForm.current = false; autoAttempted.current = false; void clerk.signOut(); }}>Use a different email</button>
    </div>}
    {error && <p className="membership-message" role="alert">{error}</p>}
  </>;
}

export default function InlineAccount({ publishableKey, mode, onModeChange, onSuccess }: Props) {
  const [complete, setComplete] = useState(() => new URLSearchParams(location.search).get('account') === 'verified');
  const navigate = useCallback((to: string) => {
    const url = new URL(to, location.origin);
    const target = url.searchParams.get('account');
    if (url.origin === location.origin && target === 'verified') { setComplete(true); return; }
    if (url.origin === location.origin && (target === 'login' || target === 'signup')) { onModeChange(target); return; }
    location.assign(url.href);
  }, [onModeChange]);
  return <ClerkProvider publishableKey={publishableKey} appearance={appearance} routerPush={navigate} routerReplace={navigate}
    signInUrl="/?account=login" signUpUrl="/?account=signup" afterSignOutUrl="/">
    <AccountForm mode={mode} complete={complete} onSuccess={onSuccess} />
  </ClerkProvider>;
}
