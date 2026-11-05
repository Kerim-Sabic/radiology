import { db } from './store.js';

/** Remember when an account first signed in (for the admin numbers); never fails a sign-in. True on the very first one. */
export async function markJoined(userId: string): Promise<boolean> {
  try {
    const first = (await db().set(`rvm:once:signup:${userId}`, new Date().toISOString().slice(0, 10), { nx: true })) === 'OK';
    await db().sadd('rvm:users', userId);
    return first;
  } catch {
    /* metrics are best effort */
    return false;
  }
}
