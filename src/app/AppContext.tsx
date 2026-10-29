import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Catalog } from '../services/caseRepository';
import { ProgressRepository, type Attempt, type TargetReview } from '../services/progressRepository';
import { loadCurriculum, type Curriculum } from '../services/curriculum';
import { preloadBook } from '../book/bookPdf';
import { useAccount } from '../auth/AccountGate';
import { freeCaseIds } from '../content/weekly';
import { dayKey } from '../services/activity';
import { pingStudied } from '../services/serverSync';

export type Level = 'student' | 'resident';

export interface Settings {
  level: Level;
  reviewerName: string;
  examDate: string | null;
  minutesPerDay: number | null;
  showShortcuts: boolean;
  assessTimerMinutes: number | null;
}

const DEFAULT_SETTINGS: Settings = { level: 'student', reviewerName: 'me', examDate: null, minutesPerDay: null, showShortcuts: true, assessTimerMinutes: null };
const SETTINGS_KEY = 'rvm.settings.v1';

function readSettings(): Settings {
  try {
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<Settings>) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

interface AppState {
  catalog: Catalog | null;
  catalogError: string | null;
  curriculum: Curriculum | null;
  progress: ProgressRepository;
  attempts: Attempt[];
  reviews: TargetReview[];
  settings: Settings;
  setSettings: (s: Partial<Settings>) => void;
  reloadCatalog: () => void;
  /** Signed in without a plan: the catalog is the free edition (the sample patients). */
  free: boolean;
  /** Open the plans screen (free accounts; does nothing otherwise). */
  openPlans: () => void;
}

const Ctx = createContext<AppState | null>(null);

const progress = new ProgressRepository();

export function AppProvider({ children }: { children: ReactNode }) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [curriculum, setCurriculum] = useState<Curriculum | null>(null);
  const [settings, setSettingsState] = useState<Settings>(readSettings);
  const [reloadKey, setReloadKey] = useState(0);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [reviews, setReviews] = useState<TargetReview[]>([]);
  const progressVersion = useSyncExternalStore(progress.subscribe, progress.getVersion);
  const account = useAccount();
  const free = !!account?.free;
  const openPlans = account?.openPlans;

  useEffect(() => {
    const ac = new AbortController();
    Catalog.load(ac.signal, free ? 'free' : 'full', free ? freeCaseIds() : undefined)
      .then((c) => {
        if (ac.signal.aborted) return; // a newer load (e.g. after the account changed) replaces this one
        (window as unknown as { __catalog: Catalog }).__catalog = c;
        setCatalog(c);
      })
      .catch((e) => !ac.signal.aborted && setCatalogError(String(e)));
    return () => ac.abort();
  }, [reloadKey, free]);

  useEffect(() => {
    loadCurriculum().then(setCurriculum);
    // Open the book in the background once the app is idle, so the first page appears instantly later.
    const t = setTimeout(preloadBook, 1500);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    progress.attempts().then(setAttempts);
    progress.reviews().then(setReviews);
  }, [progressVersion]);

  // Signed in: tell the server you studied today (an answer or a drill), for streak reminders and retention.
  const signedIn = !!account;
  useEffect(() => {
    if (!signedIn) return;
    const today = dayKey(new Date());
    if (attempts.some((a) => a.submittedAt && dayKey(a.submittedAt) === today)) pingStudied();
    else void progress.activityLog().then((l) => l[today]?.drills && pingStudied());
  }, [signedIn, attempts, progressVersion]);

  const value = useMemo<AppState>(
    () => ({
      catalog,
      catalogError,
      curriculum,
      progress,
      attempts,
      reviews,
      settings,
      setSettings: (s) =>
        setSettingsState((prev) => {
          const next = { ...prev, ...s };
          try {
            localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
          } catch {
            /* storage unavailable — keep in memory */
          }
          return next;
        }),
      reloadCatalog: () => setReloadKey((k) => k + 1),
      free,
      openPlans: openPlans ?? (() => undefined),
    }),
    [catalog, catalogError, curriculum, attempts, reviews, settings, free, openPlans],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside provider');
  return v;
}
