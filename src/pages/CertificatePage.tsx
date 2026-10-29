import { useEffect, useState } from 'react';
import { Award, Copy, Printer, Share2 } from 'lucide-react';
import { linkedInUrl, type IssuedCertificate } from '../services/certificates';
import '../styles/certificate.css';

/** Public page of one certificate (no sign-in): the certificate itself, printable, with its check link. */
export default function CertificatePage() {
  const id = decodeURIComponent(location.pathname.split('/')[2] ?? '');
  const [cert, setCert] = useState<IssuedCertificate | null | undefined>(undefined);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    fetch(`/api/certificate?id=${encodeURIComponent(id)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setCert(j?.certificate ?? null))
      .catch(() => setCert(null));
  }, [id]);
  useEffect(() => {
    if (cert) document.title = `${cert.name} · ${cert.title} · radiology.monster`;
  }, [cert]);

  if (cert === undefined) return <main className="cert-page"><p className="cert-status">Checking the certificate…</p></main>;
  if (!cert)
    return (
      <main className="cert-page">
        <div className="cert-missing">
          <h1>No certificate with this link</h1>
          <p>Check that the link is complete. Certificates are issued by radiology.monster and each has its own address.</p>
          <a href="/">radiology.monster</a>
        </div>
      </main>
    );
  const issued = new Date(cert.issuedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  const url = `${location.origin}/certificate/${cert.id}`;
  return (
    <main className="cert-page">
      <div className="cert-actions">
        <button onClick={() => window.print()}>
          <Printer size={15} /> Print or save as PDF
        </button>
        <a href={linkedInUrl(cert)} target="_blank" rel="noopener noreferrer">
          <Share2 size={15} /> Add to LinkedIn
        </a>
        <button
          onClick={() => {
            void navigator.clipboard?.writeText(url).then(() => setCopied(true));
          }}
        >
          <Copy size={15} /> {copied ? 'Link copied' : 'Copy link'}
        </button>
      </div>
      <article className="cert" aria-label="Certificate">
        <div className="cert-top">
          <span className="cert-brand">
            <img src="/logo-mark.svg" alt="" width={26} height={27} /> radiology<span>.monster</span>
          </span>
          <Award className="cert-seal" size={40} aria-hidden="true" />
        </div>
        <p className="cert-kicker">Certificate of completion</p>
        <h1 className="cert-name">{cert.name}</h1>
        <p className="cert-line">has completed</p>
        <h2 className="cert-title">{cert.title}</h2>
        <p className="cert-detail">
          reading {cert.patients} real patients on radiology.monster, with {Math.round(cert.accuracy * 100)}% of {cert.judged} graded answers right, marked on the image and checked
          against the expert outline.
        </p>
        <div className="cert-foot">
          <div>
            <b>{issued}</b>
            <span>Issued</span>
          </div>
          <div>
            <b className="mono">{cert.id}</b>
            <span>Certificate ID</span>
          </div>
          <div>
            <b>{url.replace(/^https?:\/\//, '')}</b>
            <span>Check this certificate</span>
          </div>
        </div>
        <p className="cert-fine">Records practice on radiology.monster as reported by the learner’s app. It is an educational record, not a medical qualification or CME credit.</p>
      </article>
    </main>
  );
}
