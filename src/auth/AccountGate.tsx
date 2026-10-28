import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowRight, Check, ShieldCheck, ScanLine, LogOut, CreditCard, Mail } from 'lucide-react';
import './account.css';

interface Access { active: boolean; tier?: 'monthly' | 'lifetime'; expiresAt?: string | null; manageUrl?: string | null; pendingMembership?: boolean; }
interface Account { user: { name: string; email: string } | null; access: Access; billingReady: boolean; }
const AccountContext = createContext<{ account: Account; logout: () => void } | null>(null);

export function AccountMenu() {
  const context = useContext(AccountContext);
  if (!context) return null;
  return <span className="account-menu">
    <span title={context.account.user?.email}>{context.account.access.tier === 'lifetime' ? 'Lifetime member' : 'Monthly member'}</span>
    {context.account.access.manageUrl && <a href={context.account.access.manageUrl} target="_blank" rel="noopener noreferrer" title="Manage billing on Whop"><CreditCard size={16} /><span>Billing</span></a>}
    <button onClick={context.logout} title="Sign out"><LogOut size={16} /><span>Sign out</span></button>
  </span>;
}

export function AccountGate({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [ready, setReady] = useState<{ auth: boolean; billing: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const [returned, setReturned] = useState(() => new URLSearchParams(location.search).has('checkout'));
  const mounted = useRef(true);
  const signedIn = useRef(false);
  const generation = useRef(0);

  const load = useCallback(async () => {
    const current = ++generation.current;
    try {
      const response = await fetch('/api/session', { cache: 'no-store' });
      if (!mounted.current || current !== generation.current) return;
      if (response.status === 401) {
        setAccount(null);
        if (signedIn.current) setError('Your session ended. If you signed in on another device, that device is now active.');
        signedIn.current = false;
        return;
      }
      if (!response.ok) throw new Error('We couldn’t verify your access. Check your connection and try again.');
      const data: Account = await response.json();
      if (!mounted.current || current !== generation.current) return;
      signedIn.current = !!data.user;
      setAccount(data);
      setError('');
      if (data.access.active) {
        setReturned(false);
        if (new URLSearchParams(location.search).has('checkout')) history.replaceState(null, '', location.pathname);
      }
    } catch (e) {
      if (!mounted.current || current !== generation.current) return;
      // Fail closed, including if an already-signed-in user's device loses its session.
      setAccount(null);
      setError(e instanceof Error ? e.message : 'Unable to verify access.');
    } finally { if (mounted.current && current === generation.current) setLoading(false); }
  }, []);

  useEffect(() => {
    mounted.current = true;
    fetch('/api/config', { cache: 'no-store' }).then(r => r.ok ? r.json() : Promise.reject()).then(setReady).catch(() => setError('Account services are temporarily unavailable. Please try again.'));
    void load();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 30000);
    const focus = () => { void load(); };
    window.addEventListener('focus', focus);
    return () => { mounted.current = false; generation.current++; clearInterval(timer); window.removeEventListener('focus', focus); };
  }, [load]);

  const refreshPayment = useCallback(async () => {
    setChecking(true);
    try {
      const r = await fetch('/api/billing/refresh', { method: 'POST' });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      await load();
      if (!data.access.active) setError('Your payment hasn’t been confirmed yet. If you completed checkout, allow a moment and check again. Please don’t pay twice.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to check payment.'); }
    finally { setChecking(false); }
  }, [load]);
  useEffect(() => {
    if (!returned || !account?.user || account.access.active) return;
    void refreshPayment();
    const timer = setInterval(() => void refreshPayment(), 12000);
    const stop = setTimeout(() => clearInterval(timer), 120000);
    return () => { clearInterval(timer); clearTimeout(stop); };
  }, [returned, !!account?.user, account?.access.active, refreshPayment]);

  async function logout() {
    try {
      const r = await fetch('/api/logout', { method: 'POST' });
      if (!r.ok) throw new Error();
      generation.current++;
      signedIn.current = false;
      setAccount(null);
      setError('');
    } catch { setError('Sign-out failed. Please try again.'); }
  }
  async function buy(tier: 'monthly' | 'lifetime') {
    setBusy(tier); setError('');
    try {
      const response = await fetch('/api/billing/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tier }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      location.assign(data.url);
    } catch (e) { setError(e instanceof Error ? e.message : 'Checkout is unavailable. Please try again.'); setBusy(null); }
  }

  if (account?.access.active) return <AccountContext.Provider value={{ account, logout }}>{children}</AccountContext.Provider>;
  if (loading) return <div className="membership-loading" role="status"><ScanLine size={30} /><p>Opening your study space…</p></div>;
  return <main className="membership-page">
    <header className="membership-header"><a className="membership-brand" href="/"><ScanLine size={25} /> radiology.monster</a><span>Built for deliberate practice</span></header>
    <div className="membership-layout">
      <section className="membership-intro">
        <span className="membership-eyebrow">YOUR RADIOLOGY STUDY SPACE</span>
        <h1>Learn to see.<br /><em>Then know why.</em></h1>
        <p className="membership-lead">Build your confidence with real scans, guided anatomy, and focused practice. One place to turn studying into a daily habit.</p>
        <ul className="membership-features">
          <li><Check />Explore real DICOM studies with a full imaging viewer</li>
          <li><Check />Practice anatomy and get spatial feedback</li>
          <li><Check />Follow a structured course and track your progress</li>
          <li><Check />Study with your own copy of the textbook</li>
        </ul>
        <div className="membership-note"><ShieldCheck size={22} /><p>Email sign-in, checkout, and billing through Whop.<br />One active device at a time. Switch devices by signing in.</p></div>
      </section>
      <section className="membership-panel" aria-label="Membership">
        {!account?.user ? <>
          <span className="membership-step">01 / YOUR ACCOUNT</span><h2>Your next study session starts here.</h2>
          <p>Sign up or sign in with your email through Whop, then choose your access. No Google account needed.</p>
          <a className={`google-signin${!ready?.auth ? ' disabled' : ''}`} aria-disabled={!ready?.auth} href={ready?.auth ? '/api/auth/email' : undefined}>
            <Mail size={20} aria-hidden="true" />
            Continue with email
          </a>
          {ready && !ready.auth && <p className="membership-message">Sign-in is being set up. Please check back shortly.</p>}
        </> : <>
          <span className="membership-step">02 / CHOOSE YOUR ACCESS</span><h2>Welcome, {account.user.name.split(' ')[0]}.</h2><p>Signed in as {account.user.email} <button className="text-button" onClick={logout}>Sign out</button></p>
        </>}
        <div className="membership-plans">
          <article className="membership-plan"><div><h3>Monthly</h3><span>Build your routine</span></div><div className="membership-price">$10<span>/ month</span></div><p>Billed every 30 days. Cancel future renewals in Whop.</p>
            <button disabled={!account?.user || !account.billingReady || account.access.pendingMembership || busy !== null} onClick={() => void buy('monthly')}>{busy === 'monthly' ? 'Opening checkout…' : 'Choose monthly'}<ArrowRight size={17} /></button>
          </article>
          <article className="membership-plan lifetime"><span className="membership-best">ONE PAYMENT</span><div><h3>Lifetime</h3><span>Make it your study companion</span></div><div className="membership-price">$100<span>once</span></div><p>Lifetime access to this app. No recurring subscription.</p>
            <button disabled={!account?.user || !account.billingReady || account.access.pendingMembership || busy !== null} onClick={() => void buy('lifetime')}>{busy === 'lifetime' ? 'Opening checkout…' : 'Get lifetime access'}<ArrowRight size={17} /></button>
          </article>
        </div>
        {account?.access.pendingMembership && <p className="membership-message">You already have a membership awaiting payment confirmation or a billing update. {account.access.manageUrl && <a href={account.access.manageUrl} target="_blank" rel="noopener noreferrer">Open billing in Whop</a>} to check it before purchasing again.</p>}
        <p className="membership-fine">Use the same Whop account to sign in and pay. Prices in USD. Any applicable tax is shown at checkout. Both plans include the same app features. The textbook is not included. Study progress stays in this browser; export a backup to move it.</p>
        {account?.user && <div className="membership-restore"><button disabled={checking} onClick={() => void refreshPayment()}>{checking ? 'Checking with Whop…' : 'Already paid? Check access'}</button>{!account.billingReady && <p>Payments are being configured. Checkout will open once it’s ready.</p>}</div>}
        {(error || new URLSearchParams(location.search).get('signin') === 'failed') && <p className="membership-message" role="alert">{error || 'Email sign-in was canceled or expired. Please try again.'}</p>}
        {!account && error && <button className="text-button" onClick={() => void load()}>Try again</button>}
      </section>
    </div>
    <footer className="membership-footer">For education and practice. Not for clinical diagnosis.</footer>
  </main>;
}
