import { useEffect, useState } from 'react';
import { ArrowRight, Check, Copy, Download, ImageDown, Printer, Send } from 'lucide-react';
import { linkedInUrl, type IssuedCertificate } from '../services/certificates';
import '../styles/certificate.css';

/** LinkedIn's "in" mark for its share button (the icon set has no brand marks). */
function Linkedin({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.34V9h3.42v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0z" />
    </svg>
  );
}

/** The text a learner can paste into a post (they edit it there). */
export function suggestedPost(c: IssuedCertificate, url: string): string {
  return [
    `I just completed ${c.title} on radiology.monster: ${c.patients} real patients read, ${Math.round(c.accuracy * 100)}% of ${c.judged} graded answers right, each finding marked on the image and checked against the expert outline.`,
    '',
    `Certificate: ${url}`,
    '',
    '#radiology #medicalstudent #medicaleducation #imaging',
  ].join('\n');
}

/** Public page of one certificate (no sign-in): the certificate, ways to share it, and an invitation to start. */
export default function CertificatePage() {
  const id = decodeURIComponent(location.pathname.split('/')[2] ?? '');
  const [cert, setCert] = useState<IssuedCertificate | null | undefined>(undefined);
  const [copied, setCopied] = useState<'link' | 'post' | null>(null);
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
  const issued = new Date(cert.issuedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
  const url = `${location.origin}/certificate/${cert.id}`;
  const copy = (what: 'link' | 'post', value: string) =>
    void navigator.clipboard?.writeText(value).then(() => {
      setCopied(what);
      setTimeout(() => setCopied(null), 2500);
    });
  const image = (square: boolean) => `/api/og/certificate?id=${encodeURIComponent(cert.id)}${square ? '&format=square' : ''}`;
  const file = `radiology-monster-${cert.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return (
    <main className="cert-page">
      <header className="cert-top">
        <a className="cert-brand" href="/">
          <img src="/logo-mark.svg" alt="" width={24} height={25} />
          <span className="cert-word">
            radiology<em>.monster</em>
          </span>
        </a>
        <span className="cert-verified">
          <Check size={14} /> Verified certificate
        </span>
      </header>

      <article className="cert" aria-label="Certificate">
        <div className="cert-head">
          <span className="cert-brand">
            <span className="cert-mark" aria-hidden="true" />
            <span className="cert-word">
              radiology<em>.monster</em>
            </span>
          </span>
          <span className="cert-pill">
            <i aria-hidden="true" /> Verified certificate
          </span>
        </div>
        <div className="cert-main">
          <div className="cert-words">
            <p className="cert-kicker">Certificate of completion</p>
            <h1 className="cert-name">{cert.name}</h1>
            <p className="cert-line">has completed</p>
            <h2 className="cert-title">{cert.title}</h2>
            <p className="cert-detail">Real patients, each read in a full workstation, marked on the image and graded against the expert outline.</p>
          </div>
          <div className="cert-seal" aria-hidden="true">
            <svg viewBox="0 0 200 200" width="170" height="170">
              <defs>
                <linearGradient id="cert-ring" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stopColor="#2563eb" />
                  <stop offset="1" stopColor="#7c3aed" />
                </linearGradient>
              </defs>
              <circle cx="100" cy="100" r="92" fill="none" stroke="url(#cert-ring)" strokeWidth="10" />
              <circle cx="100" cy="100" r="74" fill="#eef2ff" stroke="#c7d2fe" strokeWidth="2" strokeDasharray="4 6" />
              <path d="M68 102 L91 125 L134 80" fill="none" stroke="#4f46e5" strokeWidth="14" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>Verified</span>
          </div>
        </div>
        <div className="cert-stats">
          <div>
            <b>{cert.patients}</b>
            <span>Real patients</span>
          </div>
          <div>
            <b>{Math.round(cert.accuracy * 100)}%</b>
            <span>Graded answers right</span>
          </div>
          <div>
            <b>{cert.judged}</b>
            <span>Graded answers</span>
          </div>
          <div>
            <b>{issued}</b>
            <span>Issued</span>
          </div>
        </div>
        <p className="cert-check">
          Certificate ID <span className="mono">{cert.id}</span> · check it at {url.replace(/^https?:\/\/(www\.)?/, '')}
        </p>
      </article>

      <section className="cert-share" aria-label="Share this certificate">
        <h2>Share it</h2>
        <div className="cert-share-row">
          <a className="cert-btn linkedin" href={linkedInUrl(cert)} target="_blank" rel="noopener noreferrer">
            <Linkedin size={17} /> Add to LinkedIn profile
          </a>
          <a className="cert-btn" href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`} target="_blank" rel="noopener noreferrer">
            <Send size={16} /> Post on LinkedIn
          </a>
          <button className="cert-btn" onClick={() => copy('link', url)}>
            {copied === 'link' ? <Check size={16} /> : <Copy size={16} />} {copied === 'link' ? 'Link copied' : 'Copy link'}
          </button>
        </div>
        <div className="cert-share-row">
          <a className="cert-btn" href={image(false)} download={`${file}.png`}>
            <ImageDown size={16} /> Image for a post
          </a>
          <a className="cert-btn" href={image(true)} download={`${file}-square.png`}>
            <Download size={16} /> Square image (Instagram)
          </a>
          <button className="cert-btn" onClick={() => window.print()}>
            <Printer size={16} /> Print or save as PDF
          </button>
        </div>
        <div className="cert-post">
          <div className="cert-post-head">
            <b>A post you can start from</b>
            <button className="cert-btn small" onClick={() => copy('post', suggestedPost(cert, url))}>
              {copied === 'post' ? <Check size={14} /> : <Copy size={14} />} {copied === 'post' ? 'Copied' : 'Copy text'}
            </button>
          </div>
          <pre>{suggestedPost(cert, url)}</pre>
        </div>
      </section>

      <section className="cert-cta">
        <div>
          <h2>Learn to read scans the way {cert.name.split(/\s+/)[0]} did.</h2>
          <p>Real CT, MRI, X-ray, mammography and ultrasound. Mark what you see and get graded on the exact slice.</p>
        </div>
        <a className="cert-btn primary" href="/">
          Start free <ArrowRight size={16} />
        </a>
      </section>
      <p className="cert-fine">An educational record of practice on radiology.monster, as reported by the learner’s app. Not a medical qualification or CME credit.</p>
    </main>
  );
}
