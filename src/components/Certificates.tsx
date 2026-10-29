import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Award } from 'lucide-react';
import { useApp } from '../app/AppContext';
import { useAccount } from '../auth/AccountGate';
import { areaProgress } from '../services/areas';
import { certificateStatus, levelLabel, myCertificates, type IssuedCertificate } from '../services/certificates';
import { nextCertificateTask, stepUrl } from '../services/certify';
import '../styles/upgrade.css';

/** Progress page: the certificates in one line, and the way to the Certificates page. */
export function CertificatesSummary() {
  const { catalog, attempts, free } = useApp();
  const account = useAccount();
  const navigate = useNavigate();
  const [issued, setIssued] = useState<IssuedCertificate[]>([]);
  const statuses = useMemo(() => (catalog ? certificateStatus(areaProgress(catalog, attempts), attempts) : []), [catalog, attempts]);
  useEffect(() => {
    if (account && !free) void myCertificates().then(setIssued);
  }, [account, free]);
  if (!statuses.length) return null;
  const has = (area: string, level: number) => issued.some((c) => c.area === area && (c.level ?? 1) === level);
  const ready = statuses.filter((s) => s.eligible && !has(s.area, s.level)).length;
  const next = statuses.filter((s) => !s.eligible).sort((a, b) => b.progress - a.progress)[0];
  const step = next && catalog && !free ? nextCertificateTask(catalog, attempts, next.area, next.level) : null;
  return (
    <section className="card stack certs-summary" aria-labelledby="certs-h">
      <div className="row">
        <h2 id="certs-h" style={{ margin: 0 }}>
          <Award size={18} style={{ verticalAlign: '-3px' }} /> Certificates
        </h2>
        <span className="spacer" />
        {step && next ? (
          <button className="btn sm primary" onClick={() => navigate(stepUrl(step, next.area, next.level))}>
            Continue certification
          </button>
        ) : null}
        <Link className="btn sm" to="/certificates">
          Open certificates
        </Link>
      </div>
      <p className="muted" style={{ margin: 0 }}>
        {issued.length} issued{ready ? `, ${ready} ready to claim` : ''}. Three levels for each body area and for the whole library.
        {next ? (
          <>
            {' '}
            Closest next: <b>{next.title}</b>, {levelLabel(next.level)}. {next.todo}
          </>
        ) : null}
      </p>
    </section>
  );
}
