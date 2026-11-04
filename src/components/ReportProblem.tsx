import { useState, type FormEvent } from 'react';
import { Dialog } from 'radix-ui';
import { Flag } from 'lucide-react';
import { MAX_REPORT_TEXT, REPORT_KINDS, sendReport, type ReportInput, type ReportKind } from '../services/reports';

interface Props {
  /** The case, task, mode and slice at the moment of sending. */
  context: () => Omit<ReportInput, 'kind' | 'text'>;
  onSent: (message: string) => void;
}

/** A quiet link under the task that opens a short form: what looks wrong, and optionally a few words. */
export function ReportProblem({ context, onSent }: Props) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<ReportKind | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const reset = () => {
    setKind(null);
    setText('');
    setError('');
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!kind) return setError('Choose what looks wrong.');
    if (kind === 'other' && text.trim().length < 3) return setError('Please say in a few words what looks wrong.');
    setBusy(true);
    setError('');
    const r = await sendReport({ ...context(), kind, text: text.trim() });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setOpen(false);
    reset();
    onSent('Thank you. Your report was sent with this case and slice.');
  };
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <Dialog.Trigger asChild>
        <button type="button" className="report-link">
          <Flag size={13} aria-hidden />
          Report a problem with this case
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog report-dialog">
          <Dialog.Title asChild>
            <h2>Report a problem with this case</h2>
          </Dialog.Title>
          <Dialog.Description className="muted">
            It is sent with this case, the task, the slice you are on and your account email, so we can check it and write back.
          </Dialog.Description>
          <form className="stack" style={{ gap: 14, marginTop: 14 }} onSubmit={submit}>
            <fieldset className="report-kinds">
              <legend className="sr-only">What looks wrong?</legend>
              {REPORT_KINDS.map(([k, label]) => (
                <label key={k} className="report-kind">
                  <input type="radio" name="report-kind" value={k} checked={kind === k} onChange={() => setKind(k)} />
                  <span>{label}</span>
                </label>
              ))}
            </fieldset>
            <label className="stack" style={{ gap: 6 }}>
              <span>{kind === 'other' ? 'What looks wrong?' : 'Details, if you like'}</span>
              <textarea
                rows={4}
                maxLength={MAX_REPORT_TEXT}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="For example: on slice 42 the outline covers the liver, not the lesion."
              />
            </label>
            {error ? (
              <div className="notice bad" role="alert">
                {error}
              </div>
            ) : null}
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <Dialog.Close asChild>
                <button type="button" className="btn">
                  Cancel
                </button>
              </Dialog.Close>
              <button type="submit" className="btn primary" disabled={busy}>
                {busy ? 'Sending…' : 'Send report'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
