import { useEffect, useState, useSyncExternalStore } from 'react';
import { useLocation } from 'react-router';
import { AD_CHOICE_EVENT, getAdChoice, promptSuppressed, rememberClickId, setAdChoice, syncAdConsent, trackPageView } from '../services/metaPixel';
import '../styles/adconsent.css';

const subscribe = (notify: () => void) => {
  window.addEventListener(AD_CHOICE_EVENT, notify);
  window.addEventListener('storage', notify);
  return () => { window.removeEventListener(AD_CHOICE_EVENT, notify); window.removeEventListener('storage', notify); };
};
export const useAdChoice = () => useSyncExternalStore(subscribe, getAdChoice, () => null);

const TEXT = 'Allow ad measurement? Radiology Monster can tell Meta (Instagram and Facebook) that a visit led to a purchase, so its ads reach more students. It never shares your answers, scans or the cases you open.';

/** The choice itself: two buttons and one honest sentence. */
function Choice({ className }: { className: string }) {
  return (
    <div className={className} role="region" aria-label="Ad measurement">
      <p>{TEXT}</p>
      <div className="adc-buttons">
        <button type="button" className="adc-yes" onClick={() => setAdChoice('yes')}>Allow</button>
        <button type="button" className="adc-no" onClick={() => setAdChoice('no')}>No thanks</button>
      </div>
    </div>
  );
}

/** A small bar at the bottom of pages that are not a case, until the visitor chooses. Kept off the case so it never covers a scan. */
export function AdConsentBar() {
  const choice = useAdChoice();
  const { pathname } = useLocation();
  const [ready, setReady] = useState(false);
  useEffect(() => { const t = setTimeout(() => setReady(true), 2500); return () => clearTimeout(t); }, []);
  if (choice || !ready || promptSuppressed(pathname)) return null;
  return <Choice className="adc-bar" />;
}

/** The same choice inside the plans screen, the moment before paying, when the bar is not on screen. */
export function AdConsentLine() {
  const choice = useAdChoice();
  if (choice) return null;
  return <Choice className="adc-line" />;
}

/** In Settings: what was chosen, and a way to change it. */
export function AdMeasurementSetting() {
  const choice = useAdChoice();
  return (
    <section className="card stack">
      <h2>Ad measurement</h2>
      <p className="muted">
        {choice === 'yes'
          ? 'Allowed: Meta (Instagram and Facebook) learns that a visit led to a purchase, with the amount. It never sees your answers, scans or the cases you open.'
          : 'Not allowed: nothing is shared with Meta.'}
      </p>
      <div className="adc-buttons">
        <button type="button" className="btn" onClick={() => setAdChoice(choice === 'yes' ? 'no' : 'yes')}>{choice === 'yes' ? 'Stop sharing' : 'Allow'}</button>
      </div>
    </section>
  );
}

/** Loads the Pixel after a yes, reports the page views it may see, and passes the choice on to the account. */
export function MetaMeasurement() {
  const choice = useAdChoice();
  const { pathname, search } = useLocation();
  // The Pixel itself starts only on a page it may see (trackPageView and reportPurchase), never on a case.
  useEffect(() => {
    if (choice === 'yes') rememberClickId();
  }, [choice]);
  useEffect(() => { trackPageView(pathname, search); }, [choice, pathname, search]);
  useEffect(() => { void syncAdConsent(); }, [choice]);
  return null;
}
