import { useEffect, useState, type ReactNode } from 'react';
import { trackFunnel } from '../services/serverSync';
import { ChevronRight, ShieldCheck } from 'lucide-react';
import { TRY_CASE_URL } from './guest';
import { fact, LANDING_CREDITS, LANDING_FACTS } from './landingFacts';
import { AI_CREDIT } from '../lib/provenance';
import { MadeBy, MakerLine } from '../components/MadeBy';
import type { RegionalPrice } from './regionalPrice';
import { priceAnswers } from './priceAnswers';
import './landing.css';

interface Props {
  /** The plans and checkout panel (owned by the membership gate). */
  panel: ReactNode;
  /** The price for the visitor's country, when regional prices apply there (the FAQ then quotes it). */
  regional?: RegionalPrice;
  signInLabel: string;
  signInDisabled: boolean;
  onSignIn: () => void;
  /** Create a free account (the sample patients). */
  onStartFree: () => void;
}

/*
 * Written plainly on purpose: no badge over the headline, no labels over headings, no stat banner, no numbered steps,
 * no icon above every feature, no glow behind the product, no slogan contrasts. The scans do the selling.
 */

const MODALITIES: Array<{ id: string; name: string; img: string; alt: string; title: string; text: string }> = [
  {
    id: 'ct',
    name: 'CT',
    img: '/landing/ct.webp',
    alt: 'Contrast CT of the abdomen in linked axial, coronal and sagittal views with the kidneys and a renal mass outlined',
    title: 'Scroll, window and reformat like a reading room',
    text: 'Axial, coronal and sagittal views follow each other as you scroll. Switch windows with one key, read Hounsfield units under the cursor, and use thick-slab MIP, tilted planes and 3D.',
  },
  {
    id: 'mri',
    name: 'MRI',
    img: '/landing/mri.webp',
    alt: 'Diffusion-weighted MRI of the brain with an acute ischemic stroke outlined and the sequence named',
    title: 'Know which sequence you are looking at',
    text: 'Every series is named for what it is (T1, T2, FLAIR, diffusion, ADC), with what bright and dark mean on it and the book page that teaches it. Stroke cases show diffusion beside the ADC map.',
  },
  {
    id: 'xray',
    name: 'X-ray',
    img: '/landing/xray.webp',
    alt: 'Frontal chest radiograph with a pneumothorax boxed by the source radiologists',
    title: 'Radiographs the way the book teaches them',
    text: 'Chest films, fractures in adults and children, and arthritis grades. Findings are boxed by the source readers, and the magnifier is one key away.',
  },
  {
    id: 'mammo',
    name: 'Mammography',
    img: '/landing/mammo.webp',
    alt: 'Four-view screening mammogram hung with the CC views above the MLO views and the chest walls back to back',
    title: 'Hung like a real mammography reading',
    text: 'CC above MLO, the right breast on the left, chest walls back to back, so you compare left with right. Masses and calcifications come with their pathology.',
  },
  {
    id: 'us',
    name: 'Ultrasound',
    img: '/landing/us.webp',
    alt: 'Breast ultrasound with an irregular invasive carcinoma outlined by a radiologist',
    title: 'Cyst or solid? Read the echoes',
    text: 'Breast lesions outlined by radiologists with their biopsy results, and fetal heads to measure. Ultrasound images carry no patient orientation, and the app tells you so.',
  },
];

const FEATURES: Array<[string, string]> = [
  ['Linked views', 'Scroll one plane and the others follow. Double-click to send every view to the same point.'],
  ['3D you can take apart', 'Cut the volume at the slice you are reading, or show only the heart, arteries, veins or the finding.'],
  ['The book, a click away', 'Every task names the page of Learning Radiology (5th ed.) that explains it. Open your own copy and the link jumps there.'],
  ['Drills that come back', 'Point to structures and findings. What you miss returns later on a different patient.'],
  ['On-call shifts', 'A run of unknown cases with an optional clock, no hints, and a scored report at the end.'],
  ['Search by condition', 'Type pneumothorax and see every patient who has it, where it is, and the book pages.'],
  ['Anatomy atlas', 'Pick a rib, a vertebra or a lobe and see it alone on a real CT or radiograph.'],
  ['Search-pattern coach', 'A step-by-step review for chest films, CT and MRI, so no structure is skipped.'],
];

const faq = (regional?: RegionalPrice): Array<[string, ReactNode]> => [
  ['What is Radiology Monster?', 'Radiology Monster (radiology.monster) is a radiology reading workstation in your browser for medical students and residents: real CT, MRI, X-ray, mammography and ultrasound studies from 600+ patients, where you scroll the whole study, mark what you see and are graded against the expert reference on the exact slice.'],
  [
    'Who makes Radiology Monster?',
    <>
      <MakerLine /> Horalix builds AI for medical imaging. Radiology Monster is for education and practice, not diagnosis.{' '}
      <a href="/about">More about who makes it and where the cases come from</a>.
    </>,
  ],
  ...priceAnswers(regional),
  ['Can professors use it with a class?', 'Yes. A professor gets a class page with one join link to share. Students join after seeing what the professor can follow: their study days, exam results and certificates, never their answers or payments. Students can leave the class at any time.'],
  ['How do I earn a certificate?', 'Pass an exam. The levels go in order and each is a real step up: Foundation has 15 untimed questions with a 70% pass mark, Intermediate 25 questions at 3 minutes each with 80%, and Advanced 40 questions at 2 minutes each with 90% and no half points. The whole library has three more levels, with 30, 50 and 75 questions. Every question is a real patient with no hints, graded against the expert reference, and the result comes after the last question. Your certificate has its own check page and can go on LinkedIn under Licenses & certifications.'],
  ['Where do the scans come from?', 'From public research collections released for reuse, including commercial use (Creative Commons and NIH terms). They are de-identified, and every case names its source and licence.'],
  [
    'Who marked the findings and the anatomy?',
    <>
      Findings come from the reference annotations published with each collection, made by its radiologists and clinicians or under their supervision, and only those
      references grade your case answers and exams. Each case names its source. The anatomy layer, the
      organs, vessels, bones and airways named on every scan, is drawn by AI and labelled AI wherever it appears; anatomy drills use it too, marked AI.{' '}
      <a href={AI_CREDIT.url} target="_blank" rel="noopener">
        Thanks to {AI_CREDIT.name}
      </a>
      , every structure in it is marked.
    </>,
  ],
  ['Can I use it to diagnose patients?', 'No. Radiology Monster is for education and practice only. It is not a medical device and must not be used for clinical decisions.'],
  ['What do I need?', 'A recent desktop browser such as Chrome, Edge or Firefox. Nothing to install. Tablets and phones work too; reading is easiest on a larger screen. The 3D view needs WebGL.'],
  ['Do I need the book?', 'No, but it helps. Every task names the page of Learning Radiology (5th ed.) that explains it. Open your own copy of the PDF in the app and the links jump straight to the page; it stays on your device and is never uploaded. SSST students signed in with their university email get the book included.'],
  ['What do you measure about visits?', 'Which steps a visit takes, so we can see where the site is slow or confusing: for example "the first image appeared after 9 seconds", "marked it", "pressed a plan". A random id kept in your browser for 90 days ties the steps of one visit together; it is not a cookie and says nothing about you. We never record names, email addresses, IP addresses, what you type or card details, and the log is deleted after 90 days.'],
  ['Where is my progress kept?', 'In your account. Every answer you submit is saved there with its grade, so your answers, scores and mistake notebook follow you to any device where you sign in. Your browser keeps a copy too: if the connection drops, nothing is lost, and it is saved to your account once you are back online. One device is signed in at a time; signing in on another moves you there.'],
];

/** Sections fade in once as they are scrolled to: never with reduced motion, and nothing is hidden without script. */
function useReveal() {
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined' || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          e.target.classList.add('in');
          io.unobserve(e.target);
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
    );
    for (const el of document.querySelectorAll<HTMLElement>('.lp .reveal')) {
      // Already on screen at load: shown at once, no animation.
      if (el.getBoundingClientRect().top < innerHeight) continue;
      el.classList.add('pre');
      io.observe(el);
    }
    return () => io.disconnect();
  }, []);
}

export function Landing({ panel, regional, signInLabel, signInDisabled, onSignIn, onStartFree }: Props) {
  const [tab, setTab] = useState(MODALITIES[0].id);
  useEffect(() => trackFunnel('visit', true), []);
  useReveal();
  const shown = MODALITIES.find((m) => m.id === tab) ?? MODALITIES[0];
  const onTabKey = (e: React.KeyboardEvent, i: number) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = MODALITIES[(i + step + MODALITIES.length) % MODALITIES.length];
    setTab(next.id);
    document.getElementById(`lp-tab-${next.id}`)?.focus();
  };

  return (
    <>
      <header className="lp-header">
        <div className="lp-wrap lp-header-row">
          <a className="lp-brand" href="/" aria-label="Radiology Monster home">
            <img src="/logo-mark.svg" alt="" width={20} height={21} />
            <span>Radiology Monster</span>
          </a>
          <nav className="lp-nav" aria-label="Page sections">
            <a href="#modalities">Modalities</a>
            <a href="#pricing">Pricing</a>
            <a href="#faq">FAQ</a>
          </nav>
          <div className="lp-header-actions">
            <button className="lp-signin" onClick={onSignIn} disabled={signInDisabled}>
              {signInLabel}
            </button>
            <button className="lp-btn primary small" onClick={onStartFree} disabled={signInDisabled}>
              Start free
            </button>
          </div>
        </div>
      </header>

      <section className="lp-hero">
        <div className="lp-wrap lp-hero-copy">
          <h1>Learn to read scans on real patients.</h1>
          <p className="lp-lead">
            Mark the finding on real CT, MRI and X-ray studies from {fact(LANDING_FACTS.patients)}+ patients, and see how close you were to the radiologist’s outline.
          </p>
          <div className="lp-cta">
            <a className="lp-btn primary" href={TRY_CASE_URL}>
              Try a case now
            </a>
            <button className="lp-link" onClick={onStartFree} disabled={signInDisabled}>
              Start free <ChevronRight size={17} aria-hidden />
            </button>
          </div>
          <p className="lp-note">The first case needs no sign-up.</p>
        </div>
        <figure className="lp-hero-shot reveal">
          <div className="lp-frame">
            {/* A phone gets the four views alone, big enough to read; a wider screen the whole workstation. */}
            <picture>
              <source media="(max-width: 734px)" srcSet="/landing/hero-phone.webp" width={1200} height={932} />
              <img
                src="/landing/hero.webp"
                width={2400}
                height={1500}
                fetchPriority="high"
                alt="The workstation: a CT pulmonary angiogram in linked axial, coronal and sagittal views, with a 3D view showing the clot inside the pulmonary arteries"
              />
            </picture>
          </div>
          <figcaption>A CT pulmonary angiogram in linked views and 3D. The clot, outlined by the radiologists who published the study, shows in yellow.</figcaption>
        </figure>
      </section>

      <section className="lp-section" id="graded">
        <div className="lp-wrap">
          <div className="lp-head center reveal">
            <h2>See exactly where you were right.</h2>
            <p>
              Point to the finding on the slice where you see it. Your mark is checked against the outline the radiologists drew, then the book page that explains it
              is one click away.
            </p>
          </div>
          <figure className="lp-graded-shot reveal">
            <picture>
              <source media="(max-width: 734px)" srcSet="/landing/graded-phone.webp" width={1200} height={827} />
              <img
                src="/landing/graded.webp"
                width={2000}
                height={947}
                loading="lazy"
                alt="A chest radiograph after grading: the student's mark sits inside the pneumothorax boxed by the source radiologists, and the answer is marked Correct, 100%"
              />
            </picture>
          </figure>
        </div>
      </section>

      <section className="lp-section" id="modalities">
        <div className="lp-wrap">
          <div className="lp-head center reveal">
            <h2>CT, MRI, X-ray, mammography and ultrasound.</h2>
            <p>Scroll the whole study in the planes, windows and sequences it was acquired in.</p>
          </div>
          <div className="lp-tabs" role="tablist" aria-label="Modalities">
            {MODALITIES.map((m, i) => (
              <button
                key={m.id}
                id={`lp-tab-${m.id}`}
                role="tab"
                aria-selected={m.id === tab}
                aria-controls="lp-modality-panel"
                tabIndex={m.id === tab ? 0 : -1}
                onClick={() => setTab(m.id)}
                onKeyDown={(e) => onTabKey(e, i)}
              >
                {m.name}
              </button>
            ))}
          </div>
          <div className="lp-modality" id="lp-modality-panel" role="tabpanel" aria-labelledby={`lp-tab-${shown.id}`}>
            <figure className="lp-figure">
              <div className="lp-frame">
                <img key={shown.id} src={shown.img} width={1600} height={912} alt={shown.alt} loading="lazy" />
              </div>
            </figure>
            <div className="lp-modality-copy">
              <h3>{shown.title}</h3>
              <p>{shown.text}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="lp-section" id="features">
        <div className="lp-wrap lp-features reveal">
          <h2>Also inside</h2>
          <dl className="lp-specs">
            {FEATURES.map(([title, text]) => (
              <div key={title}>
                <dt>{title}</dt>
                <dd>{text}</dd>
              </div>
            ))}
            <div>
              <dt>A new case every Monday</dt>
              <dd>
                Members get one featured patient a week, with the expert outline and the book page.{' '}
                <a className="lp-link small" href="#plans">
                  See plans <ChevronRight size={15} aria-hidden />
                </a>
              </dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="lp-section" id="pricing">
        <div className="lp-wrap">
          <div className="lp-head center reveal">
            <h2>Pricing</h2>
            <p>Every plan opens every patient, drill, on-call shift and certificate.</p>
          </div>
          <div className="lp-pricing">{panel}</div>
          <article className="lp-free">
            <div>
              <h3>Free</h3>
              <p>Two sample patients in the full workstation, graded on the slice. No card needed.</p>
            </div>
            <div className="lp-free-go">
              <span className="lp-free-price">$0</span>
              <button className="lp-btn" onClick={onStartFree} disabled={signInDisabled}>
                Create a free account
              </button>
            </div>
          </article>
        </div>
      </section>

      <section className="lp-section" id="faq">
        <div className="lp-wrap lp-faq-wrap">
          <div className="lp-head">
            <h2>Questions</h2>
          </div>
          <div className="lp-faq">
            {faq(regional).map(([q, a]) => (
              <details key={q}>
                <summary>{q}</summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="lp-final">
        <div className="lp-wrap reveal">
          <h2>Find the pneumothorax.</h2>
          <p>A real chest X-ray, graded against the radiologists’ box. No sign-up.</p>
          <div className="lp-cta">
            <a className="lp-btn primary" href={TRY_CASE_URL}>
              Try a case now
            </a>
          </div>
        </div>
      </section>

      <footer className="lp-footer">
        <div className="lp-wrap">
          <div className="lp-footer-top">
            <span className="lp-footer-brand">
              <span className="lp-brand small">
                <img src="/logo-mark.svg" alt="" width={18} height={19} />
                Radiology Monster
              </span>
              <MadeBy className="lp-madeby" />
            </span>
            <span className="lp-safe">
              <ShieldCheck size={14} /> For education and practice. Not for clinical diagnosis.
            </span>
          </div>
          <p className="lp-credits lp-affiliation">
            <i>Learning Radiology: Recognizing the Basics</i> is referenced by page for study. Radiology Monster is not affiliated with or endorsed by its publisher or authors.
          </p>
          <p className="lp-credits">
            Anatomy outlines: AI.{' '}
            <a href={AI_CREDIT.url} target="_blank" rel="noopener">
              Thanks to {AI_CREDIT.name}
            </a>
            , the company that makes Radiology Monster, every structure in the anatomy layer is marked.{' '}
            <a href="/about">About Radiology Monster</a>
          </p>
          <p className="lp-credits">
            Images on this page are screenshots of the app showing public research data, with outlines drawn by the app from each collection’s own annotations:{' '}
            {LANDING_CREDITS.map((c, i) => (
              <span key={c.url}>
                <a href={c.url} target="_blank" rel="noopener noreferrer">
                  {c.name}
                </a>{' '}
                ({c.license}){i < LANDING_CREDITS.length - 1 ? '; ' : '.'}
              </span>
            ))}
          </p>
        </div>
      </footer>
    </>
  );
}
