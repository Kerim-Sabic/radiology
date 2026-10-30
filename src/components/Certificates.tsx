import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Award } from 'lucide-react';
import { useApp } from '../app/AppContext';
import { useAccount } from '../auth/AccountGate';
import { CERT_TITLES, levelLabel, myCertificates, type IssuedCertificate } from '../services/certificates';
import type { CertExam } from '../services/exam';
import '../styles/upgrade.css';

/** Progress page: the certificates in one line, and the way to the Certificates page. */
export function CertificatesSummary() {
  const { progress, free } = useApp();
  const account = useAccount();
  const [issued, setIssued] = useState<IssuedCertificate[]>([]);
  const [current, setCurrent] = useState<CertExam | null>(null);
  useEffect(() => {
    if (account && !free) void myCertificates().then(setIssued);
  }, [account, free]);
  useEffect(() => {
    void progress.currentCertExam().then((e) => setCurrent(e && !e.finishedAt ? e : null));
  }, [progress]);
  return (
    <section className="card stack certs-summary" aria-labelledby="certs-h">
      <div className="row">
        <h2 id="certs-h" style={{ margin: 0 }}>
          <Award size={18} style={{ verticalAlign: '-3px' }} /> Certificates
        </h2>
        <span className="spacer" />
        <Link className={`btn sm${current ? ' primary' : ''}`} to="/certificates">
          {current ? 'Continue the exam' : 'Open certificates'}
        </Link>
      </div>
      <p className="muted" style={{ margin: 0 }}>
        {issued.length} issued. Three levels for each body area and for the whole library; each level is a short exam on real patients, with the result at the end.
        {current ? (
          <>
            {' '}
            In progress: <b>{CERT_TITLES[current.area]}</b>, {levelLabel(current.level)} ({current.items.filter((it) => it.submittedAt).length} of {current.items.length}{' '}
            answered).
          </>
        ) : null}
      </p>
    </section>
  );
}
