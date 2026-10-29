import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { ArrowRight, Award, ExternalLink } from 'lucide-react';
import { useApp } from '../app/AppContext';
import { useAccount } from '../auth/AccountGate';
import { areaProgress } from '../services/areas';
import {
  CERT_TITLES,
  LEVELS,
  certificateStatus,
  claimCertificate,
  levelLabel,
  levelRequirement,
  myCertificates,
  type CertArea,
  type CertStatus,
  type IssuedCertificate,
} from '../services/certificates';
import { certKey, nextCertificateTask, parseCertKey, stepUrl } from '../services/certify';
import '../styles/upgrade.css';

const pct = (x: number) => `${Math.round(x * 100)}%`;
const ORDER: CertArea[] = ['chest', 'abdomen', 'head', 'msk', 'breast', 'all'];
const same = (c: IssuedCertificate, s: CertStatus) => c.area === s.area && (c.level ?? 1) === s.level;

/** Every certificate: the levels, how close you are to each, and the ones you have. */
export default function CertificatesPage() {
  const { catalog, attempts, free, openPlans, settings } = useApp();
  const account = useAccount();
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const [issued, setIssued] = useState<IssuedCertificate[]>([]);
  const [claiming, setClaiming] = useState<CertStatus | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const statuses = useMemo(() => (catalog ? certificateStatus(areaProgress(catalog, attempts), attempts) : []), [catalog, attempts]);
  useEffect(() => {
    if (account && !free) void myCertificates().then(setIssued);
  }, [account, free]);
  const signedIn = !!account;
  const groups = ORDER.map((area) => [area, statuses.filter((s) => s.area === area)] as const).filter(([, levels]) => levels.length);
  const mine = [...issued].sort((a, b) => ORDER.indexOf(a.area as CertArea) - ORDER.indexOf(b.area as CertArea) || (b.level ?? 1) - (a.level ?? 1));
  const issuedOn = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });

  const startClaim = (s: CertStatus) => {
    const own = account?.account.user?.name;
    setClaiming(s);
    setName(own && !own.includes('@') ? own : settings.reviewerName === 'me' ? '' : settings.reviewerName);
    setError('');
  };
  // Back from the reading room with a level reached (?claim=chest-2): open its form.
  const claimParam = sp.get('claim');
  useEffect(() => {
    const want = parseCertKey(claimParam);
    const s = want && statuses.find((x) => x.area === want.area && x.level === want.level);
    if (!s) return;
    if (s.eligible && !free && account) startClaim(s);
    setSp({}, { replace: true });
    requestAnimationFrame(() => document.getElementById(`cert-${certKey(want.area, want.level)}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claimParam, statuses.length]);
  /** Start or continue a level: the next patient or task it still needs, in the reading room. */
  const work = (s: CertStatus) => {
    if (!catalog) return;
    const step = nextCertificateTask(catalog, attempts, s.area, s.level);
    if (step) navigate(stepUrl(step, s.area, s.level));
  };
  const claim = async () => {
    if (!claiming) return;
    setBusy(true);
    setError('');
    const r = await claimCertificate(claiming, name.trim());
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setIssued((xs) => [...xs.filter((x) => x.id !== r.certificate.id), r.certificate]);
    setClaiming(null);
    window.open(`/certificate/${r.certificate.id}#add-to-linkedin`, '_blank', 'noopener');
  };

  return (
    <div className="page-inner certs-page">
      <header className="certs-intro">
        <h1>Certificates</h1>
        <p className="muted">
          Earned by reading real patients here. Each body area has three levels, and the whole library three more; every level is its own certificate, with a public
          check link and the steps to add it to LinkedIn under Licenses &amp; certifications.
        </p>
        <ol className="certs-how" aria-label="How to get a certificate">
          <li>
            <b>Start certification</b>
            <span>Pick a level below. The app opens the first patient it needs.</span>
          </li>
          <li>
            <b>Read the patients it gives you</b>
            <span>After each answer, press Next for your certificate. The bar at the top shows what is left.</span>
          </li>
          <li>
            <b>Finish certification</b>
            <span>When the level is reached, type your name. Your certificate is ready to share on LinkedIn.</span>
          </li>
        </ol>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <a className="btn" href="/certificate/example" target="_blank" rel="noopener noreferrer">
            See an example <ExternalLink size={13} />
          </a>
          {free ? (
            <button className="btn primary" onClick={openPlans}>
              See plans
            </button>
          ) : null}
        </div>
        {free ? <p className="notice">Certificates are issued to members. Your answers on the sample patients already count towards them.</p> : null}
        {!signedIn ? <p className="notice">Sign in as a member to claim certificates.</p> : null}
      </header>

      {mine.length ? (
        <section className="card stack" aria-labelledby="certs-mine-h">
          <h2 id="certs-mine-h">Your certificates</h2>
          <ul className="certs-mine">
            {mine.map((c) => (
              <li key={c.id}>
                <span className="certs-mine-ico" aria-hidden="true">
                  <Award size={18} />
                </span>
                <div>
                  <b>{c.title}</b>
                  <span className="faint">
                    {levelLabel(c.level)} · issued {issuedOn(c.issuedAt)}
                  </span>
                </div>
                <a className="btn sm" href={`/certificate/${c.id}`} target="_blank" rel="noopener noreferrer">
                  View and share <ExternalLink size={12} />
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="card stack" aria-labelledby="certs-levels-h">
        <h2 id="certs-levels-h">The levels</h2>
        <div className="certs-levels-wrap">
          <table className="certs-levels">
            <thead>
              <tr>
                <th scope="col">Level</th>
                <th scope="col">Each body area</th>
                <th scope="col">General radiology (the whole library)</th>
              </tr>
            </thead>
            <tbody>
              {LEVELS.area.map((rule, i) => (
                <tr key={rule.level}>
                  <th scope="row">{levelLabel(rule.level)}</th>
                  <td data-label="Each body area">{levelRequirement('chest', rule)}</td>
                  <td data-label="General radiology">{levelRequirement('all', LEVELS.all[i])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <small className="faint">
          Patients read means you submitted an answer on at least one of their tasks. Partly right counts half. Without hints means no hint opened and nothing revealed,
          as in Assess mode. Where an area has fewer patients than a level asks for, that level asks for every patient there. Retry your mistakes to raise your share
          right.
        </small>
      </section>

      <div className="certs-areas">
        {groups.map(([area, levels]) => (
          <section key={area} className="card certs-area" aria-labelledby={`certs-${area}`}>
            <div className="certs-area-head">
              <h2 id={`certs-${area}`}>{CERT_TITLES[area]}</h2>
              <span className="faint">
                {levels[0].read} of {levels[0].patients} patients read
              </span>
            </div>
            <ol className="certs-ladder">
              {levels.map((s) => {
                const have = issued.find((c) => same(c, s));
                return (
                  <li key={s.level} id={`cert-${certKey(s.area, s.level)}`} className={s.eligible ? 'ok' : ''}>
                    <div className="certs-step-head">
                      <span className="certs-badge" aria-hidden="true">
                        {s.level}
                      </span>
                      <b>
                        Level {s.level} · {s.levelName}
                      </b>
                      {have ? <span className="chip ok">Issued</span> : s.eligible ? <span className="chip accent">Ready</span> : null}
                    </div>
                    <span className="faint certs-numbers">
                      {s.read}/{s.needPatients} patients · {s.judged}/{s.needJudged} graded{s.independent ? ' without hints' : ''} ·{' '}
                      {s.accuracy === null ? 'no graded answers yet' : `${pct(s.accuracy)} right`} (needs {pct(s.minAccuracy)})
                    </span>
                    <div
                      className="cert-bar"
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(s.progress * 100)}
                      aria-label={`${s.title}, ${levelLabel(s.level)}: progress to the certificate`}
                    >
                      <span style={{ width: `${Math.round(s.progress * 100)}%` }} />
                    </div>
                    <div className="cert-row">
                      <small className="faint">{s.todo ?? (have ? `Issued ${issuedOn(have.issuedAt)}` : 'Ready to claim.')}</small>
                      <span className="row" style={{ gap: 6 }}>
                        {have ? (
                          <a className="btn sm" href={`/certificate/${have.id}`} target="_blank" rel="noopener noreferrer">
                            View and share <ExternalLink size={12} />
                          </a>
                        ) : null}
                        {free ? (
                          <button className="btn sm primary" onClick={openPlans}>
                            See plans
                          </button>
                        ) : s.eligible ? (
                          signedIn ? (
                            <button className="btn sm primary" onClick={() => startClaim(s)}>
                              {have ? 'Renew' : 'Finish certification'}
                            </button>
                          ) : null
                        ) : have ? null : (
                          <button className="btn sm primary" onClick={() => work(s)}>
                            {s.read || s.judged ? 'Continue certification' : 'Start certification'} <ArrowRight size={13} />
                          </button>
                        )}
                      </span>
                    </div>
                    {claiming && same({ area: claiming.area, level: claiming.level } as IssuedCertificate, s) ? (
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
            </ol>
          </section>
        ))}
      </div>
    </div>
  );
}
