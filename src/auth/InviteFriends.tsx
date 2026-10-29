import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUpRight, Check, Copy, Gift, X } from 'lucide-react';
import { affiliateBalance, affiliatePortal } from '../../shared/referrals';
import './referrals.css';

export function InviteFriends() {
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [revision, setRevision] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) { dialog.current?.close(); return; }
    dialog.current?.showModal();
    const controller = new AbortController();
    setLoading(true); setError(''); setLink(null); setCopied(false);
    fetch('/api/referrals', { cache: 'no-store', signal: controller.signal }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error('We couldn’t load your link. You can still get it in the Whop affiliate portal.');
      if (data.shareUrl && !/^https:\/\/whop\.com\/e\/trk_zpdZ5h59TRkTrN\/[a-z0-9_.-]+$/.test(data.shareUrl)) throw new Error('Please get your link in the Whop affiliate portal.');
      if (!controller.signal.aborted) setLink(data.shareUrl || null);
    }).catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Unable to load your link.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [open, revision]);

  async function copy() {
    if (!link) return;
    try { await navigator.clipboard.writeText(link); setCopied(true); setError(''); }
    catch { input.current?.focus(); input.current?.select(); setError('Your link is selected. Copy it using your device’s copy command.'); }
  }

  return <>
    <button className="invite-trigger" onClick={() => setOpen(true)} title="Invite friends · earn 20%" aria-label="Invite friends"><Gift size={16} /><span>Invite friends</span></button>
    {createPortal(<dialog className="referral-dialog" ref={dialog} aria-labelledby="referral-title" onCancel={() => setOpen(false)} onClose={() => setOpen(false)}>
      <button className="referral-close" onClick={() => setOpen(false)} aria-label="Close referrals"><X size={20} /></button>
      <div className="referral-icon"><Gift size={26} /></div>
      <p className="referral-eyebrow">BETTER WITH A STUDY PARTNER</p>
      <h2 id="referral-title">Share the practice.<br />Earn <em>20% cash.</em></h2>
      <p className="referral-intro">Invite a friend to radiology.monster. When they buy through your link, you earn a commission — including on eligible renewals.</p>
      <div className="referral-examples" aria-label="Full-price commission examples">
        <div><strong>$4<span> / monthly payment</span></strong><p>When a friend pays $20</p></div>
        <div><strong>$30<span> / yearly payment</span></strong><p>When a friend pays $150</p></div>
      </div>
      <div className="referral-share">
        {loading ? <p role="status">Finding your personal link…</p> : link ? <>
          <label htmlFor="referral-link">Your referral link</label>
          <div className="referral-copy-row"><input ref={input} id="referral-link" readOnly value={link} onFocus={event => event.target.select()} /><button onClick={() => void copy()}>{copied ? <Check size={17} /> : <Copy size={17} />}{copied ? 'Copied!' : 'Copy link'}</button></div>
          <p className="referral-hint" role="status">{copied ? 'Ready to paste into a message to your friend.' : 'Opens radiology.monster. Your friend signs up and pays on our site.'}</p>
        </> : <>
          <h3>Get your personal link</h3>
          <p>Open our Whop affiliate portal with the email you used for payment. Copy the “Radiology Monster — study with real scans” external link.</p>
          <a className="referral-primary" href={affiliatePortal} target="_blank" rel="noopener noreferrer">Get my link on Whop <ArrowUpRight size={16} /></a>
          <button className="referral-retry" onClick={() => setRevision(v => v + 1)}>Check my linked account again</button>
        </>}
        {error && <p role="alert" className="referral-error">{error}</p>}
      </div>
      <ol className="referral-steps"><li><strong>Share your link</strong><span>Tell your study group why you use it, and mention that you may earn a commission.</span></li><li><strong>Your friend joins</strong><span>They choose monthly or yearly. Their price stays the same.</span></li><li><strong>Collect your rewards</strong><span>Whop tracks eligible sales and manages your payouts.</span></li></ol>
      <div className="referral-footer"><a href={affiliatePortal} target="_blank" rel="noopener noreferrer">Referral activity <ArrowUpRight size={14} /></a><a href={affiliateBalance} target="_blank" rel="noopener noreferrer">Payouts on Whop <ArrowUpRight size={14} /></a></div>
      <p className="referral-terms">20% of eligible payments, including renewals. Discounts reduce the commission amount. Whop applies a 30-day waiting period and its eligibility and payout rules; refunds, disputes and fraud can reverse earnings. No self-referrals or spam. This is a cash reward, not a subscription discount.</p>
    </dialog>, document.body)}
  </>;
}
