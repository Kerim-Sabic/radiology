import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Check, ShieldCheck, LogOut, CreditCard, Mail, X, BookOpen, Crosshair, Layers, LockOpen, School, ChevronDown, CircleHelp, Settings as SettingsIcon, UsersRound } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { Link, useLocation } from 'react-router';
import { fetchInvitation, pendingJoinCode, type Invitation } from './joinCode';
import { withoutAccount } from './returnPath';
import { guestCaseId } from './guest';
import './account.css';
import './plans.css';
import { Landing } from './Landing';
import { InviteFriends } from './InviteFriends';
import { currentReferral } from './referralAttribution';
import { PlansScreen } from './PlansScreen';
import { trackFunnel, WARM_ACCOUNT_EVENT } from '../services/serverSync';
import { ev, evFired } from '../services/ev';
import { ScanLoader } from '../components/ScanState';
import { useOfferTimeLeft, welcomePrice, welcomeTerms, type WelcomeOffer } from './welcomeOffer';
import { regionalTerms, studentTerms, usd, withStudentPrices, yearlyFigures, type RegionalCheckout, type RegionalPrice, rupees } from './regionalPrice';
const EmbeddedCheckout = lazy(() => import('./EmbeddedCheckout'));
const InlineAccount = lazy(() => import('./InlineAccount'));
type Tier = 'monthly' | 'yearly';
const promoKey = 'rvm:promo-code';
/** A code from a shared link (?promo=CODE) is kept for checkout; otherwise the one entered earlier in this tab. */
function rememberedPromo() {
  const fromLink = new URLSearchParams(location.search).get('promo') ?? '';
  try {
    if (/^[A-Za-z0-9_-]{3,30}$/.test(fromLink)) { sessionStorage.setItem(promoKey, fromLink); return fromLink; }
    return sessionStorage.getItem(promoKey) || '';
  } catch { return /^[A-Za-z0-9_-]{3,30}$/.test(fromLink) ? fromLink : ''; }
}
const planKey = 'rvm:selected-plan';
function rememberedPlan(): Tier | null { try { const value = sessionStorage.getItem(planKey); return value === 'monthly' || value === 'yearly' ? value : null; } catch { return null; } }
function rememberPlan(tier: Tier | null) { try { if (tier) sessionStorage.setItem(planKey, tier); else sessionStorage.removeItem(planKey); } catch { /* Storage is optional. */ } }

interface Access { active: boolean; role?: 'admin' | 'granted' | 'professor'; tier?: Tier | 'lifetime'; expiresAt?: string | null; manageUrl?: string | null; pendingMembership?: boolean; }
/** `adminPermissions`: what an admin may see and do on the admin page; `teaches`: a professor; `classes`: the classes a student is in. */
interface Account { user: { name: string; email: string } | null; access: Access; billingReady: boolean; book?: boolean; studentDiscountEligible?: boolean; adminPermissions?: string[]; teaches?: boolean; classes?: Array<{ email: string; name: string }>; welcomeOffer?: WelcomeOffer; regionalPrice?: RegionalPrice; }
interface AccountState {
  account: Account;
  logout: () => void;
  /** Signed in without a plan, or a guest: the free edition (the sample patients). */
  free: boolean;
  /** No account: a visitor trying a sample patient from a link. Answers stay on this device until they sign up. */
  guest: boolean;
  /** Open the plans screen (free accounts; a guest gets the sign-up form). */
  openPlans: () => void;
  /** Open the sign-up or sign-in form over the page (guests; does nothing for an account). */
  startAccount: (mode: 'signup' | 'login') => void;
}
const GUEST_ACCOUNT: Account = { user: null, access: { active: false }, billingReady: false };
const noAccountForm = () => undefined;
const AccountContext = createContext<AccountState | null>(null);

/** The signed-in account, or null where there is none (local development without the gate). */
export function useAccount(): AccountState | null {
  return useContext(AccountContext);
}

/**
 * The welcome gift on the plans screen: what it takes off (at the price for the visitor's country when there is one), how
 * long it has left, and whether the code is filled in.
 */
function WelcomeOfferNote({ offer, regional, applied, onApply }: { offer: WelcomeOffer; regional?: RegionalPrice; applied: boolean; onApply: () => void }) {
  const left = useOfferTimeLeft(offer);
  if (!left) return null;
  return (
    <div className="welcome-offer" role="note">
      <span className="welcome-offer-kicker">Your welcome gift · {left} left</span>
      <strong>{offer.percent}% off your first payment</strong>
      <span>{welcomeTerms(offer.percent, regional)}</span>
      {applied ? <span className="welcome-offer-code"><Check size={15} /> Code <code>{offer.code.toUpperCase()}</code> is filled in. Choose a plan.</span> : <button type="button" className="text-button" onClick={onApply}>Use my code {offer.code.toUpperCase()}</button>}
    </div>
  );
}

/**
 * Where prices are one-time passes (India, Pakistan, Bangladesh and the rest of that tier), banks issue cards with
 * international online payments off (India: RBI rule since 2020), so a first try is declined unless the buyer turns
 * them on. Said before checkout rather than after a decline.
 */
export const CARD_TIP = ' Cards here often have international online payments switched off: turn them on in your bank app first.';

/** The price for the visitor's country, the one condition that comes with it (a card issued there), and the student price there. */
function RegionalPriceNote({ price, welcome }: { price: RegionalPrice; welcome: boolean }) {
  return (
    <div className="regional-price" role="note">
      <span className="regional-price-kicker">Price for {price.countryName}</span>
      <strong>{price.monthly.pass ? `${usd(price.monthly.price)} for 30 days · ${usd(price.yearly.price)} for a year` : `${usd(price.monthly.price)} a month · ${usd(price.yearly.price)} a year`}</strong>
      <span>Pay with a card issued in {price.countryName}. Cards from other countries are declined at checkout.{price.monthly.pass ? ` Each payment is one-time and never renews.${price.upi ? ` Pay by UPI (${rupees(price.upi.monthly)} for 30 days · ${rupees(price.upi.yearly)} for a year) or by card.` : ''}${CARD_TIP}` : ''}{price.student ? ` With a verified university email: ${studentTerms(price)}.` : ''}{welcome ? ' Your welcome code works on these prices; any other promo code uses the standard price.' : ' A promo code uses the standard price.'}</span>
    </div>
  );
}

/** The sign-in on another device that ended this browser's session (server/devices.ts). */
interface EndedBy { at: string; country: string | null; label: string }
function endedByText(e: EndedBy) {
  let place = '';
  try { place = e.country ? ` in ${new Intl.DisplayNames(['en'], { type: 'region' }).of(e.country) ?? e.country}` : ''; } catch { place = e.country ? ` in ${e.country}` : ''; }
  const when = new Date(e.at).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  return `You were signed out because your account was opened on ${e.label}${place} (${when}). An account is for one person, on one device at a time. If that wasn’t you, sign in again: that device will be signed out.`;
}
function EndedByBanner({ endedBy, onSignIn }: { endedBy: EndedBy; onSignIn: () => void }) {
  return <div className="invite-banner" role="status">
    <span>{endedByText(endedBy)}</span>
    <span className="invite-banner-actions"><button className="text-button" onClick={onSignIn}>Sign in</button></span>
  </div>;
}

/** A class invitation from a join link, for a visitor who is not signed in yet. */
function InviteBanner({ onJoin, onSignIn }: { onJoin: () => void; onSignIn: () => void }) {
  const [invite, setInvite] = useState<Invitation | null>(null);
  useEffect(() => {
    const code = pendingJoinCode();
    if (code) void fetchInvitation(code).then(setInvite);
  }, []);
  if (!invite) return null;
  return <div className="invite-banner" role="note">
    <School size={18} aria-hidden="true" />
    <span><b>{invite.name}</b> invited you to their class on radiology.monster.{invite.free ? ' It includes free access to everything.' : ''} Create a free account or sign in, then join.</span>
    <span className="invite-banner-actions">
      <button className="lp-btn primary small" onClick={onJoin}>Create a free account</button>
      <button className="text-button" onClick={onSignIn}>Sign in</button>
    </span>
  </div>;
}

/** What the account holds, in a few words: the plan, or the free access and until when. */
function accessLabel(account: Account, free: boolean): string {
  const a = account.access;
  if (free) return 'Free account · two sample patients';
  if (a.role === 'admin') return 'Admin · free access';
  if (a.role === 'professor') return 'Professor · free access';
  if (a.role === 'granted') return a.expiresAt
    ? `Free access until ${new Date(a.expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}`
    : 'Free access';
  return a.tier === 'lifetime' ? 'Lifetime member' : a.tier === 'yearly' ? 'Yearly member' : 'Monthly member';
}

/** Two letters for the avatar: the first and last name's initials, else the email's first letter. */
function initials(user: Account['user']): string {
  const words = (user?.name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (user?.email?.[0] ?? '?').toUpperCase();
}

/**
 * The account in the top bar: one button with the member's initials, opening a menu with who is signed in, the plan,
 * billing, settings, the guide, the class and admin pages for those who have them, and sign out. A free account also
 * keeps an Upgrade button beside it. Local development without an account keeps Settings and the guide.
 */
export function AccountMenu() {
  const context = useContext(AccountContext);
  const account = context?.account;
  const item = (to: string, icon: ReactNode, label: string) => (
    <DropdownMenu.Item asChild>
      <Link to={to} className="acct-item">{icon}<span>{label}</span></Link>
    </DropdownMenu.Item>
  );
  return <span className="acct">
    {context?.free ? <button className="acct-upgrade" onClick={context.openPlans} title="See the plans"><LockOpen size={15} /><span>Upgrade</span></button> : null}
    {context && !context.free ? <InviteFriends /> : null}
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <button className="acct-trigger" aria-label="Account" title={account?.user?.email ?? 'Settings and guide'}>
          {account ? <span className="acct-avatar" aria-hidden>{initials(account.user)}</span> : <SettingsIcon size={16} aria-hidden />}
          <ChevronDown size={14} aria-hidden className="acct-chevron" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="nav-menu acct-menu" align="end" sideOffset={8}>
          {account ? <div className="acct-head">
            <span className="acct-avatar lg" aria-hidden>{initials(account.user)}</span>
            <span className="acct-who">
              <b>{account.user?.name || account.user?.email || 'Your account'}</b>
              {account.user?.name && account.user.email ? <small>{account.user.email}</small> : null}
              <span className="acct-plan">{accessLabel(account, !!context?.free)}</span>
            </span>
          </div> : null}
          {account ? <DropdownMenu.Separator className="nav-sep" /> : null}
          {context?.free ? <DropdownMenu.Item className="acct-item" onSelect={context.openPlans}><LockOpen size={16} /><span>See the plans</span></DropdownMenu.Item> : null}
          {account?.access.manageUrl ? <DropdownMenu.Item asChild>
            <a className="acct-item" href={account.access.manageUrl} target="_blank" rel="noopener noreferrer"><CreditCard size={16} /><span>Billing</span></a>
          </DropdownMenu.Item> : null}
          {account?.teaches ? item('/class', <School size={16} />, 'My class') : null}
          {account?.access.role === 'admin' ? item('/admin', <UsersRound size={16} />, 'Admin') : null}
          {item('/settings', <SettingsIcon size={16} />, 'Settings')}
          {item('/guide', <CircleHelp size={16} />, 'Guide')}
          {context ? <>
            <DropdownMenu.Separator className="nav-sep" />
            <DropdownMenu.Item className="acct-item" onSelect={context.logout}><LogOut size={16} /><span>Sign out</span></DropdownMenu.Item>
          </> : null}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
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
  const { pathname } = useLocation();
  const [referral] = useState(currentReferral);
  const [account, setAccount] = useState<Account | null>(null);
  // regionalPrice: the price for the visitor's country (server/regional.ts), sent before sign-in so the landing page shows it.
  const [ready, setReady] = useState<{ auth: boolean; billing: boolean; authProvider?: 'clerk' | 'whop'; clerkPublishableKey?: string; regionalPrice?: RegionalPrice } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  // Signed out because the account was opened on another device: where and when (server/devices.ts).
  const [endedBy, setEndedBy] = useState<EndedBy | null>(null);
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
  // Once a guest has been graded, fetch the account form's own code in the background (it is the next step offered).
  // Clerk's script itself loads when the form opens: a second, hidden Clerk instance would keep the wrong settings.
  useEffect(() => {
    const warm = () => void import('./InlineAccount').catch(() => undefined);
    window.addEventListener(WARM_ACCOUNT_EVENT, warm);
    return () => window.removeEventListener(WARM_ACCOUNT_EVENT, warm);
  }, []);
  function closePlans() {
    setPlansOpen(false); setPayment(null); setReturned(false); setError('');
    const q = new URLSearchParams(location.search);
    if (q.has('plans') || q.has('checkout')) { q.delete('plans'); q.delete('checkout'); history.replaceState(null, '', `${location.pathname}${q.size ? `?${q}` : ''}`); }
  }
  const [promoCode, setPromoCode] = useState(rememberedPromo);
  const [payment, setPayment] = useState<{ id: string; returnUrl: string; tier: Tier; promoCode?: string; enteredPromoCode: string; studentDiscount?: boolean; welcome?: boolean; regional?: RegionalCheckout } | null>(null);
  function updatePromo(value: string) {
    setPromoCode(value);
    try { if (value) sessionStorage.setItem(promoKey, value); else sessionStorage.removeItem(promoKey); } catch { /* Optional storage. */ }
  }
  // A new account's personal welcome code fills the promo field once per tab (removing it is respected after that). It
  // works on the price for the visitor's country too (server/billing.ts checkout).
  const welcomeCode = account?.welcomeOffer?.code;
  useEffect(() => {
    if (!welcomeCode) return;
    try {
      if (sessionStorage.getItem('rvm:welcome-applied') === welcomeCode) return;
      sessionStorage.setItem('rvm:welcome-applied', welcomeCode);
    } catch { /* Optional storage. */ }
    setPromoCode((current) => {
      if (current.trim()) return current;
      try { sessionStorage.setItem(promoKey, welcomeCode); } catch { /* Optional storage. */ }
      return welcomeCode;
    });
  }, [welcomeCode]);
  const authWindow = useRef<Window | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const checkoutHeading = useRef<HTMLHeadingElement>(null);
  const checkoutGeneration = useRef(0);
  // The price a plan button stands for, read by `buy` through a ref: `buy` is memoised and may be created in a render
  // that returns early (still loading), before the prices are worked out.
  const planAmountRef = useRef<(tier: Tier) => number>(() => 0);
  const mounted = useRef(true);
  const signedIn = useRef(false);
  const generation = useRef(0);

  const load = useCallback(async () => {
    const current = ++generation.current;
    try {
      const response = await fetch('/api/session', { cache: 'no-store' });
      if (!mounted.current || current !== generation.current) return;
      if (response.status === 401) {
        const body = await response.json().catch(() => null) as { endedBy?: EndedBy } | null;
        if (!mounted.current || current !== generation.current) return;
        const elsewhere = body?.endedBy && Date.now() - Date.parse(body.endedBy.at) < 7 * 86400000 ? body.endedBy : null;
        setAccount(null);
        setPayment(null);
        setBusy(null);
        checkoutGeneration.current++;
        setEndedBy(elsewhere);
        if (signedIn.current) setError(elsewhere ? endedByText(elsewhere) : 'Your session ended. If you signed in on another device, that device is now active.');
        signedIn.current = false;
        return;
      }
      if (!response.ok) throw new Error('We couldn’t verify your access. Check your connection and try again.');
      const data: Account = await response.json();
      if (!mounted.current || current !== generation.current) return;
      signedIn.current = !!data.user;
      setAccount(data);
      setError('');
      if (data.user) setEndedBy(null);
      if (data.user) { setAuthMode(null); setAuthWaiting(false); }
      if (data.user && new URLSearchParams(location.search).has('account')) history.replaceState(null, '', withoutAccount());
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
  const buy = useCallback(async (tier: Tier, method: 'card' | 'upi' = 'card') => {
    const current = ++checkoutGeneration.current;
    setBusy(tier); setError('');
    // A plan button pressed (the funnel step between "Opened the plans" and "Saw the payment form").
    trackFunnel('checkout_start');
    ev('plan_click', { period: tier, amount: planAmountRef.current(tier) });
    try {
      const affiliate = currentReferral() || referral;
      const enteredPromoCode = promoCode.trim().toLowerCase();
      const response = await fetch('/api/billing/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tier, ...(enteredPromoCode ? { promoCode: enteredPromoCode } : {}), ...(affiliate ? { affiliateCode: affiliate } : {}), ...(method === 'upi' ? { method } : {}) }) });
      const data = await response.json();
      if (!mounted.current || current !== checkoutGeneration.current) return;
      if (!response.ok) throw new CheckoutHttpError(data.error, response.status);
      if (!/^ch_[A-Za-z0-9]+$/.test(data.id)) throw new Error('Unable to open the payment form. Please try again.');
      setPayment({ id: data.id, returnUrl: data.returnUrl, tier, promoCode: data.promoCode, enteredPromoCode, studentDiscount: data.studentDiscount, welcome: data.welcome === true, ...(data.regional ? { regional: data.regional } : {}) });
      setPlansOpen(true); // "Change plan" goes back to the plans, not to the app
      rememberPlan(null);
    } catch (e) {
      // The payment form never appeared: the server refused or failed (counted, so a broken checkout shows in the funnel).
      trackFunnel('checkout_error');
      ev('api_error', { route: '/api/billing/checkout', status: e instanceof CheckoutHttpError ? e.status : 0 });
      if (mounted.current && current === checkoutGeneration.current) setError(e instanceof Error ? e.message : 'Checkout is unavailable. Please try again.');
    }
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

  if (account?.access.active) return <AccountContext.Provider value={{ account, logout, free: false, guest: false, openPlans, startAccount: noAccountForm }}>{children}</AccountContext.Provider>;
  if (loading) return <ScanLoader label="Opening your study space…" />;
  const student = account?.studentDiscountEligible === true;
  // Signed in: the account's price (none once a member). Signed out: the price for the visitor's country from /api/config.
  const regional = account?.user ? account.regionalPrice : ready?.regionalPrice;
  const welcomeOffer = account?.welcomeOffer;
  // The plan cards show the price for the visitor's country with no code or with their own welcome code; any other code
  // means the standard price (server/billing.ts checkout decides the same way).
  const regionalShown = regional && (!promoCode.trim() || promoCode.trim().toLowerCase() === welcomeOffer?.code) ? regional : undefined;
  // A verified student with no code sees the student price for their country (30% off every payment) while student prices
  // are on there; a welcome code instead takes 40% off the first payment (discounts do not stack).
  const studentRegional = student && regionalShown?.student && !promoCode.trim() ? withStudentPrices(regionalShown) : undefined;
  const cardPrice = studentRegional ?? regionalShown;
  const planAmount = (tier: Tier) => (cardPrice ? (tier === 'monthly' ? cardPrice.monthly.price : cardPrice.yearly.price) : tier === 'monthly' ? 20 : 150);
  planAmountRef.current = planAmount;
  // The plans were on screen: what was shown, from where (signed in: the plans screen; signed out: the home page).
  const seenPlans = () =>
    ev('plans_view', {
      from: account?.user ? 'account' : 'home',
      currency: 'USD',
      regional: !!regional,
      pass: !!cardPrice?.monthly.pass,
      student: !!studentRegional || student,
      code: !!promoCode.trim(),
      monthly: planAmount('monthly'),
      yearly: planAmount('yearly'),
    }, true);
  const checkoutCodeChanged = promoCode.trim().toLowerCase() !== (payment?.enteredPromoCode || '');
  const panel = <>
    <section className="membership-panel" id="plans" aria-label="Membership">
      {payment && account?.user ? <>
        <button className="checkout-back text-button" onClick={() => { setPayment(null); setError(''); }}><ArrowLeft size={15} /> Change plan</button>
        <span className="membership-step">Checkout</span>
        <h2 ref={checkoutHeading} tabIndex={-1}>Your study space is almost ready.</h2>
        <p className="checkout-account">{account.user.email}</p>
        {payment.regional && regional?.upi && !payment.studentDiscount && <p className="student-offer upi-switch" role="status">
          <strong>{payment.regional.method === 'upi' ? `Paying ${rupees(payment.regional.rupees ?? 0)} by UPI` : `Pay by UPI instead: ${rupees(regional.upi[payment.tier])}`}</strong>
          <span>{payment.regional.method === 'upi' ? 'Approve it in your UPI app (Google Pay, PhonePe, Paytm or your bank’s). ' : 'No card needed: approve it in your UPI app. '}
            <button className="text-button" disabled={!!busy} onClick={() => void buy(payment.tier, payment.regional?.method === 'upi' ? 'card' : 'upi')}>{payment.regional.method === 'upi' ? 'Pay by card instead' : 'Pay by UPI'}</button>
          </span>
        </p>}
        {payment.regional && <p className="student-offer regional-applied" role="status"><strong>Price for {payment.regional.countryName}: {regionalTerms(payment.regional)}</strong><span>Pay with a card issued in {payment.regional.countryName}. Cards from other countries are declined.{payment.regional.pass ? CARD_TIP : ''}{payment.welcome ? ' Your welcome code works on this price; any other code switches to the standard price.' : ' A promo code switches to the standard price.'}</span></p>}
        {payment.studentDiscount && <p className="student-offer" role="status"><strong>30% student discount applied</strong><span>{payment.regional?.studentPrice ? `${regionalTerms({ ...payment.regional, price: payment.regional.studentPrice })}${payment.regional.pass ? ', and 30% off every pass you buy' : ', including every renewal'}` : `${payment.tier === 'monthly' ? '$14 USD every 30 days' : '$105 USD every 365 days'}, including every renewal`}. {payment.enteredPromoCode ? 'Your student offer gives a better recurring price than that code.' : 'Your university email is verified.'}</span></p>}
        {payment.welcome && <p className="student-offer welcome-applied" role="status"><strong>Your welcome gift is applied: {welcomeOffer?.percent ?? 40}% off your first payment{payment.regional ? ` (${welcomePrice(payment.regional.price, welcomeOffer?.percent ?? 40)} instead of ${usd(payment.regional.price)})` : ''}</strong><span>{payment.regional ? (payment.regional.pass ? 'One payment; nothing renews.' : `Renewals are ${regionalTerms(payment.regional)}.`) : 'Renewals are at the standard price.'}{student && (!payment.regional || regional?.student) ? ` Remove the code to use your 30% student price on every ${payment.regional?.pass ? 'pass' : 'renewal'} instead.` : ''} Discounts do not stack.</span></p>}
        {student && payment.studentDiscount === false && !payment.welcome && <p className="student-offer">Your promo gives an equal or better recurring discount. Discounts do not stack.</p>}
        <form className="promo-entry checkout-promo" onSubmit={event => { event.preventDefault(); if (!busy && checkoutCodeChanged) void buy(payment.tier); }}>
          <label htmlFor="checkout-promo">Promo code</label>
          <div className="checkout-promo-row"><input id="checkout-promo" value={promoCode} maxLength={40} autoComplete="off" autoCapitalize="none" spellCheck={false} disabled={!!busy} onChange={event => updatePromo(event.target.value)} placeholder="Enter your code" /><button type="submit" className="text-button" disabled={!!busy || !checkoutCodeChanged}>{busy ? 'Updating…' : payment.enteredPromoCode && !promoCode.trim() ? 'Remove code' : 'Apply code'}</button></div>
          <p>Apply your code here so we can open the matching offer. Whop confirms the discount before payment.</p>
        </form>
        {busy || checkoutCodeChanged ? <p className="checkout-loading" role="status">{busy ? 'Updating your payment form…' : 'Apply your code to update the price before paying.'}</p> : <Suspense fallback={<p className="checkout-loading" role="status">Loading secure payment form…</p>}>
          <EmbeddedCheckout key={`${payment.id}:${payment.promoCode || ''}`} id={payment.id} returnUrl={payment.returnUrl} email={account.user.email} promoCode={payment.promoCode} onComplete={() => { setReturned(true); void refreshPayment(); }} />
        </Suspense>}
        <p className="membership-fine">{payment.promoCode ? 'Your code is prefilled in the payment form. Review the discounted recurring total before paying; Whop confirms whether it is still available.' : payment.regional ? `Regional price: ${regionalTerms(payment.regional)}.` : payment.tier === 'monthly' ? 'Standard price: $20 USD every 30 days.' : 'Standard price: $150 USD every 365 days.'} Discounts and any applicable tax are shown in the payment form. {payment.regional?.pass ? 'Nothing renews.' : 'Cancel future renewals from Billing.'} Access opens after payment is verified.</p>
      </> : <>
      <SeenOnce onSeen={seenPlans} />
      <span className="membership-step">{account?.user ? 'Choose your plan' : 'Membership'}</span>
      <h2>{account?.user ? 'Unlock the whole library.' : 'The whole library, every tool.'}</h2>
      <p>{account?.user ? `Signed in as ${account.user.email}` : 'One membership for every patient, drill and on-call shift, with the book beside you.'}</p>
      {regional && <RegionalPriceNote price={regional} welcome={!!welcomeOffer} />}
      {welcomeOffer && <WelcomeOfferNote offer={welcomeOffer} regional={regional} applied={promoCode.trim().toLowerCase() === welcomeOffer.code} onApply={() => updatePromo(welcomeOffer.code)} />}
      {!regional && <>
        <p className="student-offer"><strong>{student ? 'Your verified university email unlocks 30% off' : '30% off for eligible university email addresses'}</strong><span>{student ? 'Student prices include every renewal. A better recurring promo takes precedence; discounts do not stack.' : 'Verify an eligible email, including .edu, .edu.ba or .ac.uk, for $14 every 30 days or $105 every 365 days. The discount continues on every renewal.'}</span></p>
      </>}
      {regional?.student && <p className="student-offer"><strong>{student ? `Your verified university email unlocks 30% off in ${regional.countryName}` : `30% off in ${regional.countryName} for eligible university email addresses`}</strong><span>{student
        ? `${studentTerms(regional)}, on every ${regional.monthly.pass ? 'pass' : 'payment'}.${welcomeOffer ? ' Your welcome code takes 40% off the first payment instead; discounts do not stack.' : ''}`
        : `Verify an eligible email, including .edu, .edu.ba or .ac.uk, for ${studentTerms(regional)}. The discount applies to every ${regional.monthly.pass ? 'pass' : 'payment'}.`}</span></p>}
      {ready && !ready.auth && <p className="membership-message">Sign-in is temporarily unavailable. Please try again shortly.</p>}
      <details className="promo-entry" open={!!promoCode}><summary>Have a promo code?</summary><label htmlFor="membership-promo">Promo code</label><input id="membership-promo" value={promoCode} maxLength={40} autoComplete="off" autoCapitalize="none" spellCheck={false} onChange={event => updatePromo(event.target.value)} placeholder="Enter your code before choosing a plan" /><p>{regional ? (welcomeOffer ? 'Your welcome code works on the price for your country. Any other code applies to the standard price ($20 a month or $150 a year).' : 'A code applies to the standard price ($20 a month or $150 a year), not to the price for your country.') : 'Choose a plan below. Your discount will appear in the secure payment form.'}</p></details>
      <div className="membership-plans">
        <article className="membership-plan yearly" aria-labelledby="yearly-plan-title">
          <span className="membership-best">Best value</span>
          <div className="plan-heading"><h3 id="yearly-plan-title">Yearly</h3><span>For a year of steady progress</span></div>
          {cardPrice ? <>
            <div className="membership-price">{yearlyFigures(cardPrice).perMonth}<span>/ month</span></div>
            <p className="plan-billing"><strong>{usd(cardPrice.yearly.price)} {cardPrice.yearly.pass ? 'for a year' : 'billed yearly'}</strong><span>{cardPrice.yearly.pass ? 'One payment for 365 days. It does not renew.' : 'One payment every 365 days.'}{studentRegional ? ' Student price.' : ''}</span></p>
            <div className="plan-value"><strong>Save {yearlyFigures(cardPrice).saves}</strong><span>vs. 12 {cardPrice.monthly.pass ? 'monthly passes' : 'monthly payments'}</span></div>
          </> : <>
            <div className="membership-price">{student ? '$8.75' : '$12.50'}<span>/ month</span></div>
            <p className="plan-billing"><strong>{student ? '$105' : '$150'} billed yearly</strong><span>One payment every 365 days.{student ? ' Student price, every renewal.' : ''}</span></p>
            <div className="plan-value"><strong>Save {student ? '$63' : '$90'}</strong><span>vs. 12 monthly payments</span></div>
          </>}
          <p className="plan-access">Full access for your whole study year.</p>
          <button aria-describedby="yearly-billing-note" disabled={!ready?.auth || (!!account?.user && (!account.billingReady || account.access.pendingMembership)) || busy !== null} onClick={() => choose('yearly')}>{busy === 'yearly' ? 'Preparing payment…' : 'Start yearly'}<ArrowRight size={17} /></button>
          <p className="plan-cancel" id="yearly-billing-note">{regionalShown?.yearly.pass ? 'One payment. Nothing renews.' : 'Billed annually. Cancel future renewals anytime.'}</p>
        </article>
        <article className="membership-plan monthly" aria-labelledby="monthly-plan-title">
          <div className="plan-heading"><h3 id="monthly-plan-title">Monthly</h3><span>For a shorter study stretch</span></div>
          {cardPrice ? <>
            <div className="membership-price">{usd(cardPrice.monthly.price)}<span>{cardPrice.monthly.pass ? '/ 30 days' : '/ month'}</span></div>
            <p className="plan-billing"><strong>{usd(cardPrice.monthly.price)} {cardPrice.monthly.pass ? 'for 30 days' : 'billed every 30 days'}</strong><span>{cardPrice.monthly.pass ? 'One payment. Buy again when it ends.' : 'A smaller upfront payment.'}{studentRegional ? (cardPrice.monthly.pass ? ' Student price, every pass.' : ' Student price, every renewal.') : ''}</span></p>
          </> : <>
            <div className="membership-price">{student ? '$14' : '$20'}<span>/ month</span></div>
            <p className="plan-billing"><strong>{student ? '$14' : '$20'} billed every 30 days</strong><span>{student ? 'Student price, every renewal.' : 'A smaller upfront payment.'}</span></p>
          </>}
          <p className="plan-access">The same full access, one month at a time.</p>
          <button disabled={!ready?.auth || (!!account?.user && (!account.billingReady || account.access.pendingMembership)) || busy !== null} onClick={() => choose('monthly')}>{busy === 'monthly' ? 'Preparing payment…' : regionalShown?.monthly.pass ? 'Get 30 days' : 'Choose monthly'}<ArrowRight size={17} /></button>
          <p className="plan-cancel">{regionalShown?.monthly.pass ? 'One payment. Nothing renews.' : 'Cancel future renewals anytime.'}</p>
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
    return <AccountContext.Provider value={{ account, logout, free: true, guest: false, openPlans, startAccount: noAccountForm }}>
      {children}
      {showPlans ? <PlansScreen panel={panel} email={account.user.email} onClose={closePlans} onSignOut={() => void logout()} /> : null}
    </AccountContext.Provider>;
  }
  const startFree = (where = 'home') => { setAuthMode('signup'); setError(''); trackFunnel('signup_start', true); ev('save_click', { where }); };
  const authDialog = (
    <dialog className="auth-dialog" ref={dialog} onCancel={() => setAuthMode(null)} onClose={() => { if (!account?.user && authMode === 'signup') ev('account_abandon', { step: evFired('code_sent') ? 'code_sent' : evFired('email_focus') ? 'email_focus' : evFired('form_shown') ? 'form_shown' : 'opened' }); setAuthMode(null); }} aria-labelledby="auth-title">
      <button className="auth-close" aria-label="Close sign-in" onClick={() => setAuthMode(null)}><X size={20} /></button>
      <div className="auth-icon"><Mail size={25} /></div>
      <div className="auth-tabs" role="tablist" aria-label="Account options">
        <button role="tab" aria-selected={authMode === 'signup'} onClick={() => setAuthMode('signup')}>Create account</button>
        <button role="tab" aria-selected={authMode === 'login'} onClick={() => setAuthMode('login')}>Sign in</button>
      </div>
      <h2 id="auth-title">{authMode === 'signup' ? 'Your next chapter starts here.' : 'Welcome back.'}</h2>
      <p>{authMode === 'signup' ? 'Create your account with your email, right here. No Google account needed.' : 'Sign in with the email you used for your membership.'}</p>
      {selectedPlan && <div className="selected-plan"><Check size={16} />{regionalShown
        ? (selectedPlan === 'monthly'
          ? `Monthly · ${usd(regionalShown.monthly.price)} ${regionalShown.monthly.pass ? 'for 30 days' : '/ month'}${regionalShown.student ? ` · students ${usd(regionalShown.student.monthly)}` : ''}`
          : `Yearly · ${yearlyFigures(regionalShown).perMonth}/month equivalent · ${usd(regionalShown.yearly.price)} ${regionalShown.yearly.pass ? 'for a year' : 'billed yearly'}${regionalShown.student ? ` · students ${usd(regionalShown.student.yearly)}` : ''}`)
        : (selectedPlan === 'monthly' ? 'Monthly · $20 / month' : 'Yearly · $12.50/month equivalent · $150 billed yearly')}</div>}
      {authMode && ready?.authProvider === 'clerk' && ready.clerkPublishableKey ? <Suspense fallback={<p className="auth-waiting" role="status">Loading secure sign-in…</p>}>
        <InlineAccount publishableKey={ready.clerkPublishableKey} mode={authMode} onModeChange={setAuthMode} onSuccess={load} />
      </Suspense> : <button className="email-signin" onClick={startSignIn} disabled={!ready?.auth}><Mail size={18} />{authWaiting ? 'Reopen sign-in window' : 'Continue with email'}<ArrowRight size={18} /></button>}
      {authWaiting && <p className="auth-waiting" role="status">Finish verifying your email in the secure window. We’ll continue here automatically.</p>}
      <p className="auth-privacy"><ShieldCheck size={15} />{ready?.authProvider === 'clerk' ? 'Your account is protected by Clerk. Sign-in and payment stay on radiology.monster.' : 'Whop securely verifies your email in a separate window. Your payment happens here on radiology.monster.'}</p>
      {error && <p className="membership-message" role="alert">{error}</p>}
    </dialog>
  );
  // No account, on a sample patient's page (an ad or a shared link): the reading room opens as a guest. Signing up
  // from here keeps the page (src/auth/returnPath.ts) and the answers given on it (the first account to sync in a
  // browser takes the history already there).
  if (guestCaseId(pathname)) {
    return <AccountContext.Provider value={{ account: account ?? GUEST_ACCOUNT, logout, free: true, guest: true, openPlans: () => startFree('plans'), startAccount: (mode) => (mode === 'login' ? setAuthMode('login') : startFree('case')) }}>
      {children}
      {authDialog}
    </AccountContext.Provider>;
  }
  return <main className="membership-page lp">
    {endedBy ? <EndedByBanner endedBy={endedBy} onSignIn={() => setAuthMode('login')} /> : null}
    <InviteBanner onJoin={() => startFree('invite')} onSignIn={() => setAuthMode('login')} />
    <Landing panel={panel} regional={regional} signInLabel="Sign in" signInDisabled={!ready?.auth}
      onSignIn={() => setAuthMode('login')} onStartFree={() => startFree('home')} />
    {authDialog}
  </main>;
}

/** The checkout request failed with this HTTP status (logged as an api_error). */
class CheckoutHttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** Calls `onSeen` once, the first time this point of the page is on screen. */
function SeenOnce({ onSeen }: { onSeen: () => void }) {
  const ref = useRef<HTMLSpanElement>(null);
  const seen = useRef(onSeen);
  seen.current = onSeen;
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver !== 'function') return void seen.current();
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        seen.current();
        io.disconnect();
      }
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <span ref={ref} aria-hidden="true" />;
}
