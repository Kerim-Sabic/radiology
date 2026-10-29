import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { BookOpen, CornerDownLeft, FileText, ScanLine, Search, Stethoscope } from 'lucide-react';
import { useApp } from '../app/AppContext';
import { paletteItems, paletteSearch, type PaletteKind } from '../services/palette';

const ICON: Record<PaletteKind, React.ReactNode> = {
  page: <FileText size={15} />,
  condition: <Stethoscope size={15} />,
  chapter: <BookOpen size={15} />,
  case: <ScanLine size={15} />,
};
const KIND_LABEL: Record<PaletteKind, string> = { page: 'Page', condition: 'Condition', chapter: 'Book', case: 'Case' };

/** Quick search over pages, conditions, chapters and cases. Opens with Ctrl/⌘ K anywhere, or from the top bar. */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { catalog, curriculum } = useApp();
  const navigate = useNavigate();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const items = useMemo(() => paletteItems(catalog, curriculum?.file ?? null), [catalog, curriculum]);
  const results = useMemo(() => paletteSearch(items, query), [items, query]);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) {
      setQuery('');
      setActive(0);
      d.showModal();
      input.current?.focus();
    } else if (!open && d.open) d.close();
  }, [open]);
  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    document.getElementById(`palette-opt-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const go = (i: number) => {
    const r = results[i];
    if (!r) return;
    onClose();
    navigate(r.to);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = results.length;
      if (n) setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : n - 1)) % n);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      go(active);
    }
  };

  return (
    <dialog ref={dialog} className="palette" aria-label="Quick search" onClose={onClose} onClick={(e) => e.target === dialog.current && onClose()}>
      <div className="palette-box">
        <label className="palette-input">
          <Search size={17} aria-hidden="true" />
          <input
            ref={input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder="Search pages, conditions, chapters, cases…"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={results.length ? `palette-opt-${active}` : undefined}
            aria-label="Search"
          />
          <kbd>Esc</kbd>
        </label>
        <ul className="palette-list" id="palette-list" role="listbox" aria-label="Results">
          {results.map((r, i) => (
            <li
              key={r.id}
              id={`palette-opt-${i}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'active' : undefined}
              onMouseMove={() => setActive(i)}
              onClick={() => go(i)}
            >
              <span className={`palette-icon ${r.kind}`}>{ICON[r.kind]}</span>
              <span className="palette-text">
                <b>{r.title}</b>
                {r.sub ? <small>{r.sub}</small> : null}
              </span>
              <span className="palette-kind">{KIND_LABEL[r.kind]}</span>
              {i === active ? <CornerDownLeft size={14} className="palette-enter" aria-hidden="true" /> : null}
            </li>
          ))}
          {!results.length ? <li className="palette-empty">Nothing found for “{query}”.</li> : null}
        </ul>
        <div className="palette-foot">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> to move
          </span>
          <span>
            <kbd>Enter</kbd> to open
          </span>
          <span className="faint">Cases are listed by neutral title only, so search never gives away a diagnosis.</span>
        </div>
      </div>
    </dialog>
  );
}
