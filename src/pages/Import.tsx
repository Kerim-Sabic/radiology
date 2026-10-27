import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { FolderOpen, FileArchive, Files } from 'lucide-react';
import { useApp } from '../app/AppContext';
import { expandZip, importLocalFiles, type ImportProgress } from '../services/localImport';

export default function ImportPage() {
  const { catalog } = useApp();
  const navigate = useNavigate();
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ctrl = useRef<AbortController | null>(null);
  const supportsFolder = 'webkitdirectory' in document.createElement('input');

  const run = async (files: File[]) => {
    if (!catalog || !files.length) return;
    setError(null);
    ctrl.current = new AbortController();
    try {
      let list = files;
      const zips = files.filter((f) => /\.zip$/i.test(f.name));
      if (zips.length) {
        list = files.filter((f) => !/\.zip$/i.test(f.name));
        for (const z of zips) list = list.concat(await expandZip(z, ctrl.current.signal, setProgress));
      }
      const r = await importLocalFiles(list, ctrl.current.signal, setProgress, new Set(catalog.series.keys()));
      catalog.addLocalPack(r.manifest, r.lessons, r.imageIds);
      navigate(`/read/${r.caseId}?mode=practice`);
    } catch (e) {
      setError((e as Error).name === 'AbortError' ? 'Import cancelled.' : (e as Error).message);
      setProgress(null);
    }
  };

  return (
    <div className="page-inner stack" style={{ gap: 16, maxWidth: 820 }}>
      <h1>Open your own DICOM</h1>
      <p className="muted">
        Files are read in this browser and never uploaded. Series are grouped by study, series and orientation, then ordered by slice position (not by file name). Imported
        studies last for this browser session and have no answer key — they open for free reading with self-review.
      </p>
      <div
        className="card stack"
        style={{ alignItems: 'center', padding: 32, borderStyle: 'dashed' }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (catalog) void run([...e.dataTransfer.files]);
        }}
      >
        <p>{catalog ? 'Drop DICOM files or a ZIP here, or choose:' : 'Preparing the case catalogue…'}</p>
        <div className="row wrap" style={{ justifyContent: 'center' }}>
          {supportsFolder ? (
            <label className="btn">
              <FolderOpen size={15} /> Folder
              <input type="file" hidden multiple disabled={!catalog} {...({ webkitdirectory: '' } as Record<string, string>)} onChange={(e) => run([...(e.target.files ?? [])])} />
            </label>
          ) : null}
          <label className="btn">
            <Files size={15} /> Files
            <input type="file" hidden multiple disabled={!catalog} data-testid="import-files" onChange={(e) => run([...(e.target.files ?? [])])} />
          </label>
          <label className="btn">
            <FileArchive size={15} /> ZIP
            <input type="file" hidden accept=".zip,application/zip" disabled={!catalog} onChange={(e) => run([...(e.target.files ?? [])])} />
          </label>
        </div>
        {!supportsFolder ? <small className="faint">This browser cannot pick folders — select all files instead.</small> : null}
      </div>
      {progress && progress.phase !== 'done' ? (
        <div className="card stack">
          <div>
            {progress.phase === 'unzipping' ? 'Expanding ZIP…' : `Reading ${progress.done} of ${progress.total} files`} {progress.skipped ? `· ${progress.skipped} non-DICOM skipped` : ''}
          </div>
          <div className="progress-bar">
            <span style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
          </div>
          <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => ctrl.current?.abort()}>
            Cancel
          </button>
        </div>
      ) : null}
      {error ? <div className="notice bad">{error}</div> : null}
    </div>
  );
}
