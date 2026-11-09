import { useEffect, useState } from 'react';
import { MAKER } from '../lib/provenance';
import '../styles/credits.css';

type Link = { label: string; url: string };
type Credit = {
  ids: string[];
  name: string;
  what: string;
  usage: string;
  owner: string;
  license: string;
  licenseUrl?: string | null;
  permission: boolean;
  url: string;
  doi?: string | null;
  links: Link[];
  citation: string;
};
type Group = { kind: string; title: string; entries: Credit[] };

function CreditEntry({ c }: { c: Credit }) {
  return (
    <li className="credit" id={c.ids[0].replace(/[^A-Za-z0-9]+/g, '-')}>
      <h3>{c.name}</h3>
      {c.permission && <span className="permission">Used with the owners’ permission</span>}
      {c.what && <p>{c.what}</p>}
      {c.usage && <p>{c.usage}</p>}
      <dl>
        <dt>Owner</dt>
        <dd>{c.owner}</dd>
        <dt>Licence</dt>
        <dd>
          {c.licenseUrl ? (
            <a href={c.licenseUrl} target="_blank" rel="noopener noreferrer">{c.license}</a>
          ) : (
            c.license
          )}
        </dd>
        <dt>Link</dt>
        <dd>
          <a href={c.url} target="_blank" rel="noopener noreferrer">{c.url.replace(/^https?:\/\//, '')}</a>
          {c.links.map((l) => (
            <span key={l.url}>
              {' · '}
              <a href={l.url} target="_blank" rel="noopener noreferrer">{l.label}</a>
            </span>
          ))}
        </dd>
        {c.doi && (
          <>
            <dt>DOI</dt>
            <dd><a href={`https://doi.org/${c.doi}`} target="_blank" rel="noopener noreferrer">{c.doi}</a></dd>
          </>
        )}
        <dt>Citation</dt>
        <dd>{c.citation}</dd>
      </dl>
    </li>
  );
}

/** Public page: every data source and tool the app uses, with owner, licence, link and citation (public/content/credits.json). */
export default function CreditsPage() {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    document.title = 'Sources and credits · Radiology Monster';
    let live = true;
    fetch('/content/credits.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { groups: Group[] }) => live && setGroups(d.groups))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);
  return (
    <div className="credits-page">
      <main className="credits-wrap">
        <nav className="credits-top" aria-label="Radiology Monster">
          <a href="/">← Radiology Monster</a>
          <a href="/about">About</a>
        </nav>
        <h1>Sources and credits</h1>
        <p className="credits-intro">
          The cases and images in Radiology Monster come from the public and licensed datasets below. The datasets and their processing are presented by{' '}
          <a href={MAKER.url} target="_blank" rel="noopener">{MAKER.site}</a>. Every dataset remains the work and property of its owners and is used under the licence or permission named here. AI outlines are marked as AI drafts.
        </p>
        {failed && <p role="alert">The list could not be loaded. Please try again.</p>}
        {!groups && !failed && <p role="status" className="credits-intro">Loading…</p>}
        {groups?.map((g) => (
          <section key={g.kind} aria-labelledby={`credits-${g.kind}`}>
            <h2 id={`credits-${g.kind}`}>{g.title}</h2>
            <ul className="credits-list">
              {g.entries.map((c) => <CreditEntry key={c.ids[0]} c={c} />)}
            </ul>
          </section>
        ))}
      </main>
    </div>
  );
}
