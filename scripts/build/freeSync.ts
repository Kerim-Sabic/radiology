/** Rewrite server/freeEdition.generated.ts from src/content/weekly.ts and public/packs (run: npm run free:sync). */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { computeFreeEdition, serverModule } from './freeEdition';
import { FREE_CASES, WEEKLY_CASES, WEEKLY_EPOCH } from '../../src/content/weekly';

const root = resolve(import.meta.dirname, '../..');
const { data } = computeFreeEdition(resolve(root, 'public/packs'), { epoch: WEEKLY_EPOCH, always: FREE_CASES, weekly: WEEKLY_CASES });
writeFileSync(resolve(root, 'server/freeEdition.generated.ts'), serverModule(data));
const files = Object.values(data.cases).reduce((n, c) => n + c.files.length + c.prefixes.length, 0);
console.log(`Free edition: ${data.always.length} sample patients, ${data.weekly.length} weekly cases, ${files} allowed paths.`);
