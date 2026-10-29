import { db } from './store.js';

/** Remember when an account first signed in (for the admin numbers); never fails a sign-in. */
export async function markJoined(userId: string) {
  try {
    await db().set(`rvm:once:signup:${userId}`, new Date().toISOString().slice(0, 10), { nx: true });
    await db().sadd('rvm:users', userId);
  } catch {
    /* metrics are best effort */
  }
}
