import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, Copy, Download, FileText, ImageDown, Info, Printer, Send, ShieldCheck, Smartphone } from 'lucide-react';
import { EXAMPLE_CERTIFICATE, certificateOwner, levelLabel, linkedInFields, linkedInUrl, startLinkedInPost, type IssuedCertificate } from '../services/certificates';
import { LEVEL_STYLE, credentialName, levelName, levelRequirement, levelRule, starPoints, type CertArea, type CertLevel } from '../../shared/certificateLevels';
import { CertSeal } from '../components/CertSeal';
import '../styles/certificate.css';
import { verificationUrl } from '../../shared/credential';

/** LinkedIn's "in" mark for its share button (the icon set has no brand marks). */
function Linkedin({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.34V9h3.42v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0z" />
    </svg>
  );
}

const AREA_TAG: Record<string, string> = {
  chest: '#chestradiology',
  abdomen: '#abdominalimaging',
  head: '#neuroradiology',
  msk: '#mskradiology',
  breast: '#breastimaging',
  all: '#medicalimaging',
};

export type PostStyle = 'proud' | 'short' | 'detailed';
export const POST_STYLES: Array<[PostStyle, string]> = [
  ['proud', 'Proud'],
  ['short', 'Short'],
  ['detailed', 'What it took'],
];

/** Posts a learner can start from (they edit them there): a proud one, a short one, and one that lists what it took. */
export function suggestedPost(c: IssuedCertificate, url: string, style: PostStyle = 'proud'): string {
  const level = (c.level ?? 1) as CertLevel;
  const credential = credentialName(c.title, level);
  const pct = `${Math.round(c.accuracy * 100)}%`;
  const unaided = levelRule((c.area as CertArea) ?? 'chest', level)?.independent ?? false;
  const tags = `#radiology #medicalstudent #medicaleducation #meded ${AREA_TAG[c.area] ?? '#imaging'}`;
  if (style === 'short')
    return [
      `Earned the ${credential} on radiology.monster: ${c.patients} real patients read, ${pct} right${unaided ? ' without hints' : ''}.`,
      '',
      `Verify it: ${url}`,
      '',
      tags,
    ].join('\n');
  if (style === 'detailed')
    return [
      `New certificate: ${credential}, issued by radiology.monster.`,
      '',
      'What it took:',
      `• ${c.patients} real patients read in a full radiology workstation`,
      `• ${c.judged} graded answers${unaided ? ' without hints' : ''}, ${pct} right`,
      '• Every finding marked on the image and checked against the expert outline',
      '',
      `Verify it: ${url}`,
      '',
      tags,
    ].join('\n');
  return [
    `Proud to share that I have earned the ${credential} from radiology.monster.`,
    '',
    `I read ${c.patients} real patient scans in a full radiology workstation: scrolling the whole study, marking each finding on the image and getting graded against the expert outline. ${pct} of my ${c.judged} graded answers were right${unaided ? ', all without hints' : ''}.`,
    '',
    level < 3 ? `Next goal: Level ${level + 1} (${levelName((level + 1) as CertLevel)}).` : 'Level 3 is the top level, and I am proud to have reached it.',
    '',
    `Verify it here: ${url}`,
    '',
    tags,
  ].join('\n');
}

/** What LinkedIn said after "Post it for me", read once from the address it returns to. */
function linkedInResult(): {
  result: 'posted' | 'cancelled' | 'failed';
  post: string;
} | null {
  const q = new URLSearchParams(location.search);
  const result = q.get('linkedin');
  const post = q.get('post') ?? '';
  return result === 'posted' || result === 'cancelled' || result === 'failed' ? { result, post: /^urn:li:(share|ugcPost):\d+$/.test(post) ? post : '' } : null;
}

/** The seal and its level. */
function Seal({ level, label }: { level: CertLevel; label: string }) {
  return (
    <div className="cert-seal" aria-hidden="true">
      <CertSeal level={level} />
      <span style={{ color: LEVEL_STYLE[level].accent }}>{label}</span>
    </div>
  );
}

/** Public page of one certificate (no sign-in): the certificate, its verification, ways to share it, and an invitation to start. */
export default function CertificatePage() {
  const id = decodeURIComponent(location.pathname.split('/')[2] ?? '');
  // /certificate/example shows what a certificate looks like; it is never stored or checkable.
  const example = id === 'example';
  const [cert, setCert] = useState<IssuedCertificate | null | undefined>(undefined);
  const [loadError, setLoadError] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [style, setStyle] = useState<PostStyle>('proud');
  // Opened straight away when the learner arrives from claiming it.
  const [toLinkedIn, setToLinkedIn] = useState(() => location.hash === '#add-to-linkedin');
  // The post as the learner edited it (null: the suggested one in the chosen style).
  const [draft, setDraft] = useState<string | null>(null);
  // The holder, signed in, can have it posted to LinkedIn for them when the server is set up for it.
  const [owner, setOwner] = useState({ mine: false, linkedin: false });
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [posted] = useState(linkedInResult);
  const notice = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (example) return setCert(EXAMPLE_CERTIFICATE);
    fetch(`/api/certificate?id=${encodeURIComponent(id)}`, {
      cache: 'no-store',
    })
      .then((r) => {
        if (!r.ok && r.status !== 404) throw new Error('Unavailable');
        return r.ok ? r.json() : null;
      })
      .then((j) => setCert(j?.certificate ?? null))
      .catch(() => {
        setLoadError(true);
        setCert(null);
      });
  }, [id, example]);
  useEffect(() => {
    if (example) return;
    void certificateOwner(id).then(setOwner);
    // Keep the result off the address, so a reload or a shared link does not show it again.
    if (posted) history.replaceState(null, '', location.pathname + location.hash);
  }, [id, example, posted]);
  useEffect(() => {
    if (cert && posted) notice.current?.scrollIntoView({ block: 'center' });
  }, [cert, posted]);
  useEffect(() => {
    if (cert) document.title = example ? 'Example certificate · radiology.monster' : `${cert.name} · ${credentialName(cert.title, cert.level)} · radiology.monster`;
  }, [cert, example]);

  if (cert === undefined)
    return (
      <main className="cert-page">
        <p className="cert-status">Checking the certificate…</p>
      </main>
    );
  if (!cert)
    return (
      <main className="cert-page">
        <div className="cert-missing">
          <h1>{loadError ? 'Verification is temporarily unavailable' : 'No certificate with this link'}</h1>
          <p>
            {loadError
              ? 'Please reload to check the current record. This does not mean the certificate is invalid.'
              : 'Check that the link is complete. Certificates are issued by radiology.monster and each has its own address.'}
          </p>
          <a href="/">radiology.monster</a>
        </div>
      </main>
    );
  const level = (cert.level ?? 1) as CertLevel;
  const st = LEVEL_STYLE[level];
  const area = ((cert.area as CertArea) ?? 'chest') as CertArea;
  const rule = levelRule(area, level);
  const credential = credentialName(cert.title, level);
  const issued = new Date(cert.issuedAt).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
  const url = verificationUrl(cert.id, location.origin);
  const revoked = cert.status === 'revoked';
  const legacy = cert.verification !== 'server-graded';
  const copy = (what: string, value: string) =>
    void navigator.clipboard?.writeText(value).then(() => {
      setCopied(what);
      setTimeout(() => setCopied(null), 2500);
    });
  const image = (format: 'wide' | 'square' | 'story') => `/api/og/certificate?id=${encodeURIComponent(cert.id)}${format === 'wide' ? '' : `&format=${format}`}`;
  const file = `radiology-monster-${cert.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-level-${level}`;
  const li = linkedInFields(cert);
  const unaided = rule?.independent ?? false;
  const pct = `${Math.round(cert.accuracy * 100)}%`;
  const cvLine = `${credential}, radiology.monster (${li.issued}). Credential ID ${cert.id}. ${url}`;
  // LinkedIn's form, in its order. The issue date is two lists there, so it is shown, not copied.
  const fields: Array<{
    key: string;
    label: string;
    value: string;
    hint?: string;
    copy?: boolean;
  }> = [
    { key: 'name', label: 'Name', value: li.name, copy: true },
    {
      key: 'org',
      label: 'Issuing organization',
      value: li.organization,
      hint: 'If LinkedIn suggests the radiology.monster page, pick it so its logo shows.',
      copy: true,
    },
    {
      key: 'issued',
      label: 'Issue date',
      value: li.issued,
      hint: 'Pick the month and year. Leave the expiration date empty: it does not expire.',
    },
    { key: 'id', label: 'Credential ID', value: li.credentialId, copy: true },
    {
      key: 'url',
      label: 'Credential URL',
      value: li.credentialUrl,
      copy: true,
    },
  ];
  const text = draft ?? suggestedPost(cert, url, style);
  const autoPost = owner.mine && owner.linkedin;
  const postForMe = async () => {
    setPosting(true);
    setPostError(null);
    const r = await startLinkedInPost(cert.id, text);
    if (r.ok) return location.assign(r.url);
    setPosting(false);
    setPostError(r.error);
  };
  const CopyButton = ({ what, value, label = 'Copy' }: { what: string; value: string; label?: string }) => (
    <button className="cert-btn small" aria-label={`${label} ${what}`} onClick={() => copy(what, value)}>
      {copied === what ? <Check size={14} /> : <Copy size={14} />} {copied === what ? 'Copied' : label}
    </button>
  );
  return (
    <main className="cert-page">
      <header className="cert-top">
        <a className="cert-brand" href="/">
          <img src="/logo-mark.svg" alt="" width={24} height={25} />
          <span className="cert-word">
            radiology<em>.monster</em>
          </span>
        </a>
        {example ? null : (
          <span className="cert-verified">
            <Check size={14} /> {revoked ? 'Revoked certificate' : 'Certificate record found'}
          </span>
        )}
      </header>
      {example ? (
        <p className="cert-example" role="note">
          This is an example. A real certificate carries the learner’s name, their own numbers and a check link of its own.
        </p>
      ) : null}

      {revoked ? (
        <p className="cert-example" role="alert">
          <strong>REVOKED — this certificate is no longer valid.</strong> Revoked on{' '}
          {new Date(cert.revokedAt!).toLocaleDateString('en-US', {
            timeZone: 'UTC',
          })}
          . The original record is retained below.
        </p>
      ) : null}
      <article className="cert" aria-label="Certificate" style={{ ['--cert-accent' as string]: revoked ? '#b91c1c' : st.accent }}>
        <div className="cert-frame">
          <div className="cert-inner">
            <span className="cert-brand">
              <img className="cert-logo" src="/favicon.svg" alt="" width={44} height={44} />
              <span className="cert-word">
                radiology<em>.monster</em>
              </span>
            </span>
            <p className="cert-kicker">{revoked ? 'REVOKED CERTIFICATE' : 'Certificate of completion'}</p>
            <p className="cert-intro">This certifies that</p>
            <h1 className="cert-name">{cert.name}</h1>
            <span className="cert-rule" aria-hidden="true" />
            <p className="cert-line">has successfully completed</p>
            <h2 className="cert-title">{cert.title}</h2>
            <p className="cert-level">
              <svg viewBox="0 0 66 20" aria-hidden="true">
                {[10, 33, 56].map((x, i) => (
                  <polygon key={x} points={starPoints(x, 10, 9)} fill={i < level ? st.accent : 'none'} stroke={st.accent} strokeWidth="1.6" />
                ))}
              </svg>
              {levelLabel(level)}
            </p>
            <div className="cert-stats">
              <div>
                <b>{cert.patients}</b>
                <span>Real patients</span>
              </div>
              <div>
                <b>{pct}</b>
                <span>{unaided ? 'Right without hints' : 'Graded answers right'}</span>
              </div>
              <div>
                <b>{cert.judged}</b>
                <span>{unaided ? 'Answers without hints' : 'Graded answers'}</span>
              </div>
            </div>
            <div className="cert-foot">
              <div className="cert-sign">
                <b>{issued}</b>
                <i aria-hidden="true" />
                <span>Date of issue</span>
              </div>
              <Seal level={level} label={revoked ? 'Revoked' : legacy ? 'Recorded' : 'Verified'} />
              <div className="cert-sign">
                <b>radiology.monster</b>
                <i aria-hidden="true" />
                <span>Issuer</span>
              </div>
            </div>
            {example ? null : (
              <p className="cert-check">
                {revoked ? 'Revoked' : 'Completion record'} · ID <span className="mono">{cert.id}</span> · {url.replace(/^https?:\/\/(www\.)?/, '')}
              </p>
            )}
          </div>
        </div>
      </article>

      <section className="cert-verify" aria-labelledby="cert-verify-h">
        <div className="cert-verify-head">
          <span className="cert-verify-ok" aria-hidden="true">
            <ShieldCheck size={20} />
          </span>
          <div>
            <h2 id="cert-verify-h">{example ? 'Example verification' : revoked ? 'Revoked — no longer valid' : 'Valid completion certificate'}</h2>
            <p>{example ? 'A real certificate shows its record here.' : 'This page is loaded from radiology.monster’s records, so the holder cannot change what it says.'}</p>
          </div>
        </div>
        <dl className="cert-verify-list">
          <div>
            <dt>Verification method</dt>
            <dd>
              {legacy ? 'Legacy record: completion totals were reported by the learner’s app.' : 'Course requirements checked against answers graded by our server.'} Learning is
              unproctored; the learner supplies their display name.
            </dd>
          </div>
          <div>
            <dt>Issued to</dt>
            <dd>{cert.name}</dd>
          </div>
          <div>
            <dt>Credential</dt>
            <dd>{credential}</dd>
          </div>
          <div>
            <dt>Issued by</dt>
            <dd>radiology.monster</dd>
          </div>
          <div>
            <dt>Issued on</dt>
            <dd>{issued}</dd>
          </div>
          {rule ? (
            <div>
              <dt>What the level asks</dt>
              <dd>
                {cert.requirements ?? levelRequirement(area, rule)}
                {!cert.requirements && area !== 'all' ? ' (every patient of the area where it has fewer)' : ''}
              </dd>
            </div>
          ) : null}
          <div>
            <dt>Result</dt>
            <dd>
              {cert.patients} patients read · {cert.judged} graded answers
              {unaided ? ' without hints' : ''} · {pct} right
            </dd>
          </div>
          <div>
            <dt>Skills</dt>
            <dd>{li.skills.join(', ')}</dd>
          </div>
          <div>
            <dt>Credential ID</dt>
            <dd className="mono">{cert.id}</dd>
          </div>
        </dl>
      </section>

      {example || revoked ? null : (
        <section className="cert-share" aria-label="Share this certificate">
          <h2>Share it</h2>
          {posted ? (
            <div ref={notice} className={`cert-li-result ${posted.result}`} role="status">
              {posted.result === 'posted' ? (
                <>
                  <b>
                    <Check size={16} /> Posted on your LinkedIn.
                  </b>
                  {posted.post ? (
                    <a href={`https://www.linkedin.com/feed/update/${posted.post}/`} target="_blank" rel="noopener noreferrer">
                      See your post
                    </a>
                  ) : null}
                  <span>One more step: only you can add it to your profile. Follow the steps below to put it under Licenses &amp; certifications.</span>
                </>
              ) : (
                <span>
                  <Info size={16} />{' '}
                  {posted.result === 'cancelled'
                    ? 'Nothing was posted: LinkedIn was not given permission.'
                    : 'LinkedIn did not take the post. Try again, or copy the text and use Post on LinkedIn.'}
                </span>
              )}
            </div>
          ) : null}
          <div className="cert-share-row">
            <button className="cert-btn linkedin" aria-expanded={toLinkedIn} aria-controls="add-to-linkedin" onClick={() => setToLinkedIn((v) => !v)}>
              <Linkedin size={17} /> Add to LinkedIn profile
            </button>
            {autoPost ? (
              <button className="cert-btn" onClick={() => document.getElementById('cert-post')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>
                <Send size={16} /> Post on LinkedIn
              </button>
            ) : (
              <a className="cert-btn" href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`} target="_blank" rel="noopener noreferrer">
                <Send size={16} /> Post on LinkedIn
              </a>
            )}
            <button className="cert-btn" onClick={() => copy('link', url)}>
              {copied === 'link' ? <Check size={16} /> : <Copy size={16} />} {copied === 'link' ? 'Link copied' : 'Copy link'}
            </button>
          </div>
          {toLinkedIn ? (
            <div className="cert-li" id="add-to-linkedin">
              <p className="cert-li-lead">
                It goes under <b>Licenses &amp; certifications</b> on your profile, with a <b>Show credential</b> button that opens this page, and it counts towards each skill you
                add. We pass the details to LinkedIn, but pre-filling is best-effort. Check each field and copy any missing details below before saving.
              </p>
              <ol className="cert-li-steps">
                <li>
                  <span className="cert-li-n">1</span>
                  <div>
                    <a className="cert-btn linkedin" href={linkedInUrl(cert)} target="_blank" rel="noopener noreferrer">
                      <Linkedin size={16} /> Open LinkedIn’s certification form
                    </a>
                    <small>Or on your profile: Add profile section → Recommended → Add licenses &amp; certifications.</small>
                  </div>
                </li>
                <li>
                  <span className="cert-li-n">2</span>
                  <div>
                    <b>Fill in each field</b>
                    <dl className="cert-li-fields">
                      {fields.map((f) => (
                        <div key={f.key}>
                          <dt>{f.label}</dt>
                          <dd>
                            <span>{f.value}</span>
                            {f.hint ? <small>{f.hint}</small> : null}
                          </dd>
                          {f.copy ? <CopyButton what={f.label} value={f.value} /> : null}
                        </div>
                      ))}
                    </dl>
                  </div>
                </li>
                <li>
                  <span className="cert-li-n">3</span>
                  <div>
                    <b>Add the skills</b>
                    <small>Type each one and pick it from LinkedIn’s list. The certificate then shows under these skills on your profile.</small>
                    <div className="cert-skills">
                      {li.skills.map((s) => (
                        <button key={s} className="cert-btn small" onClick={() => copy(`skill:${s}`, s)}>
                          {copied === `skill:${s}` ? <Check size={13} /> : <Copy size={13} />} {s}
                        </button>
                      ))}
                    </div>
                  </div>
                </li>
                <li>
                  <span className="cert-li-n">4</span>
                  <div>
                    <b>Add the picture under Media</b>
                    <a className="cert-btn small" href={image('wide')} download={`${file}.png`}>
                      <ImageDown size={14} /> Download the certificate image
                    </a>
                  </div>
                </li>
                <li>
                  <span className="cert-li-n">5</span>
                  <div>
                    <b>Save.</b>
                    <small>Want your network to see it too? Use Post on LinkedIn above, with the post below.</small>
                  </div>
                </li>
              </ol>
            </div>
          ) : null}
          <div className="cert-share-row">
            <a className="cert-btn" href={image('wide')} download={`${file}.png`}>
              <ImageDown size={16} /> Image for a post
            </a>
            <a className="cert-btn" href={image('square')} download={`${file}-square.png`}>
              <Download size={16} /> Square image (Instagram)
            </a>
            <a className="cert-btn" href={image('story')} download={`${file}-story.png`}>
              <Smartphone size={16} /> Story (Instagram, WhatsApp)
            </a>
            <a className="cert-btn" href={`/api/certificate/pdf?id=${encodeURIComponent(cert.id)}`} download>
              <Download size={16} /> Download PDF with verification QR
            </a>
            <button className="cert-btn" onClick={() => window.print()}>
              <Printer size={16} /> Print certificate
            </button>
          </div>
          <div className="cert-post" id="cert-post">
            <div className="cert-post-head">
              <b>Your post</b>
              <div className="cert-post-styles" role="group" aria-label="Post style">
                {POST_STYLES.map(([s, label]) => (
                  <button
                    key={s}
                    aria-pressed={style === s}
                    onClick={() => {
                      setStyle(s);
                      setDraft(null);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <CopyButton what="post" value={text} label="Copy text" />
            </div>
            <textarea aria-label="Post text" value={text} rows={Math.min(14, text.split('\n').length + 1)} maxLength={3000} spellCheck onChange={(e) => setDraft(e.target.value)} />
            {autoPost ? (
              <div className="cert-autopost">
                <button className="cert-btn linkedin" disabled={posting || !text.trim()} onClick={() => void postForMe()}>
                  <Linkedin size={16} /> {posting ? 'Opening LinkedIn…' : 'Post it on my LinkedIn'}
                </button>
                <small>
                  Posts this text with the certificate picture. LinkedIn asks you to allow it; radiology.monster makes this one post and keeps no access to your account.
                </small>
                {postError ? (
                  <p className="cert-autopost-error" role="alert">
                    {postError}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
          <div className="cert-cv">
            <div className="cert-post-head">
              <b>
                <FileText size={14} style={{ verticalAlign: '-2px' }} /> For your CV
              </b>
              <CopyButton what="CV line" value={cvLine} />
            </div>
            <pre>{cvLine}</pre>
          </div>
        </section>
      )}

      <section className="cert-cta">
        <div>
          <h2>{example ? 'Earn yours by reading real patients.' : `Learn to read scans the way ${cert.name.split(/\s+/)[0]} did.`}</h2>
          <p>Real CT, MRI, X-ray, mammography and ultrasound. Mark what you see and get graded on the exact slice.</p>
        </div>
        <a className="cert-btn primary" href="/">
          Start free <ArrowRight size={16} />
        </a>
      </section>
      <p className="cert-fine">
        Unproctored educational course completion. Not accredited CME, a professional qualification, or proof of clinical competence. Always check this page for current validity.
      </p>
    </main>
  );
}
