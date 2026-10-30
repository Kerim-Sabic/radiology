import { Tooltip } from 'radix-ui';
import { forwardRef, useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Check, CircleQuestionMark, TriangleAlert, X } from 'lucide-react';
import { AI_LABEL } from '../lib/provenance';

export function Tip({ label, shortcut, children, side = 'bottom' }: { label: string; shortcut?: string; children: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  return (
    <Tooltip.Root delayDuration={350}>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="tooltip" side={side} sideOffset={6}>
          {label}
          {shortcut ? <span className="kbd" style={{ marginLeft: 8 }}>{shortcut}</span> : null}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { label: string; shortcut?: string; active?: boolean; tipSide?: 'top' | 'bottom' | 'left' | 'right' };

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({ label, shortcut, active, children, tipSide, ...rest }, ref) {
  return (
    <Tip label={label} shortcut={shortcut} side={tipSide}>
      <button ref={ref} type="button" className={`icon-btn${active ? ' active' : ''}`} aria-label={label} aria-pressed={active === undefined ? undefined : active} {...rest}>
        {children}
      </button>
    </Tip>
  );
});

/** Outcome badge with icon + text (never colour alone). */
export function OutcomeBadge({ outcome }: { outcome: string }) {
  const map: Record<string, { cls: string; icon: ReactNode; text: string }> = {
    correct: { cls: 'ok', icon: <Check size={13} />, text: 'Correct' },
    found: { cls: 'ok', icon: <Check size={13} />, text: 'Found' },
    matched: { cls: 'ok', icon: <Check size={13} />, text: 'Matched' },
    partial: { cls: 'warn', icon: <TriangleAlert size={13} />, text: 'Partly correct' },
    near_miss: { cls: 'warn', icon: <TriangleAlert size={13} />, text: 'Near miss' },
    duplicate: { cls: 'warn', icon: <TriangleAlert size={13} />, text: 'Duplicate' },
    off_level: { cls: 'bad', icon: <X size={13} />, text: 'Wrong level' },
    incorrect: { cls: 'bad', icon: <X size={13} />, text: 'Not correct' },
    missed: { cls: 'bad', icon: <X size={13} />, text: 'Missed' },
    wrong_side: { cls: 'bad', icon: <X size={13} />, text: 'Wrong side' },
    wrong_label: { cls: 'bad', icon: <X size={13} />, text: 'Wrong name' },
    wrong_structure: { cls: 'bad', icon: <X size={13} />, text: 'Wrong structure' },
    false_positive: { cls: 'bad', icon: <X size={13} />, text: 'False positive' },
    unmatched_unscored: { cls: '', icon: <CircleQuestionMark size={13} />, text: 'Unscored' },
    self_review: { cls: 'accent', icon: <CircleQuestionMark size={13} />, text: 'Self-review' },
    not_attempted: { cls: '', icon: <CircleQuestionMark size={13} />, text: 'Not attempted' },
  };
  const m = map[outcome] ?? { cls: '', icon: null, text: outcome };
  return (
    <span className={`chip ${m.cls}`}>
      {m.icon}
      {m.text}
    </span>
  );
}

export function ProvenanceChip({ provenance }: { provenance: string }) {
  const map: Record<string, [string, string]> = {
    source_manual: ['ok', 'Source manual annotation'],
    source_automated: ['warn', 'Source automated label'],
    ai_draft: ['warn', `${AI_LABEL} — unreviewed`],
    human_reviewed: ['accent', 'Reviewed by you'],
  };
  const [cls, text] = map[provenance] ?? ['', provenance];
  return <span className={`chip ${cls}`}>{text}</span>;
}

export function Toast({ message, onDone }: { message: string | null; onDone: () => void }) {
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(onDone, 4200);
    return () => clearTimeout(t);
  }, [message, onDone]);
  if (!message) return null;
  return (
    <div className="toast" role="status" aria-live="polite">
      {message}
    </div>
  );
}

export function useToast() {
  const [msg, setMsg] = useState<string | null>(null);
  return { msg, show: setMsg, clear: () => setMsg(null) };
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="card stack" style={{ alignItems: 'flex-start' }}>
      <h3>{title}</h3>
      {children ? <div className="muted">{children}</div> : null}
    </div>
  );
}
