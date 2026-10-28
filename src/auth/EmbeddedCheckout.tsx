import { useRef, useState } from 'react';
import { loadWhop } from '@whop/elements';
import { Checkout, CheckoutElement, WhopElements } from '@whop/elements-react';
import { LockKeyhole } from 'lucide-react';

const elements = loadWhop();
export default function EmbeddedCheckout({ id, returnUrl, email, onComplete }: { id: string; returnUrl: string; email: string; onComplete: () => void }) {
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const retryLoader = useRef<(() => void) | null>(null);
  return <div className="embedded-checkout">
    <p className="checkout-security"><LockKeyhole size={14} /> Secure payment powered by Whop</p>
    {error && <div className="membership-message" role="alert">The payment form couldn’t load. Check your connection and try again.
      <button className="text-button" onClick={() => { setError(false); if (retryLoader.current) { retryLoader.current(); retryLoader.current = null; } else setAttempt(n => n + 1); }}>Reload payment form</button>
    </div>}
    <WhopElements key={attempt} elements={elements} appearance={{ theme: { appearance: 'dark', accentColor: 'blue', grayColor: 'slate' } }} onLoadError={(_error, retry) => { retryLoader.current = retry; setError(true); }}>
      <Checkout checkoutConfiguration={id} returnUrl={returnUrl} onComplete={onComplete} fallback={<p className="checkout-loading" role="status">Loading secure payment form…</p>}>
        <CheckoutElement buyerEmail={email} lockBuyerEmail onError={() => setError(true)} />
      </Checkout>
    </WhopElements>
  </div>;
}
