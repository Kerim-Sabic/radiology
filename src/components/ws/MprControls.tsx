import { Popover } from 'radix-ui';
import { ChevronDown, Layers2, RotateCw } from 'lucide-react';
import { PLANE_COLORS, type PlaneKind, type SlabMode, type ViewerEngine } from '../../viewer/engine';

const BLENDS: Array<[NonNullable<SlabMode>['blend'] | 'thin', string, string]> = [
  ['thin', 'Thin', 'One slice, normal reading'],
  ['mip', 'MIP', 'Brightest voxel: vessels, nodules, contrast'],
  ['minip', 'MinIP', 'Darkest voxel: airways, emphysema'],
  ['avg', 'Average', 'Mean of the slab: less noise'],
];

export function slabName(m: SlabMode) {
  return !m ? 'Slab' : `${m.blend === 'mip' ? 'MIP' : m.blend === 'minip' ? 'MinIP' : 'Avg'} ${m.mm} mm`;
}

/** Slab and angle of the MPR planes, in one toolbar control. */
export function PlanesControl({ engine, focused, kind }: { engine: ViewerEngine; focused: string; kind: PlaneKind | null }) {
  const m = engine.getSlab();
  const tilt = kind ? engine.tiltOf(focused) : 0;
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button className={`btn sm${m || tilt ? ' on' : ''}`} aria-label="Slab and angle of the MPR planes">
          <Layers2 size={14} /> {m ? slabName(m) : 'Planes'}
          {tilt ? ` · ${tilt}°` : ''} <ChevronDown size={12} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="popover mpr-pop" sideOffset={6}>
          <SlabSection engine={engine} />
          <hr className="mpr-hr" />
          <TiltSection engine={engine} focused={focused} kind={kind} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Slab thickness and projection of the MPR views (any thickness from 1 to 60 mm). */
function SlabSection({ engine }: { engine: ViewerEngine }) {
  const m = engine.getSlab();
  const mm = m?.mm ?? 10;
  const set = (blend: NonNullable<SlabMode>['blend'] | 'thin', thickness = mm) => engine.setSlab(blend === 'thin' ? null : { mm: thickness, blend });
  return (
    <>
          <b>Slab</b>
          <p className="faint">A thick slab shows several millimetres at once — follow a vessel, find nodules, see the airways.</p>
          <div className="seg" role="group" aria-label="Slab projection">
            {BLENDS.map(([b, label, why]) => (
              <button key={b} className={`btn sm${(m?.blend ?? 'thin') === b ? ' on' : ''}`} aria-pressed={(m?.blend ?? 'thin') === b} title={why} onClick={() => set(b)}>
                {label}
              </button>
            ))}
          </div>
          <label className="mpr-range">
            <span>Thickness</span>
            <input
              type="range"
              min={1}
              max={60}
              step={1}
              value={mm}
              disabled={!m}
              onChange={(e) => m && set(m.blend, Number(e.target.value))}
              aria-label="Slab thickness in millimetres"
            />
            <b className="mono">{m ? `${mm} mm` : '—'}</b>
          </label>
          <div className="row wrap" style={{ gap: 4 }}>
            {[5, 10, 20, 40].map((v) => (
              <button key={v} className="chip-btn" onClick={() => set(m?.blend ?? 'mip', v)}>
                {v} mm
              </button>
            ))}
          </div>
          <p className="faint" style={{ marginTop: 6 }}>
            {m ? BLENDS.find(([b]) => b === m.blend)?.[2] : 'Pick MIP, MinIP or Average to thicken the slab.'}
          </p>
    </>
  );
}

/** Tilt the other MPR planes around the axis of the selected view (oblique reformats). */
function TiltSection({ engine, focused, kind }: { engine: ViewerEngine; focused: string; kind: PlaneKind | null }) {
  const angle = kind ? engine.tiltOf(focused) : 0;
  const others = (['axial', 'coronal', 'sagittal'] as PlaneKind[]).filter((k) => k !== kind);
  return (
    <>
          <b>
            <RotateCw size={12} /> Angle of the planes
          </b>
          {kind ? (
            <>
              <p className="faint">
                Turns the{' '}
                {others.map((k, i) => (
                  <span key={k}>
                    {i ? ' and ' : ''}
                    <span className="plane-dot" style={{ background: PLANE_COLORS[k], marginLeft: 0, marginRight: 3 }} />
                    {k}
                  </span>
                ))}{' '}
                planes around the axis of the <b>{kind}</b> view you selected — to lay a plane along an oblique structure (aortic arch, a rib, the long axis of the heart).
              </p>
              <label className="mpr-range">
                <span>Tilt</span>
                <input type="range" min={-90} max={90} step={1} value={angle} onChange={(e) => engine.tiltFrom(focused, Number(e.target.value) - angle)} aria-label={`Tilt around the ${kind} axis in degrees`} />
                <b className="mono">{angle}°</b>
              </label>
              <div className="row wrap" style={{ gap: 4 }}>
                {[-15, -5, 5, 15].map((d) => (
                  <button key={d} className="chip-btn" onClick={() => engine.tiltFrom(focused, d)}>
                    {d > 0 ? `+${d}` : d}°
                  </button>
                ))}
              </div>
            </>
          ) : (
            <p className="faint">Select an axial, coronal or sagittal view first; the other planes turn around its axis.</p>
          )}
          <p className="faint" style={{ marginTop: 6 }}>You can also drag the round handle near the end of a crosshair line.</p>
          <button className="btn sm" style={{ marginTop: 6, alignSelf: 'flex-start' }} onClick={() => engine.straighten()}>
            Straighten all planes
          </button>
    </>
  );
}
