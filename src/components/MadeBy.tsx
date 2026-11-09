import { MAKER } from '../lib/provenance';

/**
 * "Made by [Horalix mark] Horalix.com": who makes Radiology Monster, linked to horalix.com. Quiet on purpose: never
 * louder than Radiology Monster's own brand. `className` lets the landing page and the app style it their own way.
 */
export function MadeBy({ className = 'made-by' }: { className?: string }) {
  return (
    <a className={className} href={MAKER.url} target="_blank" rel="noopener" aria-label={`Made by ${MAKER.name} (${MAKER.site})`}>
      <span>Made by</span>{' '}
      <img src={MAKER.logoOnDark} alt="" width={11} height={15} loading="lazy" decoding="async" />{' '}
      <span>{MAKER.site}</span>
    </a>
  );
}

/** The "About" card at the foot of Settings and the guide: who makes it, what it is for, and the public about page. */
export function AboutCard() {
  return (
    <section className="card stack" aria-labelledby="about-rm">
      <h2 id="about-rm">About</h2>
      <p className="muted">
        <MakerLine /> It is for education and practice, not for clinical diagnosis.
      </p>
      <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
        <MadeBy />
        <a href="/about">About Radiology Monster</a>
        <a href="/credits">Sources and credits</a>
      </div>
    </section>
  );
}

/** The about line with the link: "Radiology Monster is made by Horalix, a medical AI company in Sarajevo." */
export function MakerLine() {
  return (
    <>
      Radiology Monster is made by{' '}
      <a href={MAKER.url} target="_blank" rel="noopener">
        {MAKER.name}
      </a>
      , a medical AI company in Sarajevo.
    </>
  );
}
