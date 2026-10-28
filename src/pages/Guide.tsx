export default function GuidePage() {
  return (
    <div className="page-inner stack" style={{ gap: 18, maxWidth: 820 }}>
      <h1>Guide</h1>
      <section className="card stack">
        <h2>How to study</h2>
        <ol className="stack" style={{ gap: 6, paddingLeft: 18, margin: 0 }}>
          <li>
            Press <b>Start practice</b> on Today. You land on a real study with the task on the right.
          </li>
          <li>Orient first: modality, plane, the side letters at the image edges, and the window. Scroll through the whole stack before committing.</li>
          <li>
            Mark with <span className="kbd">M</span> (point) or <span className="kbd">A</span> (arrow with a name). Hold <span className="kbd">Shift</span> and drag to adjust the window
            while marking.
          </li>
          <li>Submit. Feedback separates level, identity, side and position, and shows your mark beside the reference on the exact slice.</li>
          <li>Open the linked page of the book, then “Return to my scan position”.</li>
          <li>Use “Same skill, different patient” — practising on new patients is what builds skill.</li>
        </ol>
        <p className="muted">
          <b>Modes:</b> Learn shows the reference and explanation from the start. Practice hides answers and offers hints (any hint or reveal makes the attempt
          “assisted”). Assess hides titles, hints and the book until you submit. Review revisits past attempts.
        </p>
      </section>
      <section className="card stack">
        <h2>Study tools</h2>
        <ul className="stack" style={{ gap: 6, paddingLeft: 18, margin: 0 }}>
          <li>
            <b>Drills</b> — point to a structure or a finding (pneumothorax, effusion, nodule, embolus, fracture…), find its level, name the outline, best window. Misses
            return on a different patient; known ones return after 1, 3, 7, 16 and 35 days.
          </li>
          <li>
            <b>By modality</b> — <i>MRI</i>: each view names its sequence (T1, T2, FLAIR, DWI, ADC…) and what is bright and dark on it, with the book page.{' '}
            <i>Mammography</i>: Layout → Mammography hangs CC above MLO, right breast on the left, back to back. <i>Radiographs, mammograms, ultrasound</i>: the
            magnifier (Q) shows fine detail such as calcifications. <i>Ultrasound</i>: brightness is echogenicity; orientation follows the probe marker.
          </li>
          <li>
            <b>On call</b> — a shift of unknown cases (5–20, one per patient, ones you have not read first) in Assess mode with a clock per case, then a scored report with
            every case to review.
          </li>
          <li>
            <b>Coach</b> tab — a fixed reading order for chest X-ray, chest CT, abdomen/pelvis CT and brain. <i>Show me</i> outlines each step’s structures together in the
            right window.
          </li>
          <li>
            <b>Compare with another patient</b> (two-people button) — a second patient kept at the same anatomical level as you scroll, matched by structures labelled on
            both.
          </li>
          <li>
            <b>Structure notes</b> — pick any structure in the Anatomy tab or Atlas: how it looks, what it touches, one pitfall, and the chapter.
          </li>
          <li>
            <b>Conditions</b> (top bar) — type a condition (pneumothorax, nodule, COVID-19…) to see every installed case that shows it, where it is, and the book pages that
            teach it.
          </li>
          <li>
            <b>Linked views</b> (chain button, K) — scrolling one view moves the others of the same patient; coloured lines show where each view cuts the others; double-click a
            point to show it in every view. <b>Planes</b> sets a thick slab (MIP, MinIP, average, any thickness) and tilts the MPR planes to any angle for oblique structures.
          </li>
          <li>
            <b>3D</b> (Layout → MPR + 3D) — <i>Cut</i> keeps only part of the body, or cuts at the slice you are reading and follows it as you scroll; <i>Structures</i> shows
            only what you pick (heart, arteries, veins, airways, bones…) as coloured models, names what is under the cursor, and <i>Quiz me</i> asks you to name or find them.
          </li>
          <li>
            <b>Confidence check</b> — “sure but wrong” answers go to the top of your reviews.
          </li>
        </ul>
      </section>
      <section className="card stack">
        <h2>What scores mean</h2>
        <p className="muted">
          Scores come from deterministic geometry against source annotations — never from the AI. If a reference only covers some structures, marks elsewhere are “unscored”, not
          wrong. Drafts (labelled “AI draft by Horalix”) are comparison aids only until you review them in Author. Milestones are product heuristics, not certification.
        </p>
      </section>
      <section className="card stack">
        <h2>Import the book</h2>
        <p className="muted">Settings → Book → Import PDF. The file stays in this browser. The app checks its SHA-256 against the verified 5th-edition copy so page anchors line up.</p>
      </section>
      <section className="card stack">
        <h2>Add a case</h2>
        <p className="muted">
          Quick look: Import → drop a folder/ZIP of DICOM (free reading, self-review). Curated case with tasks: add the subject to <span className="mono">scripts/data/selection.json</span>,
          run <span className="mono">python scripts/data/packs.py build &lt;pack&gt;</span>, then author cases/tasks in <span className="mono">public/packs/&lt;pack&gt;/lessons.json</span> and run{' '}
          <span className="mono">npm test</span> (the catalogue validator checks every task resolves to real series and targets).
        </p>
      </section>
      <section className="card stack">
        <h2>Data packs</h2>
        <p className="muted">
          The starter pack ships with the repository. Larger packs are rebuilt reproducibly from TCIA with <span className="mono">python scripts/data/packs.py fetch &lt;pack&gt;</span> and
          verified by checksum. Settings → Data packs shows what is installed.
        </p>
      </section>
      <section className="card stack">
        <h2>Back up progress</h2>
        <p className="muted">
          Progress lives in this browser’s storage and does not sync by itself. Progress → Export backup downloads a JSON file; Import backup restores or merges it in another browser
          or device.
        </p>
      </section>
      <section className="card stack">
        <h2>Limits</h2>
        <p className="muted">
          Personal educational practice — not a diagnostic tool, not certification, and no guarantee of exam results. Research annotations can disagree; the app shows provenance
          rather than false precision.
        </p>
      </section>
    </div>
  );
}
