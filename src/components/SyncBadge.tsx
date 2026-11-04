import { useSyncExternalStore } from 'react';
import { CloudAlert, CloudCheck, CloudOff, LoaderCircle } from 'lucide-react';
import { useApp } from '../app/AppContext';
import type { SyncSnapshot } from '../services/progressSync';

const SHOWN = {
  saved: { label: 'Saved', icon: CloudCheck, title: 'Your submitted answers are saved to your account.' },
  saving: { label: 'Saving…', icon: LoaderCircle, title: 'Saving your answers to your account…' },
  offline: { label: 'Offline', icon: CloudOff, title: 'Offline. Your answers are kept on this device and saved to your account when you are back online.' },
  failed: { label: 'Sync failed', icon: CloudAlert, title: 'Not saved to your account yet. Your answers are kept on this device; trying again.' },
} as const;

/** The signed-in learner's save state, in words: Saved, Saving…, Offline or Sync failed (nothing without an account). */
export function SyncBadge() {
  const { sync } = useApp();
  const snap: SyncSnapshot = useSyncExternalStore(sync.subscribe, sync.getSnapshot);
  if (snap.status === 'off') return null;
  const s = SHOWN[snap.status];
  const Icon = s.icon;
  const title = snap.status === 'failed' && snap.message ? `${s.title} ${snap.message}` : snap.pending && snap.status !== 'saved' ? `${s.title} ${snap.pending} waiting.` : s.title;
  return (
    <span className={`sync-badge ${snap.status}`} role="status" aria-live="polite" title={title} data-testid="sync-status">
      <Icon size={14} aria-hidden className={snap.status === 'saving' ? 'spin' : undefined} />
      <span className="sync-badge-text">{s.label}</span>
    </span>
  );
}
