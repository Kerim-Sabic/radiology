import { useEffect, useState, type ReactNode } from 'react';
import { trackFunnel } from '../services/serverSync';
import { ArrowRight, Check, ShieldCheck } from 'lucide-react';
import { fact, LANDING_CREDITS, LANDING_FACTS } from './landingFacts';
import { AI_CREDIT } from '../lib/provenance';
import './landing.css';

interface Props {
  /** The plans and checkout panel (owned by the membership gate). */
  panel: ReactNode;
  signInLabel: string;
  signInDisabled: boolean;
  onSignIn: () => void;
  /** Create a free account (the sample patients). */
  onStartFree: () => void;
}

const FREE_POINTS = ['Two sample patients in the full workstation', 'Learn and Practice modes, graded on the slice', 'Outlines, colours and 3D', 'No card needed'];

const MODALITIES: Array<{ id: string; name: string; img: string; alt: string; title: string; text: string; points: string[] }> = [
  {
    id: 'ct',
    name: 'CT',
    img: '/landing/ct.webp',
    alt: 'Contrast CT of the abdomen in linked axial, coronal and sagittal views with the kidneys and a renal mass outlined',
    title: 'Scroll, window and reformat like a reading room',
    text: 'Linked axial, coronal and sagittal views follow each other as you scroll. Switch windows with one key, read Hounsfield units under the cursor and see organ outlines on every plane.',
    points: ['Thick-slab MIP, MinIP and average', 'Tilted (oblique) planes', '3D you can cut and take apart'],
  },
  {
    id: 'mri',
    name: 'MRI',
    img: '/landing/mri.webp',
    alt: 'Diffusion-weighted MRI of the brain with an acute ischemic stroke outlined and the sequence named',
    title: 'Know which sequence you are looking at',
    text: 'Every series is named for what it is (T1, T2, FLAIR, diffusion, ADC) with what bright and dark mean on it, and the book page that teaches it.',
    points: ['Stroke on diffusion with the ADC map beside it', 'Expert-approved lesion outlines', 'Signal readout in arbitrary units, said so'],
  },
  {
    id: 'xray',
    name: 'X-ray',
    img: '/landing/xray.webp',
    alt: 'Frontal chest radiograph with a pneumothorax boxed by the source radiologists',
    title: 'Radiographs the way the book teaches them',
    text: 'Chest films, fractures in adults and children, and arthritis grades. Findings are boxed by the source readers, and the magnifier is one key away.',
    points: ['Pneumothorax, effusion, cardiomegaly, nodules', 'Growth-plate and torus fractures', 'Same-patient radiograph beside its CT'],
  },
  {
    id: 'mammo',
    name: 'Mammography',
    img: '/landing/mammo.webp',
    alt: 'Four-view screening mammogram hung with the CC views above the MLO views and the chest walls back to back',
    title: 'Hung like a real mammography reading',
    text: 'CC above MLO, the right breast on the left, chest walls back to back. The views are turned for you so you can compare left with right.',
    points: ['Masses and calcifications with their pathology', 'Margin and shape questions', 'CC and MLO of every breast'],
  },
  {
    id: 'us',
    name: 'Ultrasound',
    img: '/landing/us.webp',
    alt: 'Breast ultrasound with an irregular invasive carcinoma outlined by a radiologist',
    title: 'Cyst or solid? Read the echoes',
    text: 'Breast lesions outlined by radiologists with their biopsy results, and fetal heads to measure. Ultrasound images carry no patient orientation, and the app tells you so.',
    points: ['Carcinoma, fibroadenoma, simple cyst', 'Echo pattern and posterior features', 'Fetal head circumference'],
  },
];

const FEATURES: Array<{ title: string; text: string }> = [
  { title: 'Linked views', text: 'Scroll one plane and the others follow, with reference lines showing where you are. Double-click to jump all views to a point.' },
  { title: '3D you can take apart', text: 'Cut the volume at the slice you are reading, or show only the heart, the arteries, the veins or the finding itself, in colours you choose.' },
  { title: 'Graded where you mark', text: 'Mark what you see on the image. Level, side, position and name are checked separately against the expert outline.' },
  { title: 'Linked to the book', text: 'Every task names the page of Learning Radiology (5th ed.) that explains it. Open your own copy and the link jumps there, then back to your scan.' },
  { title: 'Drills that remember', text: 'Point to structures and findings. What you miss comes back later, on a different patient, until you know it.' },
  { title: 'On-call shifts', text: 'A run of unknown cases with an optional clock, read with no hints, and a scored report at the end.' },
  { title: 'Search by condition', text: 'Type pneumothorax or pulmonary embolism and see every patient who has it, where it is, and the book pages.' },
  { title: 'Anatomy atlas', text: 'Pick any structure, a rib, a vertebra, a lobe, and see it alone on a real CT or radiograph, outlined or filled in the colour you choose.' },
  { title: 'Search-pattern coach', text: 'A step-by-step review for chest films, CT and MRI that shows each step’s structures together, so you never skip one.' },
];

const STEPS: Array<[string, string]> = [
  ['Read the scan', 'Check the modality, plane, side and window. Scroll the whole study before you decide.'],
  ['Mark and commit', 'Point to the finding on the slice where you see it, name it and say how sure you are.'],
  ['See where you were right', 'Your marks against the expert outline, with level, side and position graded separately.'],
  ['Read why', 'Open the book at the exact page and figure, then return to your scan as you left it.'],
  ['Prove it on a new patient', 'The same skill on a different patient. That is what counts as learned here.'],
];

const FAQ: Array<[string, ReactNode]> = [
  ['Is there a free version?', 'Yes. A free account opens two sample patients in the full workstation, with grading. No card needed. Choose a plan when you want every patient, the case of the week, the drills, on-call shifts and certificates.'],
  ['Who is it for?', 'Medical students, residents and anyone learning to read images who wants practice on real studies alongside Learning Radiology (5th ed.). Choose Student or Resident and what you are asked to write adapts.'],
  ['How do I earn a certificate?', 'Pass an exam. The levels go in order, and each is a real step up. Foundation: 15 questions, untimed, pass mark 70%. Intermediate: 25 questions, 3 minutes each, pass mark 80%, at least half of them marking the finding on the image, with no two-answer questions. Advanced: 40 questions, 2 minutes each, pass mark 90% with no half points, mostly marked on the image, subtle cases first. The whole library has three more levels, with 30, 50 and 75 questions from across the body areas. Each question shows a real patient, with no hints, and every answer is graded against the expert\'s reference; the result comes after the last question, with every answer to review. Pass, type your name, and your certificate has its own check page, goes on LinkedIn under Licenses & certifications, and comes as images for posts and stories.'],
  ['Where do the scans come from?', 'From public research collections released for reuse, including commercial use (Creative Commons and NIH terms). They are de-identified, and every case names its source and licence.'],
  [
    'Who marked the findings and the anatomy?',
    <>
      Findings are outlined by the radiologists and experts who published each collection, and only those expert outlines grade your answers. The anatomy layer, the
      organs, vessels, bones and airways named on every scan, is drawn by AI and labelled AI wherever it appears.{' '}
      <a href={AI_CREDIT.url} target="_blank" rel="noopener">
        Thanks to {AI_CREDIT.name}
      </a>
      , every structure in it is marked.
    </>,
  ],
  ['Can I use it to diagnose patients?', 'No. radiology.monster is for education and practice only. It is not a medical device and must not be used for clinical decisions.'],
  ['What do I need?', 'A recent desktop browser such as Chrome, Edge or Firefox. Nothing to install. Tablets and phones work too; reading is easiest on a larger screen. The 3D view needs WebGL.'],
  ['Do I need the book?', 'No, but it helps. Every task names the page of Learning Radiology (5th ed.) that explains it. Open your own copy of the PDF in the app and the links jump straight to the page; it stays on your device and is never uploaded. SSST students signed in with their university email get the book included.'],
  ['Where is my progress kept?', 'In your browser on your device. Export a backup from Settings to move it to another device. One device is active at a time; signing in on another moves you there.'],
  ['Is the yearly plan paid monthly?', 'No. The yearly plan costs $150 in one payment every 365 days. $12.50 is its monthly equivalent. If you prefer a smaller upfront payment, choose monthly at $20 every 30 days.'],
  ['How do I cancel?', 'Both plans renew, monthly every 30 days and yearly every 365 days, until you cancel future renewals from Billing. Have a promo code? Enter it before you choose a plan.'],
];

export function Landing({ panel, signInLabel, signInDisabled, onSignIn, onStartFree }: Props) {
  const [tab, setTab] = useState(MODALITIES[0].id);
  useEffect(() => trackFunnel('visit', true), []);
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
          <a className="lp-brand" href="/" aria-label="radiology.monster home">
            <img src="/logo-mark.svg" alt="" width={22} height={23} />
            <span>radiology.monster</span>
          </a>
          <nav className="lp-nav" aria-label="Page sections">
            <a href="#modalities">Modalities</a>
            <a href="#features">Features</a>
            <a href="#how">How it works</a>
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
          <p className="lp-overline">For medical students and residents</p>
          <h1>Learn to read scans on real patients.</h1>
          <p className="lp-lead">
            {fact(LANDING_FACTS.patients)}+ de-identified CT, MRI, X-ray, mammography and ultrasound studies in a full reading workstation. Mark what you see, get graded
            against the expert outline on the exact slice, and open the page of <i>Learning Radiology</i> that explains it.
          </p>
          <div className="lp-cta">
            <button className="lp-btn primary" onClick={onStartFree} disabled={signInDisabled}>
              Start free
            </button>
            <a className="lp-btn" href="#plans">
              See plans
            </a>
          </div>
          <p className="lp-note">Free account with two patients. No card needed.</p>
        </div>
        <figure className="lp-wrap lp-figure lp-hero-shot">
          <div className="lp-frame">
            <img
              src="/landing/hero.webp"
              width={1920}
              height={1200}
              fetchPriority="high"
              alt="The workstation: a CT pulmonary angiogram in linked axial, coronal and sagittal views, with a 3D view showing the clot inside the pulmonary arteries"
            />
          </div>
          <figcaption>
            <b>Fig. 1</b> CT pulmonary angiogram in the workstation. Linked axial, coronal and sagittal views follow each other; the clot is outlined by the radiologists
            who published the study, and shown inside the pulmonary arteries in 3D.
          </figcaption>
        </figure>
      </section>

      <section className="lp-facts" aria-label="What is inside">
        <dl className="lp-wrap">
          <div>
            <dt>Real patients</dt>
            <dd>{fact(LANDING_FACTS.patients)}+</dd>
          </div>
          <div>
            <dt>Graded image tasks</dt>
            <dd>{fact(LANDING_FACTS.tasks)}+</dd>
          </div>
          <div>
            <dt>Modalities</dt>
            <dd>{LANDING_FACTS.modalities.length}</dd>
          </div>
          <div>
            <dt>Conditions to search</dt>
            <dd>{LANDING_FACTS.conditions}+</dd>
          </div>
          <div>
            <dt>Book objectives mapped</dt>
            <dd>{LANDING_FACTS.objectives}</dd>
          </div>
        </dl>
      </section>

      <section className="lp-section" id="modalities">
        <div className="lp-wrap">
          <div className="lp-head">
            <h2>Every modality, read the way radiologists read it.</h2>
            <p>The whole study, in the planes, windows and sequences it was acquired in. Not a flat picture with an arrow on it.</p>
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
                <img key={shown.id} src={shown.img} width={1280} height={800} alt={shown.alt} loading="lazy" />
              </div>
              <figcaption>
                <b>Fig. 2</b> {shown.alt}.
              </figcaption>
            </figure>
            <div className="lp-modality-copy">
              <h3>{shown.title}</h3>
              <p>{shown.text}</p>
              <ul>
                {shown.points.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="lp-section" id="features">
        <div className="lp-wrap">
          <div className="lp-head">
            <h2>More than a viewer.</h2>
            <p>What sits around the image, so that looking turns into reading.</p>
          </div>
          <div className="lp-specs">
            {FEATURES.map((f) => (
              <article key={f.title}>
                <h3>{f.title}</h3>
                <p>{f.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="lp-section" id="how">
        <div className="lp-wrap lp-split">
          <div>
            <div className="lp-head">
              <h2>A session, step by step.</h2>
            </div>
            <ol className="lp-steps">
              {STEPS.map(([h, t], i) => (
                <li key={h}>
                  <span className="lp-step-n">{String(i + 1).padStart(2, '0')}</span>
                  <div>
                    <b>{h}</b>
                    <p>{t}</p>
                  </div>
                </li>
              ))}
            </ol>
            <p className="lp-modes">
              Four modes: <b>Learn</b> with labels on, <b>Practice</b> with hints, <b>Assess</b> with no help, and <b>Review</b> to go over your answers.
            </p>
          </div>
          <figure className="lp-figure">
            <div className="lp-frame">
              <img src="/landing/conditions.webp" width={1280} height={800} loading="lazy" alt="Condition search for pneumothorax: four patients with the finding boxed, and the book pages that explain it" />
            </div>
            <figcaption>
              <b>Fig. 3</b> Condition search for pneumothorax: four patients with the finding boxed by the source readers, and the book pages that explain it.
            </figcaption>
          </figure>
        </div>
      </section>

      <section className="lp-section" id="weekly">
        <div className="lp-wrap lp-weekly">
          <div>
            <h2>A new case every Monday.</h2>
            <p>
              Members get one featured patient every week, with the task, the expert outline and the page of the book that explains it, and an email when it is out.
              Every earlier case stays in the library.
            </p>
          </div>
          <a className="lp-btn" href="#pricing">
            See plans <ArrowRight size={16} />
          </a>
        </div>
      </section>

      <section className="lp-section" id="pricing">
        <div className="lp-wrap">
          <div className="lp-head">
            <h2>Start free. Upgrade when you are ready.</h2>
            <p>Every plan opens every patient, drill, on-call shift and certificate.</p>
          </div>
          <div className="lp-pricing-grid">
            <article className="lp-free">
              <div>
                <h3>Free</h3>
                <span>See how it works</span>
              </div>
              <div className="lp-free-price">
                $0<span>forever</span>
              </div>
              <ul>
                {FREE_POINTS.map((p) => (
                  <li key={p}>
                    <Check size={15} /> {p}
                  </li>
                ))}
              </ul>
              <button className="lp-btn" onClick={onStartFree} disabled={signInDisabled}>
                Create a free account
              </button>
            </article>
            <div className="lp-pricing">{panel}</div>
          </div>
        </div>
      </section>

      <section className="lp-section" id="faq">
        <div className="lp-wrap lp-faq-wrap">
          <div className="lp-head">
            <h2>Questions</h2>
          </div>
          <div className="lp-faq">
            {FAQ.map(([q, a]) => (
              <details key={q}>
                <summary>{q}</summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="lp-final">
        <div className="lp-wrap">
          <h2>Your next scan is waiting.</h2>
          <div className="lp-cta">
            <button className="lp-btn primary" onClick={onStartFree} disabled={signInDisabled}>
              Start free
            </button>
            <a className="lp-btn" href="#pricing">
              Choose a plan
            </a>
          </div>
        </div>
      </section>

      <footer className="lp-footer">
        <div className="lp-wrap">
          <div className="lp-footer-top">
            <span className="lp-brand small">
              <img src="/logo-mark.svg" alt="" width={18} height={19} />
              radiology.monster
            </span>
            <span className="lp-safe">
              <ShieldCheck size={14} /> For education and practice. Not for clinical diagnosis.
            </span>
          </div>
          <p className="lp-credits lp-affiliation">
            <i>Learning Radiology: Recognizing the Basics</i> is referenced by page for study. radiology.monster is not affiliated with or endorsed by its publisher or authors.
          </p>
          <p className="lp-credits">
            Anatomy outlines: AI.{' '}
            <a href={AI_CREDIT.url} target="_blank" rel="noopener">
              Thanks to {AI_CREDIT.name}
            </a>
            , we managed to mark every structure in the anatomy layer.
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
