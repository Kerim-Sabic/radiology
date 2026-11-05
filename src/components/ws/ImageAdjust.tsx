import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Contrast, RotateCcw, SunMedium } from 'lucide-react';
import type { WindowPreset } from '../../schema/content';
import type { ViewerEngine } from '../../viewer/engine';

/**
 * Brightness and contrast for a phone, where dragging on the image is also how you mark, pan and scroll.
 * Two big sliders and one-tap presets: the sliders move from the starting point (the series as it opened, or the
 * preset just chosen), so the middle of each slider always means "as it was".
 */
const STEPS = 100;

/** Slider positions → a window. Brightness lowers the level (more of the image above it); contrast narrows the width. */
export function adjustedWindow(base: { center: number; width: number }, brightness: number, contrast: number) {
  const width = Math.max(1, base.width * Math.pow(2, -contrast / 40));
  const center = base.center - (brightness / STEPS) * base.width * 0.5;
  return { center, width };
}

export function ImageAdjust({
  engine,
  panelId,
  seriesUid,
  modality,
  presets,
}: {
  engine: ViewerEngine;
  panelId: string;
  seriesUid: string;
  modality: string;
  presets: WindowPreset[];
}) {
  const [open, setOpen] = useState(false);
  const [brightness, setBrightness] = useState(0);
  const [contrast, setContrast] = useState(0);
  const [preset, setPreset] = useState<string | null>(null);
  const [inverted, setInverted] = useState(false);
  const base = useRef<{ center: number; width: number } | null>(null);

  // Another view or series: start again from how that image looks now.
  useEffect(() => {
    base.current = null;
    setBrightness(0);
    setContrast(0);
    setPreset(null);
    setInverted(engine.isInverted(panelId));
  }, [engine, panelId, seriesUid]);

  const begin = () => {
    // The image may have been changed since (a preset key, a drag with the window tool): measure from what is on screen.
    base.current = engine.getWindow(panelId);
    setBrightness(0);
    setContrast(0);
    setInverted(engine.isInverted(panelId));
    setOpen(true);
  };

  const apply = (b: number, c: number) => {
    if (!base.current) base.current = engine.getWindow(panelId);
    if (!base.current) return;
    const w = adjustedWindow(base.current, b, c);
    engine.setWindow(panelId, w.center, w.width);
  };

  const choose = (p: WindowPreset) => {
    base.current = { center: p.center, width: p.width };
    setPreset(p.label);
    setBrightness(0);
    setContrast(0);
    engine.setWindow(panelId, p.center, p.width);
  };

  const original = () => {
    engine.resetWindow(panelId);
    base.current = engine.getWindow(panelId);
    setPreset(null);
    setBrightness(0);
    setContrast(0);
    setInverted(engine.isInverted(panelId));
  };

  const toggle = (
    <button
      type="button"
      className={`img-adjust-open${open ? ' on' : ''}`}
      onClick={() => (open ? setOpen(false) : begin())}
      aria-label="Brightness and contrast"
      aria-expanded={open}
    >
      <SunMedium size={17} aria-hidden /> Brightness
    </button>
  );
  if (!open) return toggle;

  // CT presets are named windows of Hounsfield units; other images keep their own.
  const named = modality === 'CT' ? presets : [];
  // The toolbar scrolls and fades at its edge, which would clip a panel drawn inside it: the panel goes to the page.
  return (
    <>
      {toggle}
      {createPortal(panel(), document.body)}
    </>
  );

  function panel() {
    return (
    <div className="img-adjust" role="group" aria-label="Brightness and contrast">
      <div className="img-adjust-chips">
        <button type="button" className={`img-chip${preset === null && !brightness && !contrast ? ' on' : ''}`} onClick={original}>
          Original
        </button>
        {named.map((p) => (
          <button key={p.label} type="button" className={`img-chip${preset === p.label && !brightness && !contrast ? ' on' : ''}`} onClick={() => choose(p)}>
            {p.label}
          </button>
        ))}
        <button
          type="button"
          className={`img-chip${inverted ? ' on' : ''}`}
          aria-pressed={inverted}
          onClick={() => {
            engine.invert(panelId);
            setInverted(engine.isInverted(panelId));
          }}
        >
          Invert
        </button>
      </div>
      <label className="img-slider">
        <SunMedium size={18} aria-hidden />
        <span className="img-slider-name">Brightness</span>
        <input
          type="range"
          min={-STEPS}
          max={STEPS}
          step={1}
          value={brightness}
          onChange={(e) => {
            const v = Number(e.target.value);
            setBrightness(v);
            apply(v, contrast);
          }}
        />
      </label>
      <label className="img-slider">
        <Contrast size={18} aria-hidden />
        <span className="img-slider-name">Contrast</span>
        <input
          type="range"
          min={-STEPS}
          max={STEPS}
          step={1}
          value={contrast}
          onChange={(e) => {
            const v = Number(e.target.value);
            setContrast(v);
            apply(brightness, v);
          }}
        />
      </label>
      <div className="img-adjust-foot">
        <button type="button" className="img-adjust-reset" onClick={original}>
          <RotateCcw size={15} aria-hidden /> Reset
        </button>
        <button type="button" className="btn primary sm" onClick={() => setOpen(false)}>
          Done
        </button>
      </div>
    </div>
    );
  }
}
