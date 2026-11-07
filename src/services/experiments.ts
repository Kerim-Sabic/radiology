/**
 * A tiny experiment layer (docs/TRACKING.md, "Experiments"). A visitor's arm is a stable hash of their random visitor
 * id and the experiment's id, so they see the same arm on every visit; the first time an arm is used in a tab session,
 * an `exposure` event is logged. Each experiment is written down, with its sample size and stop rule, before it starts,
 * and stays `active: false` until Kerim says yes (anything touching ads, prices or sign-in needs his yes).
 */
import { ev } from './ev';

export interface Experiment {
  arms: readonly string[];
  active: boolean;
  /** What is compared, the metric that decides, the visitors needed per arm, and when to stop. Written before starting. */
  plan: string;
}

export const EXPERIMENTS = {
  landing_mode: {
    arms: ['learn', 'practice'],
    active: false,
    plan: 'Guests from an ad: Learn (outline shown) vs Practice (outline hidden) on the landing case. Metric: answered ÷ saw the image. 130 visitors per arm reads 24 % → 40 % (80 % power). Stop at 150 per arm, or after 14 days.',
  },
  start_free_copy: {
    arms: ['save_it', 'keep_score'],
    active: false,
    plan: 'The first button after a guest’s grade: "Save it: free account" vs "Keep your score: free account". Metric: Start free ÷ grade seen. ~100 grades per arm reads 25 % → 45 %. Stop at 120 per arm.',
  },
  google_signin: {
    arms: ['email', 'google'],
    active: false,
    plan: 'Sign-up with email only vs email + Google (needs the Clerk setting). Metric: account ÷ Start free. ~95 Start free clicks per arm reads 30 % → 50 %. Stop at 110 per arm.',
  },
  plans_inr: {
    arms: ['usd', 'usd_inr'],
    active: false,
    plan: 'Plans for India: $ only vs $ with "about ₹…" beside it. Metric: pressed a plan ÷ saw the plans. ~60 plan views per arm reads 5 % → 20 %. Stop at 80 per arm.',
  },
} as const satisfies Record<string, Experiment>;

export type ExperimentId = keyof typeof EXPERIMENTS;

/** A stable number in [0, 1) from a string (FNV-1a). */
export function unitHash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0) / 2 ** 32;
}

/** The arm a visitor is in (pure; for tests). */
export function armFor(vid: string, id: string, arms: readonly string[]): string {
  return arms[Math.floor(unitHash(`${id}:${vid}`) * arms.length)];
}

/** This visitor's arm, or null when the experiment isn't running (callers then show the current design). */
export function arm(id: ExperimentId): string | null {
  const x: Experiment = EXPERIMENTS[id];
  if (!x.active) return null;
  let vid = 'anon';
  try {
    vid = (localStorage.getItem('rvm.vid') ?? 'anon').split('.')[0];
  } catch {
    /* storage blocked: everyone is one visitor */
  }
  const a = armFor(vid, id, x.arms);
  if (!exposed.has(id)) {
    exposed.add(id);
    ev('exposure', { exp: id, arm: a });
  }
  return a;
}
const exposed = new Set<string>();
