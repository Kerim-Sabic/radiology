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
            <b>Drills</b> — point to it, find its level, name the outline, best window. Misses return on a different patient; known structures return after 1, 3, 7, 16 and 35
            days.
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
