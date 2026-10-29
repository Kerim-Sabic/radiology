import { useEffect, useMemo, useState } from 'react';
import { Award, ExternalLink, Lock } from 'lucide-react';
import { useApp } from '../app/AppContext';
import { useAccount } from '../auth/AccountGate';
import { areaProgress } from '../services/areas';
import { certificateStatus, claimCertificate, myCertificates, type CertStatus, type IssuedCertificate } from '../services/certificates';
import '../styles/upgrade.css';

/** Progress page: how close you are to each certificate, and the ones you have. */
export function CertificatesCard() {
  const { catalog, attempts, free, openPlans, settings } = useApp();
  const account = useAccount();
  const [issued, setIssued] = useState<IssuedCertificate[]>([]);
  const [claiming, setClaiming] = useState<CertStatus | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const statuses = useMemo(() => (catalog ? certificateStatus(areaProgress(catalog, attempts), attempts) : []), [catalog, attempts]);
  useEffect(() => {
    if (account && !free) void myCertificates().then(setIssued);
  }, [account, free]);
  if (!statuses.length) return null;
  const signedIn = !!account;

  const claim = async () => {
    if (!claiming) return;
    setBusy(true);
    setError('');
    const r = await claimCertificate(claiming, name.trim());
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setIssued((xs) => [...xs.filter((x) => x.area !== r.certificate.area), r.certificate]);
    setClaiming(null);
    window.open(`/certificate/${r.certificate.id}`, '_blank', 'noopener');
  };

  return (
    <section className="card stack certs" aria-labelledby="certs-h">
      <div className="row">
        <h2 id="certs-h" style={{ margin: 0 }}>
          <Award size={18} style={{ verticalAlign: '-3px' }} /> Certificates
        </h2>
        <span className="spacer" />
        {free ? (
          <button className="btn sm primary" onClick={openPlans}>
            <Lock size={12} /> Members
          </button>
        ) : null}
      </div>
      <p className="muted" style={{ margin: 0 }}>
        One for each body area when you have read 10 of its patients with 70% of graded answers right, and <i>Radiology foundations</i> across the areas. Each has a public page you can share or add to LinkedIn.
      </p>
      <ul className="cert-list">
        {statuses.map((s) => {
          const mine = issued.find((c) => c.area === s.area);
          return (
            <li key={s.area} className={s.eligible ? 'ok' : ''}>
              <div className="cert-row">
                <b>{s.title}</b>
                <span className="faint">
                  {s.read}/{s.needPatients} patients · {s.accuracy === null ? 'no graded answers yet' : `${Math.round(s.accuracy * 100)}% right`}
                </span>
              </div>
              <div className="cert-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(s.progress * 100)} aria-label={`${s.title}: progress to the certificate`}>
                <span style={{ width: `${Math.round(s.progress * 100)}%` }} />
              </div>
              <div className="cert-row">
                <small className="faint">{s.todo ?? (mine ? `Issued ${new Date(mine.issuedAt).toLocaleDateString()}` : 'Ready to claim.')}</small>
                {mine ? (
                  <a className="btn sm" href={`/certificate/${mine.id}`} target="_blank" rel="noopener noreferrer">
                    View and share <ExternalLink size={12} />
                  </a>
                ) : null}
                {s.eligible && !free && signedIn ? (
                  <button
                    className="btn sm primary"
                    onClick={() => {
                      setClaiming(s);
                      setName(account?.account.user?.name && !account.account.user.name.includes('@') ? account.account.user.name : settings.reviewerName === 'me' ? '' : settings.reviewerName);
                      setError('');
                    }}
                  >
                    {mine ? 'Renew' : 'Claim'}
                  </button>
                ) : null}
              </div>
              {claiming?.area === s.area ? (
                <div className="cert-claim">
                  <label>
                    Name on the certificate
                    <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Your full name" autoFocus />
                  </label>
                  <div className="row" style={{ gap: 6 }}>
                    <button className="btn primary" disabled={busy || name.trim().length < 2} onClick={() => void claim()}>
                      {busy ? 'Issuing…' : 'Issue certificate'}
                    </button>
                    <button className="btn ghost" onClick={() => setClaiming(null)}>
                      Cancel
                    </button>
                  </div>
                  {error ? <div className="notice bad">{error}</div> : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {!signedIn ? <small className="faint">Certificates are issued to signed-in members.</small> : null}
    </section>
  );
}
