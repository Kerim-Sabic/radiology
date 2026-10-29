import { useState, type ReactNode } from 'react';
import { ArrowRight, BookOpen, Bone, Crosshair, Layers, Link2, ListChecks, Play, Repeat, Rotate3d, Search, ShieldCheck, Siren, Sparkles } from 'lucide-react';
import { LANDING_CREDITS, LANDING_FACTS } from './landingFacts';
import './landing.css';

interface Props {
  /** The plans and checkout panel (owned by the membership gate). */
  panel: ReactNode;
  /** Signed in without access yet: the panel takes the hero's place, so checkout is the first thing on screen. */
  panelInHero: boolean;
  signInLabel: string;
  signInDisabled: boolean;
  onSignIn: () => void;
}

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

const FEATURES: Array<{ icon: ReactNode; title: string; text: string }> = [
  { icon: <Link2 />, title: 'Linked views', text: 'Scroll one plane and the others follow, with reference lines showing where you are. Double-click to jump all views to a point.' },
  { icon: <Rotate3d />, title: '3D you can take apart', text: 'Cut the volume at the slice you are reading, or show only the heart, the arteries, the veins or the finding itself.' },
  { icon: <Crosshair />, title: 'Graded where you mark', text: 'Mark what you see on the image. Level, side, position and name are checked separately against the expert outline.' },
  { icon: <BookOpen />, title: 'Linked to the book', text: 'Every task links to the page of Learning Radiology (5th ed.) that explains it, and its figure where there is one, then brings you back to your scan.' },
  { icon: <Repeat />, title: 'Drills that remember', text: 'Point to structures and findings. What you miss comes back later, on a different patient, until you know it.' },
  { icon: <Siren />, title: 'On-call shifts', text: 'A run of unknown cases with an optional clock, read with no hints, and a scored report at the end.' },
  { icon: <Search />, title: 'Search by condition', text: 'Type pneumothorax or pulmonary embolism and see every patient who has it, where it is, and the book pages.' },
  { icon: <Bone />, title: 'Anatomy atlas', text: 'Pick any structure, a rib, a vertebra, a lobe, and see it alone on a real CT or radiograph.' },
  { icon: <ListChecks />, title: 'Search-pattern coach', text: 'A step-by-step review for chest films, CT and MRI that shows each step’s structures together, so you never skip one.' },
];

const STEPS: Array<[string, string]> = [
  ['Read the scan', 'Check the modality, plane, side and window. Scroll the whole study before you decide.'],
  ['Mark and commit', 'Point to the finding on the slice where you see it, name it and say how sure you are.'],
  ['See where you were right', 'Your marks against the expert outline, with level, side and position graded separately.'],
  ['Read why', 'Open the book at the exact page and figure, then return to your scan as you left it.'],
  ['Prove it on a new patient', 'The same skill on a different patient. That is what counts as learned here.'],
];

const FAQ: Array<[string, ReactNode]> = [
  ['Who is it for?', 'Medical students, residents and anyone learning to read images who wants practice on real studies alongside Learning Radiology (5th ed.). Choose Student or Resident and what you are asked to write adapts.'],
  ['Where do the scans come from?', 'From public research collections released for reuse, including commercial use (Creative Commons and NIH terms). They are de-identified, and every case names its source and licence.'],
  ['Who marked the findings?', 'Findings are outlined by the radiologists and experts who published each collection. Organ outlines are AI drafts by Horalix and are labelled as drafts wherever they appear.'],
  ['Can I use it to diagnose patients?', 'No. radiology.monster is for education and practice only. It is not a medical device and must not be used for clinical decisions.'],
  ['What do I need?', 'A recent desktop browser such as Chrome, Edge or Firefox. Nothing to install. Tablets and phones work too; reading is easiest on a larger screen. The 3D view needs WebGL.'],
  ['Where is my progress kept?', 'In your browser on your device. Export a backup from Settings to move it to another device. One device is active at a time; signing in on another moves you there.'],
  ['How do I cancel?', 'Both plans renew, monthly every 30 days and yearly every 365 days, until you cancel future renewals from Billing. Have a promo code? Enter it before you choose a plan.'],
];

export function Landing({ panel, panelInHero, signInLabel, signInDisabled, onSignIn }: Props) {
  const [tab, setTab] = useState(MODALITIES[0].id);
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
            <img src="/logo-mark.svg" alt="" width={24} height={25} />
            <span>
              radiology<span>.monster</span>
            </span>
          </a>
          <nav className="lp-nav" aria-label="Page sections">
            <a href="#modalities">Modalities</a>
            <a href="#features">Features</a>
            <a href="#how">How it works</a>
            <a href="#pricing">Pricing</a>
            <a href="#faq">FAQ</a>
          </nav>
          <button className="lp-signin" onClick={onSignIn} disabled={signInDisabled}>
            {signInLabel} <ArrowRight size={15} />
          </button>
        </div>
      </header>

      <section className={`lp-hero${panelInHero ? ' with-panel' : ''}`}>
        <div className="lp-wrap lp-hero-grid">
          <div className="lp-hero-copy">
            <span className="lp-eyebrow">
              <Sparkles size={13} /> Real scans · real feedback · the book beside you
            </span>
            <h1>
              Learn to see.
              <br />
              <em>Then know why.</em>
            </h1>
            <p className="lp-lead">
              Read real CT, MRI, X-ray, mammography and ultrasound studies in a full workstation. Mark what you see, get graded on the exact slice, and open the page of <i>Learning Radiology</i> that explains it.
            </p>
            {panelInHero ? null : (
              <div className="lp-cta">
                <a className="lp-btn primary" href="#pricing">
                  Start learning <ArrowRight size={17} />
                </a>
                <a className="lp-btn" href="#modalities">
                  <Play size={15} /> See it in action
                </a>
              </div>
            )}
            <ul className="lp-ticks">
              <li>{LANDING_FACTS.modalities.length} modalities</li>
              <li>{LANDING_FACTS.patients}+ real patients</li>
              <li>Book-linked feedback</li>
            </ul>
          </div>
          {panelInHero ? (
            panel
          ) : (
            <figure className="lp-shot lp-hero-shot">
              <div className="lp-shot-bar" aria-hidden="true">
                <i />
                <i />
                <i />
                <span>radiology.monster/read</span>
              </div>
              <img
                src="/landing/hero.webp"
                width={1920}
                height={1200}
                fetchPriority="high"
                alt="The workstation: a CT pulmonary angiogram in linked axial, coronal and sagittal views, with a 3D view showing the clot inside the pulmonary arteries"
              />
              <figcaption className="lp-callout c1">
                <Link2 size={14} /> Scroll one view, the others follow
              </figcaption>
              <figcaption className="lp-callout c2">
                <Rotate3d size={14} /> 3D: the clot inside the pulmonary arteries
              </figcaption>
              <figcaption className="lp-callout c3">
                <Crosshair size={14} /> Graded against the expert outline
              </figcaption>
            </figure>
          )}
        </div>
      </section>

      <section className="lp-stats" aria-label="What is inside">
        <div className="lp-wrap lp-stats-row">
          <div>
            <b>{LANDING_FACTS.patients}+</b>
            <span>real patients</span>
          </div>
          <div>
            <b>{LANDING_FACTS.tasks}+</b>
            <span>image tasks</span>
          </div>
          <div>
            <b>{LANDING_FACTS.modalities.length}</b>
            <span>modalities</span>
          </div>
          <div>
            <b>{LANDING_FACTS.conditions}+</b>
            <span>conditions to search</span>
          </div>
          <div>
            <b>{LANDING_FACTS.objectives}</b>
            <span>book objectives mapped</span>
          </div>
        </div>
      </section>

      <section className="lp-section" id="modalities">
        <div className="lp-wrap">
          <div className="lp-head">
            <span className="lp-kicker">Every modality in the book</span>
            <h2>One workstation, built for each kind of image</h2>
            <p>Each modality is shown the way radiologists read it, not as a flat picture.</p>
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
            <figure className="lp-shot">
              <img key={shown.id} src={shown.img} width={1280} height={800} alt={shown.alt} loading="lazy" />
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

      <section className="lp-section alt" id="features">
        <div className="lp-wrap">
          <div className="lp-head">
            <span className="lp-kicker">More than a viewer</span>
            <h2>Everything you need to learn reading, in one place</h2>
          </div>
          <div className="lp-features">
            {FEATURES.map((f) => (
              <article key={f.title} className="lp-feature">
                <span className="lp-feature-icon" aria-hidden="true">
                  {f.icon}
                </span>
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
            <span className="lp-kicker">How a session works</span>
            <h2>Practice that turns into skill</h2>
            <ol className="lp-steps">
              {STEPS.map(([h, t], i) => (
                <li key={h}>
                  <span className="lp-step-n">{i + 1}</span>
                  <div>
                    <b>{h}</b>
                    <p>{t}</p>
                  </div>
                </li>
              ))}
            </ol>
            <p className="lp-modes">
              <Layers size={15} />
              <span>
                Four modes: <b>Learn</b> with labels on, <b>Practice</b> with hints, <b>Assess</b> with no help, and <b>Review</b> to go over your answers.
              </span>
            </p>
          </div>
          <figure className="lp-shot">
            <img src="/landing/conditions.webp" width={1280} height={800} loading="lazy" alt="Condition search for pneumothorax: four patients with the finding boxed, and the book pages that explain it" />
          </figure>
        </div>
      </section>

      {panelInHero ? null : (
        <section className="lp-section alt" id="pricing">
          <div className="lp-wrap">
            <div className="lp-head">
              <span className="lp-kicker">Pricing</span>
              <h2>Simple plans. Every feature included.</h2>
              <p>Both plans open the whole study space: every case, drill, shift and the on-site book reader.</p>
            </div>
            <div className="lp-pricing">{panel}</div>
          </div>
        </section>
      )}

      <section className="lp-section" id="faq">
        <div className="lp-wrap lp-faq-wrap">
          <div className="lp-head">
            <span className="lp-kicker">Questions</span>
            <h2>Good to know</h2>
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

      {panelInHero ? null : (
        <section className="lp-final">
          <div className="lp-wrap">
            <h2>Your next scan is waiting.</h2>
            <a className="lp-btn primary" href="#pricing">
              Choose your plan <ArrowRight size={17} />
            </a>
          </div>
        </section>
      )}

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
