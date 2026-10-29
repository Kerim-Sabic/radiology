import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Check, ShieldCheck, ScanLine, LogOut, CreditCard, Mail, X, BookOpen, Crosshair, Layers, LockOpen } from 'lucide-react';
import './account.css';
import './plans.css';
import { Landing } from './Landing';
import { InviteFriends } from './InviteFriends';
import { currentReferral } from './referralAttribution';
import { PlansScreen } from './PlansScreen';
import { trackFunnel } from '../services/serverSync';
const EmbeddedCheckout = lazy(() => import('./EmbeddedCheckout'));
const InlineAccount = lazy(() => import('./InlineAccount'));
type Tier = 'monthly' | 'yearly';
const promoKey = 'rvm:promo-code';
function rememberedPromo() { try { return sessionStorage.getItem(promoKey) || ''; } catch { return ''; } }
const planKey = 'rvm:selected-plan';
function rememberedPlan(): Tier | null { try { const value = sessionStorage.getItem(planKey); return value === 'monthly' || value === 'yearly' ? value : null; } catch { return null; } }
function rememberPlan(tier: Tier | null) { try { if (tier) sessionStorage.setItem(planKey, tier); else sessionStorage.removeItem(planKey); } catch { /* Storage is optional. */ } }

interface Access { active: boolean; role?: 'admin'; tier?: Tier | 'lifetime'; expiresAt?: string | null; manageUrl?: string | null; pendingMembership?: boolean; }
interface Account { user: { name: string; email: string } | null; access: Access; billingReady: boolean; book?: boolean; }
interface AccountState {
  account: Account;
  logout: () => void;
  /** Signed in without a plan: the free edition (the sample patients). */
  free: boolean;
  /** Open the plans screen (free accounts). */
  openPlans: () => void;
}
const AccountContext = createContext<AccountState | null>(null);

/** The signed-in account, or null where there is none (local development without the gate). */
export function useAccount(): AccountState | null {
  return useContext(AccountContext);
}

export function AccountMenu() {
  const context = useContext(AccountContext);
  if (!context) return null;
  if (context.free) return <span className="account-menu">
    <button className="upgrade-btn" onClick={context.openPlans} title="See the plans"><LockOpen size={15} /><span>Upgrade</span></button>
    <button onClick={context.logout} title={`Sign out (${context.account.user?.email ?? ''})`}><LogOut size={16} /><span>Sign out</span></button>
  </span>;
  return <span className="account-menu">
    <span title={context.account.user?.email}>{context.account.access.role === 'admin' ? 'Admin · free access' : context.account.access.tier === 'lifetime' ? 'Lifetime member' : context.account.access.tier === 'yearly' ? 'Yearly member' : 'Monthly member'}</span>
    {context.account.access.manageUrl && <a href={context.account.access.manageUrl} target="_blank" rel="noopener noreferrer" title="Manage billing on Whop"><CreditCard size={16} /><span>Billing</span></a>}
    <InviteFriends />
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
  const [referral] = useState(currentReferral);
  const [account, setAccount] = useState<Account | null>(null);
  const [ready, setReady] = useState<{ auth: boolean; billing: boolean; authProvider?: 'clerk' | 'whop'; clerkPublishableKey?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const [returned, setReturned] = useState(() => new URLSearchParams(location.search).has('checkout'));
  const [authMode, setAuthMode] = useState<'signup' | 'login' | null>(() => {
    const mode = new URLSearchParams(location.search).get('account');
    return mode === 'signup' ? 'signup' : mode === 'login' || mode === 'verified' ? 'login' : null;
  });
  const [authWaiting, setAuthWaiting] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<Tier | null>(rememberedPlan);
  // Free accounts use the app; the plans open as their own screen (from Upgrade, a locked feature, or ?plans).
  const [plansOpen, setPlansOpen] = useState(() => new URLSearchParams(location.search).has('plans') || !!rememberedPlan());
  const openPlans = useCallback(() => { setPlansOpen(true); setError(''); trackFunnel('plans', true); }, []);
  function closePlans() {
    setPlansOpen(false); setPayment(null); setReturned(false); setError('');
    const q = new URLSearchParams(location.search);
    if (q.has('plans') || q.has('checkout')) { q.delete('plans'); q.delete('checkout'); history.replaceState(null, '', `${location.pathname}${q.size ? `?${q}` : ''}`); }
  }
  const [promoCode, setPromoCode] = useState(rememberedPromo);
  const [payment, setPayment] = useState<{ id: string; returnUrl: string; tier: Tier; promoCode?: string } | null>(null);
  function updatePromo(value: string) {
    setPromoCode(value);
    try { if (value) sessionStorage.setItem(promoKey, value); else sessionStorage.removeItem(promoKey); } catch { /* Optional storage. */ }
  }
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
      if (data.user && new URLSearchParams(location.search).has('account')) history.replaceState(null, '', location.pathname);
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

  useEffect(() => { if (authMode && !dialog.current?.open) dialog.current?.showModal(); else if (!authMode) dialog.current?.close(); }, [authMode, loading]);
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
      const affiliate = currentReferral() || referral;
      const response = await fetch('/api/billing/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tier, ...(promoCode.trim() ? { promoCode: promoCode.trim() } : {}), ...(affiliate ? { affiliateCode: affiliate } : {}) }) });
      const data = await response.json();
      if (!mounted.current || current !== checkoutGeneration.current) return;
      if (!response.ok) throw new Error(data.error);
      if (!/^ch_[A-Za-z0-9]+$/.test(data.id)) throw new Error('Unable to open the payment form. Please try again.');
      setPayment({ id: data.id, returnUrl: data.returnUrl, tier, promoCode: data.promoCode });
      setPlansOpen(true); // "Change plan" goes back to the plans, not to the app
      rememberPlan(null);
    } catch (e) { if (mounted.current && current === checkoutGeneration.current) setError(e instanceof Error ? e.message : 'Checkout is unavailable. Please try again.'); }
    finally { if (mounted.current && current === checkoutGeneration.current) setBusy(null); }
  }, [promoCode, referral]);
  useEffect(() => {
    if (selectedPlan && account?.user && !account.access.active && !account.access.pendingMembership && account.billingReady) {
      setSelectedPlan(null); void buy(selectedPlan);
    }
  }, [selectedPlan, account, buy]);
  function choose(tier: Tier) {
    if (account?.user) { void buy(tier); return; }
    setSelectedPlan(tier); rememberPlan(tier); setAuthMode('signup'); setError(''); trackFunnel('signup_start', true);
  }
  function startSignIn() {
    setAuthWaiting(true); setError('');
    authWindow.current = window.open('/api/auth/email', 'radiology-sign-in', `popup=yes,width=480,height=700,left=${Math.max(0, window.screenX + (window.outerWidth - 480) / 2)},top=${Math.max(0, window.screenY + (window.outerHeight - 700) / 2)}`);
    if (!authWindow.current) location.assign('/api/auth/email');
  }

  if (account?.access.active) return <AccountContext.Provider value={{ account, logout, free: false, openPlans }}>{children}</AccountContext.Provider>;
  if (loading) return <div className="membership-loading" role="status"><ScanLine size={30} /><p>Opening your study space…</p></div>;
  const panel = <>
    <section className="membership-panel" id="plans" aria-label="Membership">
      {payment && account?.user ? <>
        <button className="checkout-back text-button" onClick={() => { setPayment(null); setError(''); }}><ArrowLeft size={15} /> Change plan</button>
        <span className="membership-step">Checkout</span>
        <h2 ref={checkoutHeading} tabIndex={-1}>Your study space is almost ready.</h2>
        <p className="checkout-account">{account.user.email}</p>
        {!payment.promoCode && <button className="text-button" onClick={() => setPayment(null)}>Have a promo code? Add it before payment</button>}
        <Suspense fallback={<p className="checkout-loading" role="status">Loading secure payment form…</p>}>
          <EmbeddedCheckout key={payment.id} id={payment.id} returnUrl={payment.returnUrl} email={account.user.email} promoCode={payment.promoCode} onComplete={() => { setReturned(true); void refreshPayment(); }} />
        </Suspense>
        <p className="membership-fine">{payment.promoCode ? 'Your code is prefilled in the payment form. Review the discounted recurring total before paying; Whop confirms whether it is still available.' : payment.tier === 'monthly' ? 'Standard price: $20 USD every 30 days.' : 'Standard price: $150 USD every 365 days.'} Discounts and any applicable tax are shown in the payment form. Cancel future renewals from Billing. Access opens after payment is verified.</p>
      </> : <>
      <span className="membership-step">{account?.user ? 'Choose your plan' : 'Membership'}</span>
      <h2>{account?.user ? 'Unlock the whole library.' : 'The whole library, every tool.'}</h2>
      <p>{account?.user ? `Signed in as ${account.user.email}` : 'One membership for every patient, drill and on-call shift, with the book beside you.'}</p>
      {ready && !ready.auth && <p className="membership-message">Sign-in is temporarily unavailable. Please try again shortly.</p>}
      <details className="promo-entry" open={!!promoCode}><summary>Have a promo code?</summary><label htmlFor="membership-promo">Promo code</label><input id="membership-promo" value={promoCode} maxLength={40} autoComplete="off" autoCapitalize="none" spellCheck={false} onChange={event => updatePromo(event.target.value)} placeholder="Enter your code before choosing a plan" /><p>Choose a plan below. Your discount will appear in the secure payment form.</p></details>
      <div className="membership-plans">
        <article className="membership-plan yearly" aria-labelledby="yearly-plan-title">
          <span className="membership-best">Best value</span>
          <div className="plan-heading"><h3 id="yearly-plan-title">Yearly</h3><span>For a year of steady progress</span></div>
          <div className="membership-price">$12.50<span>/ month</span></div>
          <p className="plan-billing"><strong>$150 billed yearly</strong><span>One payment every 365 days.</span></p>
          <div className="plan-value"><strong>Save $90</strong><span>vs. 12 monthly payments</span></div>
          <p className="plan-access">Full access for your whole study year.</p>
          <button aria-describedby="yearly-billing-note" disabled={!ready?.auth || (!!account?.user && (!account.billingReady || account.access.pendingMembership)) || busy !== null} onClick={() => choose('yearly')}>{busy === 'yearly' ? 'Preparing payment…' : 'Start yearly'}<ArrowRight size={17} /></button>
          <p className="plan-cancel" id="yearly-billing-note">Billed annually. Cancel future renewals anytime.</p>
        </article>
        <article className="membership-plan monthly" aria-labelledby="monthly-plan-title">
          <div className="plan-heading"><h3 id="monthly-plan-title">Monthly</h3><span>For a shorter study stretch</span></div>
          <div className="membership-price">$20<span>/ month</span></div>
          <p className="plan-billing"><strong>$20 billed every 30 days</strong><span>A smaller upfront payment.</span></p>
          <p className="plan-access">The same full access, one month at a time.</p>
          <button disabled={!ready?.auth || (!!account?.user && (!account.billingReady || account.access.pendingMembership)) || busy !== null} onClick={() => choose('monthly')}>{busy === 'monthly' ? 'Preparing payment…' : 'Choose monthly'}<ArrowRight size={17} /></button>
          <p className="plan-cancel">Cancel future renewals anytime.</p>
        </article>
      </div>
      <div className="plan-inclusions">
        <h3>Every plan includes the whole study space</h3>
        <ul>
          <li><Layers size={18} /><span><strong>Real scans, real tools</strong>CT, MRI, X-ray, ultrasound & mammography</span></li>
          <li><Crosshair size={18} /><span><strong>Practice with feedback</strong>Guided cases, anatomy drills & on-call shifts</span></li>
          <li><BookOpen size={18} /><span><strong>The book, connected</strong>Read the explanation, then return to your scan</span></li>
        </ul>
      </div>
      <p className="payment-reassurance"><ShieldCheck size={15} /> Secure on-page checkout · Card, Apple Pay & Google Pay¹</p>
      {!account?.user && <p className="existing-account">Already a member? <button className="text-button" disabled={!ready?.auth} onClick={() => setAuthMode('login')}>Sign in</button></p>}
      </>}
      {account?.access.pendingMembership && <p className="membership-message">You already have a membership awaiting payment confirmation or a billing update. {account.access.manageUrl && <a href={account.access.manageUrl} target="_blank" rel="noopener noreferrer">Open billing in Whop</a>} to check it before purchasing again.</p>}
      {!payment && <p className="membership-fine">Book links open your own copy of the book (included for SSST students). Prices in USD; applicable tax is shown at checkout. ¹Wallet availability depends on your device and payment setup. Payments powered by Whop.</p>}
      {account?.user && !payment && <InviteFriends />}
      {account?.user && <div className="membership-restore"><button disabled={checking} onClick={() => void refreshPayment()}>{checking ? 'Checking with Whop…' : 'Already paid? Check access'}</button>{!account.billingReady && <p>Payments are being configured. Checkout will open once it’s ready.</p>}</div>}
      {(error || new URLSearchParams(location.search).get('signin') === 'failed') && <p className="membership-message" role="alert">{error || 'Email sign-in was canceled or expired. Please try again.'}</p>}
      {!account && error && <button className="text-button" onClick={() => void load()}>Try again</button>}
    </section>
  </>;
  if (account?.user) {
    // Signed in, no plan: the free edition of the app, with the plans on their own screen when asked for.
    const showPlans = plansOpen || !!payment || returned;
    return <AccountContext.Provider value={{ account, logout, free: true, openPlans }}>
      {children}
      {showPlans ? <PlansScreen panel={panel} email={account.user.email} onClose={closePlans} onSignOut={() => void logout()} /> : null}
    </AccountContext.Provider>;
  }
  return <main className="membership-page lp">
    <Landing panel={panel} signInLabel="Sign in" signInDisabled={!ready?.auth}
      onSignIn={() => setAuthMode('login')} onStartFree={() => { setAuthMode('signup'); setError(''); trackFunnel('signup_start', true); }} />
    <dialog className="auth-dialog" ref={dialog} onCancel={() => setAuthMode(null)} onClose={() => setAuthMode(null)} aria-labelledby="auth-title">
      <button className="auth-close" aria-label="Close sign-in" onClick={() => setAuthMode(null)}><X size={20} /></button>
      <div className="auth-icon"><Mail size={25} /></div>
      <div className="auth-tabs" role="tablist" aria-label="Account options">
        <button role="tab" aria-selected={authMode === 'signup'} onClick={() => setAuthMode('signup')}>Create account</button>
        <button role="tab" aria-selected={authMode === 'login'} onClick={() => setAuthMode('login')}>Sign in</button>
      </div>
      <h2 id="auth-title">{authMode === 'signup' ? 'Your next chapter starts here.' : 'Welcome back.'}</h2>
      <p>{authMode === 'signup' ? 'Create your account with your email, right here. No Google account needed.' : 'Sign in with the email you used for your membership.'}</p>
      {selectedPlan && <div className="selected-plan"><Check size={16} />{selectedPlan === 'monthly' ? 'Monthly · $20 / month' : 'Yearly · $12.50/month equivalent · $150 billed yearly'}</div>}
      {authMode && ready?.authProvider === 'clerk' && ready.clerkPublishableKey ? <Suspense fallback={<p className="auth-waiting" role="status">Loading secure sign-in…</p>}>
        <InlineAccount publishableKey={ready.clerkPublishableKey} mode={authMode} onModeChange={setAuthMode} onSuccess={load} />
      </Suspense> : <button className="email-signin" onClick={startSignIn} disabled={!ready?.auth}><Mail size={18} />{authWaiting ? 'Reopen sign-in window' : 'Continue with email'}<ArrowRight size={18} /></button>}
      {authWaiting && <p className="auth-waiting" role="status">Finish verifying your email in the secure window. We’ll continue here automatically.</p>}
      <p className="auth-privacy"><ShieldCheck size={15} />{ready?.authProvider === 'clerk' ? 'Your account is protected by Clerk. Sign-in and payment stay on radiology.monster.' : 'Whop securely verifies your email in a separate window. Your payment happens here on radiology.monster.'}</p>
      {error && <p className="membership-message" role="alert">{error}</p>}
    </dialog>
  </main>;
}
