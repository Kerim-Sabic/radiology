/**
 * RSNA-ICA teaching cases: members only, never in this public repository, at most 100 MR and 100 CT series shown.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { RSNA_SHOW_CAP, rsnaFile, rsnaKey, rsnaMember, shownCounts } from '../server/rsna';
import { RSNA_SHOWN, type ShownSeries } from '../server/rsnaShown';
import { freePathAllowed } from '../server/free';

const SERIES = 'aaaaaaaaaaaaaaaa';
const SHOWN: ShownSeries[] = [{ series: SERIES, modality: 'MR' }];
const SLICE = `https://www.radiology.monster/api/rsna/rsna-ica-phase1/dicom/${SERIES}/0123456789abcdef.dcm`;

function bytes() {
  return new ReadableStream<Uint8Array>({ start: (c) => (c.enqueue(new Uint8Array([1, 2, 3])), c.close()) });
}

describe('RSNA-ICA files', () => {
  it('a visitor without an account gets 401 and a free account 402, before storage is touched', async () => {
    const read = vi.fn(async () => bytes());
    process.env.BLOB_READ_WRITE_TOKEN = 'test-token';
    expect((await rsnaFile(new Request(SLICE), 'signed-out', read, SHOWN)).status).toBe(401);
    expect((await rsnaFile(new Request(SLICE), 'signed-in', read, SHOWN)).status).toBe(402);
    expect(read).not.toHaveBeenCalled();
  });

  it('a member gets the file, privately: never kept by the CDN', async () => {
    process.env.BLOB_READ_WRITE_TOKEN = 'test-token';
    const read = vi.fn(async () => bytes());
    const r = await rsnaFile(new Request(SLICE), 'member', read, SHOWN);
    expect(r.status).toBe(200);
    expect(read).toHaveBeenCalledWith(`rsna-ica/rsna-ica-phase1/dicom/${SERIES}/0123456789abcdef.dcm`, 'test-token', expect.anything());
    expect(r.headers.get('Cache-Control')).toMatch(/^private/);
    expect(r.headers.get('CDN-Cache-Control')).toBe('no-store');
    expect(r.headers.get('Vary')).toBe('Cookie');
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('serves only slices of series on the shown list, and only well-formed names', async () => {
    process.env.BLOB_READ_WRITE_TOKEN = 'test-token';
    const read = vi.fn(async () => bytes());
    const other = SLICE.replace(SERIES, 'bbbbbbbbbbbbbbbb');
    expect((await rsnaFile(new Request(other), 'member', read, SHOWN)).status).toBe(404);
    for (const bad of [
      '/api/rsna/rsna-ica-phase1/../../textbooks/learning-radiology-5e.pdf',
      '/api/rsna/rsna-ica-phase1/dicom/AAAAAAAAAAAAAAAA/0123456789abcdef.dcm',
      '/api/rsna/other-pack/pack.json',
      '/api/rsna/rsna-ica-phase1/train.csv',
      '/api/rsna/rsna-ica-phase1/%2e%2e/pack.json',
    ])
      expect(rsnaKey(bad, SHOWN), bad).toBeNull();
    expect(rsnaKey('/api/rsna/rsna-ica-phase1/pack.json', SHOWN)).toBe('rsna-ica/rsna-ica-phase1/pack.json');
    expect(read).not.toHaveBeenCalled();
  });

  it('says so when private storage is not set up, instead of failing', async () => {
    delete process.env.BLOB_READ_WRITE_TOKEN;
    expect((await rsnaFile(new Request(SLICE), 'member', vi.fn(), SHOWN)).status).toBe(503);
  });

  it('keeps only a yes about membership, for a minute', async () => {
    const active = vi.fn(async () => true);
    expect(await rsnaMember('u1', active, 1000)).toBe(true);
    expect(await rsnaMember('u1', active, 30_000)).toBe(true);
    expect(active).toHaveBeenCalledTimes(1);
    expect(await rsnaMember('u1', async () => false, 70_000)).toBe(false);
    expect(await rsnaMember('u2', async () => false, 1000)).toBe(false);
  });

  it('is never part of the free edition or the guest paths', () => {
    for (const p of ['/api/rsna/rsna-ica-phase1/pack.json', '/packs/rsna-ica-phase1/pack.json', `/packs/rsna-ica-phase1/dicom/${SERIES}/0123456789abcdef.dcm`])
      expect(freePathAllowed(p), p).toBe(false);
  });
});

describe("RSNA's permission", () => {
  it('shows at most 100 MR and 100 CT series, each listed once by an opaque hash', () => {
    const counts = shownCounts(RSNA_SHOWN);
    expect(counts.MR).toBeLessThanOrEqual(RSNA_SHOW_CAP.MR);
    expect(counts.CT).toBeLessThanOrEqual(RSNA_SHOW_CAP.CT);
    expect(RSNA_SHOW_CAP).toEqual({ MR: 100, CT: 100 });
    expect(new Set(RSNA_SHOWN.map((s) => s.series)).size).toBe(RSNA_SHOWN.length);
    for (const s of RSNA_SHOWN) expect(s.series).toMatch(/^[0-9a-f]{16}$/);
    // The check itself fails at 101.
    const many = (n: number, modality: 'MR' | 'CT') => Array.from({ length: n }, (_, i) => ({ series: i.toString(16).padStart(16, '0'), modality }));
    expect(shownCounts(many(101, 'CT')).CT).toBeGreaterThan(RSNA_SHOW_CAP.CT);
  });

  it('keeps every RSNA-ICA image and label out of this public repository', () => {
    const files = execSync('git ls-files', { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }).split('\n').filter(Boolean);
    // Nothing RSNA-ICA under the public site folder, and no imaging or label file anywhere with RSNA in its path.
    expect(files.filter((f) => /^public\/.*rsna/i.test(f))).toEqual([]);
    expect(files.filter((f) => /rsna/i.test(f) && /\.(dcm|nii|nii\.gz|nrrd|npy|npz|png|jpe?g|webp|csv|parquet|zip|pth|pt|ckpt)$/i.test(f))).toEqual([]);
    // No copy of the label tables: their header names the 13 locations and "Aneurysm Present".
    const labelHeader = /Left Infraclinoid Internal Carotid Artery,Right Infraclinoid Internal Carotid Artery/;
    const localizerHeader = /SeriesInstanceUID,SOPInstanceUID,coordinates,location/;
    const text = files.filter((f) => /\.(csv|json|txt|tsv|md)$/i.test(f) && !f.startsWith('node_modules/'));
    const leaks = text.filter((f) => {
      const s = readFileSync(f, 'utf8');
      return labelHeader.test(s) || localizerHeader.test(s);
    });
    expect(leaks).toEqual([]);
  });
});
