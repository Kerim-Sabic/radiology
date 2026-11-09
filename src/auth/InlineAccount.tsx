import { useCallback, useEffect, useRef, useState } from 'react';
import { ClerkFailed, ClerkLoading, ClerkProvider, SignIn, SignUp, useAuth, useClerk, useUser } from '@clerk/react';
import { adSource } from '../services/source';
import { trackFunnel } from '../services/serverSync';
import { ev } from '../services/ev';
import { withAccount } from './returnPath';

type Mode = 'signup' | 'login';
interface Props { publishableKey: string; mode: Mode; onModeChange: (mode: Mode) => void; onSuccess: () => Promise<void>; }

/**
 * Clerk's two scripts as @clerk/react 6 asks for them, by major version (@clerk/shared's clerkJSScriptUrl and
 * clerkUIScriptUrl; tests/clerkWarm.test.ts keeps them equal). Clerk's host answers each with a redirect that is never
 * cached (307, no-store) to the exact version.
 */
export const clerkScriptTags = (host: string) => ({
  js: `${host}/npm/@clerk/clerk-js@6/dist/clerk.browser.js`,
  ui: `${host}/npm/@clerk/ui@1/dist/ui.browser.js`,
});
/** The parts of Clerk's UI the sign-up form loads first (named in ui.browser.js's chunk map). */
const FORM_CHUNKS = ['framework', 'vendors', 'ui-common', 'signup'];
const EXACT = /^https:\/\/[a-z0-9.-]+\/npm\/@clerk\/(?:clerk-js|ui)@\d+\.\d+\.\d+\/dist\/(?:clerk|ui)\.browser\.js$/;
/** The exact script versions the warm-up found: the form asks for these, so neither script waits on a redirect. */
const pinned: { js?: string; ui?: string } = {};
let warmed = false;

/** Download one of Clerk's scripts into the browser's cache (never run here); its exact URL is kept once known. */
async function warmScript(url: string, keep: (exact: string) => void): Promise<string | null> {
  try {
    const response = await fetch(url, { priority: 'low' });
    if (!response.ok) return null;
    if (EXACT.test(response.url) && new URL(response.url).origin === new URL(url).origin) keep(response.url);
    return await response.text(); // read to the end, so the whole file is cached
  } catch {
    return null;
  }
}

/**
 * After a guest's graded answer (the next step offered is this form): fetch the files the form will ask for, so "Save
 * it" shows the email field without waiting on them. The scripts are only downloaded, never run: a second, hidden Clerk
 * would keep the wrong settings. Skipped when the visitor asked to save data. About 0.36 MB, files the form would load
 * anyway (measured Nov 8 on slow 4G: the email field ready 1.1 s after "Save it" instead of 3.6 s).
 */
export function warmClerk(host: string | null) {
  if (!host || warmed) return;
  if ((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData) return;
  warmed = true;
  const tags = clerkScriptTags(host);
  void warmScript(tags.js, (exact) => { pinned.js = exact; });
  void warmScript(tags.ui, (exact) => { pinned.ui = exact; }).then((text) => {
    // The UI loads its parts as "<name>_ui_<hash>_<version>.js" beside ui.browser.js, with plain script tags; a
    // prefetch is the same kind of request, so the browser's cache answers them.
    const hash = /\bh=\(\)=>"([0-9a-f]{6})/.exec(text ?? '')?.[1];
    const version = /@clerk\/ui@(\d+\.\d+\.\d+)\//.exec(pinned.ui ?? '')?.[1];
    if (!text || !hash || !version || !text.includes(`"_${version}.js"`) || !pinned.ui) return;
    if (!document.createElement('link').relList?.supports?.('prefetch')) return;
    const dir = pinned.ui.replace(/[^/]+$/, '');
    for (const name of FORM_CHUNKS) {
      if (!new RegExp(`\\d+:"${name}"`).test(text)) continue;
      const l = document.createElement('link');
      l.rel = 'prefetch';
      l.href = `${dir}${name}_ui_${hash}_${version}.js`;
      document.head.appendChild(l);
    }
  });
}

/**
 * The script URLs for ClerkProvider once the warm-up knows them. `__internal_clerkJSUrl` / `__internal_clerkUIUrl` are
 * the options Clerk's own framework SDKs pass (@clerk/shared IsomorphicClerkOptions), left out of ClerkProvider's
 * public props; without them Clerk loads the version tags as before.
 */
export const scriptUrls = () => ({ ...(pinned.js ? { __internal_clerkJSUrl: pinned.js } : {}), ...(pinned.ui ? { __internal_clerkUIUrl: pinned.ui } : {}) });
const appearance = {
  variables: { colorPrimary: '#f5f5f7', colorPrimaryForeground: '#0b0b0c', colorBackground: '#111113', colorForeground: '#f5f5f7', colorMutedForeground: '#a1a1a6', colorInput: '#000000', colorInputForeground: '#f5f5f7', borderRadius: '0.6rem', fontFamily: 'inherit' },
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
  // The form's steps, from Clerk's own state (and the address bar as a fallback): shown, email typed into, code sent,
  // a wrong code, a new code.
  const openedAt = useRef(performance.now());
  useEffect(() => {
    if (isLoaded && !isSignedIn) ev('form_shown', { ms: Math.round(performance.now() - openedAt.current), mode }, true);
  }, [isLoaded, isSignedIn, mode]);
  useEffect(() => {
    if (!isLoaded) return;
    const focus = (e: FocusEvent) => {
      if ((e.target as HTMLInputElement | null)?.name === 'emailAddress') ev('email_focus', {}, true);
    };
    document.addEventListener('focusin', focus);
    // The email was submitted ("Continue" pressed), and Clerk's field errors (a bad address, one it refuses): the step
    // between typing and the code. No text is kept, only that it happened.
    const submit = (e: Event) => { if ((e.target as HTMLElement | null)?.closest?.('.inline-account-submit')) ev('signup_submit', {}, true); };
    document.addEventListener('click', submit, true);
    const errorsSeen = new MutationObserver(() => { if (document.querySelector('.inline-account-cardbox .cl-formFieldErrorText')) ev('clerk_error', { code: 'field' }, true); });
    errorsSeen.observe(document.body, { childList: true, subtree: true });
    let expires = 0;
    let attempts = 0;
    const off = clerk.addListener(({ client }) => {
      const v = (client?.signUp as unknown as { verifications?: { emailAddress?: { status?: string; expireAt?: Date | null; attempts?: number | null; error?: { code?: string } | null } } } | undefined)?.verifications?.emailAddress;
      if (!v) return;
      const exp = v.expireAt ? new Date(v.expireAt).getTime() : 0;
      if (v.status === 'unverified' && exp) {
        if (!expires) {
          ev('code_sent', {}, true);
          trackFunnel('code_sent', true);
        } else if (exp !== expires) ev('code_resend');
        expires = exp;
      }
      if ((v.attempts ?? 0) > attempts && v.status !== 'verified') ev('code_wrong');
      attempts = v.attempts ?? attempts;
    });
    return () => {
      document.removeEventListener('focusin', focus);
      document.removeEventListener('click', submit, true);
      errorsSeen.disconnect();
      off?.();
    };
  }, [isLoaded, clerk]);
  useEffect(() => {
    if (mode !== 'signup') return;
    const check = () => {
      if (/verify-email-address|verify/.test(location.hash)) trackFunnel('code_sent', true);
    };
    check();
    window.addEventListener('hashchange', check);
    return () => window.removeEventListener('hashchange', check);
  }, [mode]);

  const continueSession = useCallback(async () => {
    if (exchanging.current) return;
    exchanging.current = true; setBusy(true); setError('');
    try {
      const token = await getToken();
      if (!token) throw new Error('Please finish verifying your email.');
      // The campaign this visitor arrived from, kept on a new account (src/services/source.ts).
      const source = adSource();
      const response = await fetch('/api/auth/session', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(source ? { source } : {}) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Sign-in could not be completed. Please try again.');
      ev('account', { new: result.new === true });
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
    <ClerkFailed><ClerkLoadFailed /><p className="membership-message" role="alert">Sign-in couldn’t load. Check your connection, then close and reopen this form.</p></ClerkFailed>
    {isLoaded && !isSignedIn && (mode === 'signup'
      ? <SignUp routing="hash" forceRedirectUrl={withAccount('verified')} signInUrl={withAccount('login')} />
      : <SignIn routing="hash" withSignUp forceRedirectUrl={withAccount('verified')} signUpForceRedirectUrl={withAccount('verified')} signUpUrl={withAccount('signup')} />)}
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
  // Read once, when the form opens: Clerk starts loading with the first render.
  const [scripts] = useState(scriptUrls);
  return <ClerkProvider publishableKey={publishableKey} appearance={appearance} routerPush={navigate} routerReplace={navigate}
    signInUrl="/?account=login" signUpUrl="/?account=signup" afterSignOutUrl="/" {...scripts}>
    <AccountForm mode={mode} complete={complete} onSuccess={onSuccess} />
  </ClerkProvider>;
}

/** Clerk's script failed to load: logged once. */
function ClerkLoadFailed() {
  useEffect(() => ev('clerk_error', { code: 'load' }, true), []);
  return null;
}
