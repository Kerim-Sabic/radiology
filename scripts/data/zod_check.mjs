// Validate a built pack against the app's zod contract (src/schema/content.ts).
// Usage: node --experimental-strip-types --no-warnings scripts/data/zod_check.mjs public/packs/<packId> [public/packs/index.json]
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { PackManifest, TargetGeometry, PackIndex } from '../../src/schema/content.ts';

const [, , packDir, indexPath] = process.argv;
const out = { pack: packDir, manifest: null, targets: { ok: 0, failed: [] }, index: null };
const fmt = (r) => (r.success ? 'ok' : r.error.issues.slice(0, 8).map((i) => `${i.path.join('.')}: ${i.message}`));
const manifest = JSON.parse(readFileSync(join(packDir, 'pack.json'), 'utf8'));
const m = PackManifest.safeParse(manifest);
out.manifest = fmt(m);
for (const t of manifest.referenceTargets ?? []) {
  const p = join(packDir, t.geometryFile);
  if (!existsSync(p)) { out.targets.failed.push({ id: t.id, error: 'missing file' }); continue; }
  const r = TargetGeometry.safeParse(JSON.parse(readFileSync(p, 'utf8')));
  if (r.success && r.data.geometryType === t.geometryType) out.targets.ok++;
  else out.targets.failed.push({ id: t.id, error: r.success ? 'geometryType mismatch' : fmt(r) });
}
if (indexPath && existsSync(indexPath)) out.index = fmt(PackIndex.safeParse(JSON.parse(readFileSync(indexPath, 'utf8'))));
console.log(JSON.stringify(out));
process.exit(out.manifest === 'ok' && out.targets.failed.length === 0 && (out.index === null || out.index === 'ok') ? 0 : 1);
