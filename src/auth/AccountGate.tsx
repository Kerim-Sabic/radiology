import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Check, ShieldCheck, ScanLine, LogOut, CreditCard, Mail, X } from 'lucide-react';
import './account.css';
const EmbeddedCheckout = lazy(() => import('./EmbeddedCheckout'));
type Tier = 'monthly' | 'lifetime';
const planKey = 'rvm:selected-plan';
function rememberedPlan(): Tier | null { try { const value = sessionStorage.getItem(planKey); return value === 'monthly' || value === 'lifetime' ? value : null; } catch { return null; } }
function rememberPlan(tier: Tier | null) { try { if (tier) sessionStorage.setItem(planKey, tier); else sessionStorage.removeItem(planKey); } catch { /* Storage is optional. */ } }

interface Access { active: boolean; role?: 'admin'; tier?: Tier; expiresAt?: string | null; manageUrl?: string | null; pendingMembership?: boolean; }
interface Account { user: { name: string; email: string } | null; access: Access; billingReady: boolean; }
const AccountContext = createContext<{ account: Account; logout: () => void } | null>(null);

export function AccountMenu() {
  const context = useContext(AccountContext);
  if (!context) return null;
  return <span className="account-menu">
    <span title={context.account.user?.email}>{context.account.access.role === 'admin' ? 'Admin · free access' : context.account.access.tier === 'lifetime' ? 'Lifetime member' : 'Monthly member'}</span>
    {context.account.access.manageUrl && <a href={context.account.access.manageUrl} target="_blank" rel="noopener noreferrer" title="Manage billing on Whop"><CreditCard size={16} /><span>Billing</span></a>}
    <button onClick={context.logout} title="Sign out"><LogOut size={16} /><span>Sign out</span></button>
  </span>;
}

/**
 * `npm run dev` on your own computer opens the study space without an account (there is no account service
 * locally). Production builds set import.meta.env.DEV to false, so this branch is not in any deployed app.
 * Set VITE_REQUIRE_SIGN_IN=1 to try the membership flow locally.
 */
const LOCAL_DEV_OPEN = import.meta.env.DEV && import.meta.env.VITE_REQUIRE_SIGN_IN !== '1';

export function AccountGate({ children }: { children: ReactNode }) {
  return LOCAL_DEV_OPEN ? <>{children}</> : <MembershipGate>{children}</MembershipGate>;
}

function MembershipGate({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [ready, setReady] = useState<{ auth: boolean; billing: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const [returned, setReturned] = useState(() => new URLSearchParams(location.search).has('checkout'));
  const [authMode, setAuthMode] = useState<'signup' | 'login' | null>(null);
  const [authWaiting, setAuthWaiting] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<Tier | null>(rememberedPlan);
  const [payment, setPayment] = useState<{ id: string; returnUrl: string; tier: Tier } | null>(null);
  const authWindow = useRef<Window | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const checkoutHeading = useRef<HTMLHeadingElement>(null);
  const checkoutGeneration = useRef(0);
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
        setPayment(null);
        setBusy(null);
        checkoutGeneration.current++;
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
      if (data.user) { setAuthMode(null); setAuthWaiting(false); }
      if (data.access.active) {
        setReturned(false);
        setPayment(null); setSelectedPlan(null); rememberPlan(null);
        if (new URLSearchParams(location.search).has('checkout')) history.replaceState(null, '', location.pathname);
      }
    } catch (e) {
      if (!mounted.current || current !== generation.current) return;
      // Fail closed, including if an already-signed-in user's device loses its session.
      setAccount(null);
      setPayment(null); setBusy(null); checkoutGeneration.current++;
      setError(e instanceof Error ? e.message : 'Unable to verify access.');
    } finally { if (mounted.current && current === generation.current) setLoading(false); }
  }, []);

  useEffect(() => {
    mounted.current = true;
    fetch('/api/config', { cache: 'no-store' }).then(r => r.ok ? r.json() : Promise.reject()).then(setReady).catch(() => setError('Account services are temporarily unavailable. Please try again.'));
    void load();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 30000);
    const focus = () => { void load(); };
    const message = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== authWindow.current || event.data?.type !== 'rvm-auth') return;
      setAuthWaiting(false);
      if (event.data.ok) void load(); else setError('Sign-in was canceled or expired. Please try again.');
    };
    window.addEventListener('focus', focus);
    window.addEventListener('message', message);
    return () => { mounted.current = false; generation.current++; checkoutGeneration.current++; clearInterval(timer); window.removeEventListener('focus', focus); window.removeEventListener('message', message); };
  }, [load]);

  useEffect(() => { if (authMode && !dialog.current?.open) dialog.current?.showModal(); else if (!authMode) dialog.current?.close(); }, [authMode]);
  useEffect(() => {
    if (!authWaiting) return;
    const timer = setInterval(() => void load(), 3000);
    const stop = setTimeout(() => { clearInterval(timer); setAuthWaiting(false); }, 360000);
    return () => { clearInterval(timer); clearTimeout(stop); };
  }, [authWaiting, load]);
  useEffect(() => { if (payment) { checkoutHeading.current?.focus(); checkoutHeading.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } }, [payment]);

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
      checkoutGeneration.current++;
      signedIn.current = false;
      setAccount(null);
      setPayment(null); setBusy(null); setSelectedPlan(null); rememberPlan(null);
      setError('');
    } catch { setError('Sign-out failed. Please try again.'); }
  }
  const buy = useCallback(async (tier: Tier) => {
    const current = ++checkoutGeneration.current;
    setBusy(tier); setError('');
    try {
      const response = await fetch('/api/billing/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tier }) });
      const data = await response.json();
      if (!mounted.current || current !== checkoutGeneration.current) return;
      if (!response.ok) throw new Error(data.error);
      if (!/^ch_[A-Za-z0-9]+$/.test(data.id)) throw new Error('Unable to open the payment form. Please try again.');
      setPayment({ id: data.id, returnUrl: data.returnUrl, tier });
      rememberPlan(null);
    } catch (e) { if (mounted.current && current === checkoutGeneration.current) setError(e instanceof Error ? e.message : 'Checkout is unavailable. Please try again.'); }
    finally { if (mounted.current && current === checkoutGeneration.current) setBusy(null); }
  }, []);
  useEffect(() => {
    if (selectedPlan && account?.user && !account.access.active && !account.access.pendingMembership && account.billingReady) {
      setSelectedPlan(null); void buy(selectedPlan);
    }
  }, [selectedPlan, account, buy]);
  function choose(tier: Tier) {
    if (account?.user) { void buy(tier); return; }
    setSelectedPlan(tier); rememberPlan(tier); setAuthMode('signup'); setError('');
  }
  function startSignIn() {
    setAuthWaiting(true); setError('');
    authWindow.current = window.open('/api/auth/email', 'radiology-sign-in', `popup=yes,width=480,height=700,left=${Math.max(0, window.screenX + (window.outerWidth - 480) / 2)},top=${Math.max(0, window.screenY + (window.outerHeight - 700) / 2)}`);
    if (!authWindow.current) location.assign('/api/auth/email');
  }

  if (account?.access.active) return <AccountContext.Provider value={{ account, logout }}>{children}</AccountContext.Provider>;
  if (loading) return <div className="membership-loading" role="status"><ScanLine size={30} /><p>Opening your study space…</p></div>;
  return <main className="membership-page">
    <header className="membership-header"><a className="membership-brand" href="/"><ScanLine size={25} /> radiology.monster</a>{account?.user ? <button className="header-signin" onClick={logout}>Sign out</button> : <button className="header-signin" disabled={!ready?.auth} onClick={() => setAuthMode('login')}>Sign in <ArrowRight size={15} /></button>}</header>
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
        <div className="membership-note"><ShieldCheck size={22} /><p>Secure payment, right here on radiology.monster.<br />One active device at a time. Switch devices by signing in.</p></div>
      </section>
      <section className="membership-panel" aria-label="Membership">
        {payment && account?.user ? <>
          <button className="checkout-back text-button" onClick={() => { setPayment(null); setError(''); }}><ArrowLeft size={15} /> Change plan</button>
          <span className="membership-step">COMPLETE YOUR MEMBERSHIP</span>
          <h2 ref={checkoutHeading} tabIndex={-1}>Your study space is almost ready.</h2>
          <p className="checkout-account">{account.user.email}</p>
          <Suspense fallback={<p className="checkout-loading" role="status">Loading secure payment form…</p>}>
            <EmbeddedCheckout key={payment.id} id={payment.id} returnUrl={payment.returnUrl} email={account.user.email} onComplete={() => { setReturned(true); void refreshPayment(); }} />
          </Suspense>
          <p className="membership-fine">{payment.tier === 'monthly' ? '$10 USD every 30 days. Cancel future renewals from Billing.' : '$100 USD once for lifetime access. No recurring payments.'} Any applicable tax is shown in the payment form. Access opens after payment is verified.</p>
        </> : <>
        <span className="membership-step">ONE STUDY SPACE. TWO WAYS IN.</span>
        <h2>{account?.user ? 'You’re one step away.' : 'Invest in the way you learn.'}</h2>
        <p>{account?.user ? `Signed in as ${account.user.email}` : 'Choose your plan, create your account, and start exploring.'}</p>
        {ready && !ready.auth && <p className="membership-message">Sign-in is temporarily unavailable. Please try again shortly.</p>}
        <div className="membership-plans">
          <article className="membership-plan"><div><h3>Monthly</h3><span>Build your routine</span></div><div className="membership-price">$10<span>/ month</span></div><p>Billed every 30 days. Cancel future renewals in Whop.</p>
            <button disabled={!ready?.auth || (!!account?.user && (!account.billingReady || account.access.pendingMembership)) || busy !== null} onClick={() => choose('monthly')}>{busy === 'monthly' ? 'Preparing payment…' : 'Choose monthly'}<ArrowRight size={17} /></button>
          </article>
          <article className="membership-plan lifetime"><span className="membership-best">ONE PAYMENT</span><div><h3>Lifetime</h3><span>Make it your study companion</span></div><div className="membership-price">$100<span>once</span></div><p>Lifetime access to this app. No recurring subscription.</p>
            <button disabled={!ready?.auth || (!!account?.user && (!account.billingReady || account.access.pendingMembership)) || busy !== null} onClick={() => choose('lifetime')}>{busy === 'lifetime' ? 'Preparing payment…' : 'Get lifetime access'}<ArrowRight size={17} /></button>
          </article>
        </div>
        <p className="payment-reassurance"><ShieldCheck size={15} /> Secure checkout on this site · Powered by Whop</p>
        {!account?.user && <p className="existing-account">Already a member? <button className="text-button" disabled={!ready?.auth} onClick={() => setAuthMode('login')}>Sign in</button></p>}
        </>}
        {account?.access.pendingMembership && <p className="membership-message">You already have a membership awaiting payment confirmation or a billing update. {account.access.manageUrl && <a href={account.access.manageUrl} target="_blank" rel="noopener noreferrer">Open billing in Whop</a>} to check it before purchasing again.</p>}
        {!payment && <p className="membership-fine">Both plans include all app features. Prices in USD; any applicable tax is shown at checkout. The textbook is not included. Study progress stays in this browser; export a backup to move it.</p>}
        {account?.user && <div className="membership-restore"><button disabled={checking} onClick={() => void refreshPayment()}>{checking ? 'Checking with Whop…' : 'Already paid? Check access'}</button>{!account.billingReady && <p>Payments are being configured. Checkout will open once it’s ready.</p>}</div>}
        {(error || new URLSearchParams(location.search).get('signin') === 'failed') && <p className="membership-message" role="alert">{error || 'Email sign-in was canceled or expired. Please try again.'}</p>}
        {!account && error && <button className="text-button" onClick={() => void load()}>Try again</button>}
      </section>
    </div>
    <footer className="membership-footer">For education and practice. Not for clinical diagnosis.</footer>
    <dialog className="auth-dialog" ref={dialog} onCancel={() => setAuthMode(null)} onClose={() => setAuthMode(null)} aria-labelledby="auth-title">
      <button className="auth-close" aria-label="Close sign-in" onClick={() => setAuthMode(null)}><X size={20} /></button>
      <div className="auth-icon"><Mail size={25} /></div>
      <div className="auth-tabs" role="tablist" aria-label="Account options">
        <button role="tab" aria-selected={authMode === 'signup'} onClick={() => setAuthMode('signup')}>Create account</button>
        <button role="tab" aria-selected={authMode === 'login'} onClick={() => setAuthMode('login')}>Sign in</button>
      </div>
      <h2 id="auth-title">{authMode === 'signup' ? 'Your next chapter starts here.' : 'Welcome back.'}</h2>
      <p>{authMode === 'signup' ? 'Use your email to create an account. No Google account or new password needed.' : 'Sign in with the email you used for your membership.'}</p>
      {selectedPlan && <div className="selected-plan"><Check size={16} />{selectedPlan === 'monthly' ? 'Monthly · $10 / month' : 'Lifetime · $100 once'}</div>}
      <button className="email-signin" onClick={startSignIn} disabled={!ready?.auth}><Mail size={18} />{authWaiting ? 'Reopen sign-in window' : 'Continue with email'}<ArrowRight size={18} /></button>
      {authWaiting && <p className="auth-waiting" role="status">Finish verifying your email in the secure window. We’ll continue here automatically.</p>}
      <p className="auth-privacy"><ShieldCheck size={15} /> Whop securely verifies your email in a separate window. Your payment happens here on radiology.monster.</p>
      {error && <p className="membership-message" role="alert">{error}</p>}
    </dialog>
  </main>;
}
