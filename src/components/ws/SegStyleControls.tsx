import { useSyncExternalStore } from 'react';
import { RotateCcw } from 'lucide-react';
import { GROUP_ORDER } from '../../viewer/anatomyMask';
import { LINE_WIDTHS, lookOf, segStyle, withAtlasColors, withLookAll, type Look, type SegStyle } from '../../viewer/segStyle';

export const useSegStyle = (): SegStyle => useSyncExternalStore(segStyle.subscribe, segStyle.get);

/**
 * A colour swatch that opens the colour picker. `colors` with several entries (a group whose structures keep their
 * own atlas colours) shows them side by side; picking a colour then gives the whole group that one colour.
 */
export function ColorSwatch(p: { colors: string[]; label: string; onChange: (hex: string) => void; size?: number }) {
  const cs = p.colors.slice(0, 4);
  const bg = cs.length > 1 ? `conic-gradient(${cs.map((c, i) => `${c} ${(i / cs.length) * 360}deg ${((i + 1) / cs.length) * 360}deg`).join(', ')})` : cs[0];
  return (
    <label className="color-swatch" style={{ background: bg, width: p.size ?? 16, height: p.size ?? 16 }} title={p.label}>
      <input type="color" value={cs[0] ?? '#ffffff'} onChange={(e) => p.onChange(e.target.value)} aria-label={p.label} />
    </label>
  );
}

export function LookSwitch(p: { look: Look; label: string; onChange: (l: Look) => void }) {
  return (
    <span className="seg look-switch" role="group" aria-label={`${p.label}: outline or filled`}>
      {(
        [
          ['outline', 'Outline'],
          ['fill', 'Filled'],
        ] as const
      ).map(([l, text]) => (
        <button key={l} className={`btn sm${p.look === l ? ' on' : ''}`} aria-pressed={p.look === l} onClick={() => p.onChange(l)}>
          {text}
        </button>
      ))}
    </span>
  );
}

/** Settings for every group at once: outline or fill all, fill strength, line width, back to the atlas colours. */
export function SegStyleBar() {
  const s = useSegStyle();
  const all = (l: Look) => GROUP_ORDER.every((g) => lookOf(s, g) === l);
  const recoloured = Object.values(s.groups).some((g) => g?.color) || Object.keys(s.structures).length > 0;
  return (
    <div className="segbar" aria-label="How outlines are drawn">
      <span className="seg" role="group" aria-label="Every group">
        <button className={`btn sm${all('outline') ? ' on' : ''}`} aria-pressed={all('outline')} onClick={() => segStyle.update((x) => withLookAll(x, 'outline'))}>
          Outline all
        </button>
        <button className={`btn sm${all('fill') ? ' on' : ''}`} aria-pressed={all('fill')} onClick={() => segStyle.update((x) => withLookAll(x, 'fill'))}>
          Fill all
        </button>
      </span>
      <label className="segbar-range">
        Fill
        <input type="range" min={10} max={80} step={5} value={Math.round(s.fill * 100)} onChange={(e) => segStyle.update((x) => ({ ...x, fill: Number(e.target.value) / 100 }))} aria-label="Fill strength" />
      </label>
      <span className="seg" role="group" aria-label="Line width">
        {LINE_WIDTHS.map(([w, l]) => (
          <button key={w} className={`btn sm${s.line === w ? ' on' : ''}`} aria-pressed={s.line === w} onClick={() => segStyle.update((x) => ({ ...x, line: w }))}>
            {l}
          </button>
        ))}
      </span>
      {recoloured ? (
        <button className="btn sm ghost" onClick={() => segStyle.update(withAtlasColors)} title="Every structure back to its atlas colour">
          <RotateCcw size={12} /> Atlas colours
        </button>
      ) : null}
    </div>
  );
}
