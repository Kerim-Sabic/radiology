import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { useApp } from '../app/AppContext';
import { FREE_CASES } from '../content/weekly';
import { FREE_TASK_TEXT } from '../content/freeTasks.generated';
import { ScanLoader } from './ScanState';

/**
 * A free task's first picture (scripts/build/posters.py): exactly the slice and window the viewer opens at, ~10–15 KB.
 * Only the always-free cases have one; null for any other case, so members' cases never ask for a missing file.
 */
export function posterUrl(caseId: string | undefined, taskId: string | null | undefined): string | null {
  if (!caseId || !taskId || !FREE_CASES.includes(caseId) || !taskId.startsWith(`${caseId}:`)) return null;
  return `/landing/posters/${encodeURIComponent(taskId.replace(/:/g, '--'))}.webp`;
}

/**
 * Shown while the reading room's code downloads (on a slow phone connection ~10 s): the task's question and, for a free
 * case, its first picture, so the visitor from an ad reads the question and sees the scan at once instead of a loader.
 * Assess mode keeps the task's title hidden, as the reading room does.
 */
export function RoomPreview() {
  const { caseId } = useParams();
  const [sp] = useSearchParams();
  const taskId = sp.get('task');
  const { catalog, guest } = useApp();
  const task = taskId ? catalog?.tasks.get(taskId) : undefined;
  // The poster is where a visitor without an account opens (at the task's structure); an account opens a task with a
  // structure at its start slice instead, so it gets the poster only for tasks without one.
  const opensAtStructure = guest && (sp.get('mode') === 'learn' || sp.get('mode') === 'practice');
  const poster = opensAtStructure || (task && task.targets.length === 0) ? posterUrl(caseId, taskId) : null;
  const [posterOk, setPosterOk] = useState(true);
  if (!poster || !posterOk) return <ScanLoader label="Opening the reading room…" compact />;
  // The question comes with the app, not with the catalogue: on a slow phone the catalogue arrives after the picture,
  // and a picture with no question gave the visitor from an ad nothing to do (Nov 7–8: 1 mark from 34 visitors).
  const text = task ? { title: task.title, prompt: task.prompt, tap: null } : taskId ? FREE_TASK_TEXT[taskId] : undefined;
  const tap = taskId && opensAtStructure ? FREE_TASK_TEXT[taskId]?.tap : null;
  return (
    <div className="room-preview" role="status" aria-live="polite" aria-label="Opening the case">
      <div className="room-preview-image">
        <img src={poster} alt="" onError={() => setPosterOk(false)} />
        <span className="room-preview-chip">{tap ? `Loading the scan · then ${tap[0].toLowerCase()}${tap.slice(1)}` : 'Opening the viewer…'}</span>
      </div>
      <div className="room-preview-task">
        {text && sp.get('mode') !== 'assess' ? (
          <>
            <h1>{text.title}</h1>
            <p>{text.prompt}</p>
          </>
        ) : (
          <p className="faint">Opening the case…</p>
        )}
      </div>
    </div>
  );
}
