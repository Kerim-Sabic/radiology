import { next } from '@vercel/functions';
import { session } from './server/auth.js';
import { accessFor } from './server/billing.js';
import { readiness } from './server/config.js';
import { json } from './server/handler.js';

// Runs before the CDN cache: direct DICOM and curriculum JSON require paid access too.
export default async function proxy(request: Request) {
  try {
    if (!readiness().billing) return json({ error: 'Access is being configured' }, 503);
    const user = await session(request);
    if (!user) return json({ error: 'Sign in required' }, 401);
    if (!(await accessFor(user.userId)).active) return json({ error: 'Membership required' }, 402);
    return next({ headers: { 'Cache-Control': 'private, no-store', 'CDN-Cache-Control': 'no-store', Vary: 'Cookie' } });
  } catch { return json({ error: 'Unable to verify access' }, 503); }
}
