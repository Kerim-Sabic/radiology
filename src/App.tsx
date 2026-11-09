import { lazy, Suspense, useEffect, useState, useRef } from 'react';
import { Link, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router';
import { evPage } from './services/ev';
import { pendingJoinCode } from './auth/joinCode';
import { DropdownMenu, Tooltip } from 'radix-ui';
import { Award, BookOpen, Bone, ChartColumn, ChevronDown, FolderOpen, GraduationCap, House, LayoutGrid, Library, Lock, Search, NotebookPen, Ruler, Siren, Stethoscope, Target } from 'lucide-react';
import { HomePage } from './pages/Home';
import { LibraryPage } from './pages/Library';
import { AccountMenu } from './auth/AccountGate';
import { CommandPalette } from './components/CommandPalette';
import { FreeBanner, LockedFeature } from './components/Upgrade';
import { ScanLoader } from './components/ScanState';
import { RoomPreview } from './components/RoomPreview';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useApp } from './app/AppContext';
import { useAccount } from './auth/AccountGate';

const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

const Workstation = lazy(() => import('./pages/Workstation'));
const CoursePage = lazy(() => import('./pages/Course'));
const ProgressPage = lazy(() => import('./pages/Progress'));
const SettingsPage = lazy(() => import('./pages/Settings'));
const ImportPage = lazy(() => import('./pages/Import'));
const AuthorPage = lazy(() => import('./pages/Author'));
const GuidePage = lazy(() => import('./pages/Guide'));
const BookReader = lazy(() => import('./pages/BookReader'));
const BookFigures = lazy(() => import('./pages/BookFigures'));
const AtlasPage = lazy(() => import('./pages/Atlas'));
const DrillPage = lazy(() => import('./pages/Drill'));
const ConditionsPage = lazy(() => import('./pages/Conditions'));
const OnCallPage = lazy(() => import('./pages/OnCall'));
const AdminPage = lazy(() => import('./pages/Admin'));
const ClassPage = lazy(() => import('./pages/Class'));
const JoinPage = lazy(() => import('./pages/Join'));
const CertificatesPage = lazy(() => import('./pages/Certificates'));
const ExamResultPage = lazy(() => import('./pages/ExamResult'));
const MeasurePage = lazy(() => import('./pages/Measure'));

/** Members-only areas: a free account sees what each one is, and the plans. */
const LOCKED: Record<string, { icon: React.ReactNode; title: string; text: string; points: string[] }> = {
  '/drill': {
    icon: <Target />,
    title: 'Drills that remember',
    text: 'Point to a structure or a finding on a patient you have not seen, then name it. What you miss comes back later, on a different patient, until you know it.',
    points: ['Anatomy and findings, on every patient', 'Spaced repetition: back after 1, 3, 7, 16 and 35 days', 'Pick a region, or review what is due'],
  },
  '/measure': {
    icon: <Ruler />,
    title: 'Measure on real films',
    text: 'Measure the heart–chest ratio on real chest X-rays: tap the heart’s edges and the inside of the chest, then see your ratio against a reference outline.',
    points: ['Guided taps, on a phone or a computer', 'Your ratio, the normal range and where you went wrong', 'More measurements on the way'],
  },
  '/oncall': {
    icon: <Siren />,
    title: 'On-call shifts',
    text: 'A run of unknown patients with an optional clock, read with no titles and no hints, and a scored report at the end.',
    points: ['Unknown patients across every modality', 'Write your impression, then see how you did', 'A timer to build speed for exams'],
  },
  '/atlas': {
    icon: <Bone />,
    title: 'Anatomy atlas',
    text: 'Every labelled structure on every patient. Pick a rib, a lobe or a vessel and see it alone on a real scan.',
    points: ['Hundreds of structures on CT, X-ray and MRI', 'The book’s anatomy checklist, chapter by chapter', 'Drill any structure on other patients'],
  },
  '/book': {
    icon: <BookOpen />,
    title: 'The book, page by page',
    text: 'Read Learning Radiology beside your scans: every task opens the page and the figure that explain it, then brings you back.',
    points: ['Open your own copy: it stays on your device', 'Included for SSST students signed in with their university email', 'Search the text and browse the figures'],
  },
};
const lockedArea = (path: string) => Object.keys(LOCKED).find((k) => path === k || path.startsWith(`${k}/`)) ?? null;
/** A free account the server serves the book to (named accounts) reads it; everything else stays locked. */
const lockedFor = (path: string, book: boolean) => {
  const area = lockedArea(path);
  return area === '/book' && book ? null : area;
};

function TopNav({ onSearch }: { onSearch: () => void }) {
  const { free } = useApp();
  const account = useAccount()?.account;
  const book = account?.book === true;
  const { pathname } = useLocation();
  const on = (to: string) => (to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(`${to}/`));
  const lock = (to: string) => (free && lockedFor(to, book) ? <Lock size={11} className="nav-lock" aria-label="members" /> : null);
  // The main sections, named in the top bar on a computer; on a phone the tab bar holds the first four (with their icons).
  const main = [
    { to: '/', label: 'Today', icon: <House size={16} /> },
    { to: '/cases', label: 'Cases', icon: <Library size={16} /> },
    { to: '/conditions', label: 'Conditions', icon: <Stethoscope size={16} /> },
    { to: '/atlas', label: 'Atlas', icon: <Bone size={16} /> },
    { to: '/course', label: 'Course', icon: <GraduationCap size={16} /> },
    { to: '/progress', label: 'Progress', icon: <ChartColumn size={16} /> },
    { to: '/certificates', label: 'Certificates', icon: <Award size={16} /> },
  ];
  // Study tools, under More (Settings, the guide, the class and admin pages are in the account menu).
  const tools = [
    { to: '/drill', label: 'Drills', hint: 'Point and name', icon: <Target size={16} /> },
    { to: '/oncall', label: 'On call', hint: 'Timed unknown cases', icon: <Siren size={16} /> },
    { to: '/measure', label: 'Measure', hint: 'Heart–chest ratio on X-rays', icon: <Ruler size={16} /> },
    { to: '/book', label: 'Book', hint: 'Read beside your scans', icon: <BookOpen size={16} /> },
    { to: '/import', label: 'Import', hint: 'Your own studies', icon: <FolderOpen size={16} /> },
    { to: '/author', label: 'Author', hint: 'Write your own cases', icon: <NotebookPen size={16} /> },
  ];
  const tabs = main.slice(0, 4);
  // On a phone, More also holds the main sections the tab bar has no room for.
  const PHONE_HINT: Record<string, string> = { '/course': 'The book, chapter by chapter', '/progress': 'What you have read and learned', '/certificates': 'Exams and your certificates' };
  const phoneOnly = main.slice(4).map((l) => ({ ...l, hint: PHONE_HINT[l.to] ?? '' }));
  const moreItems = (phone: boolean) => (
    <>
      {phone
        ? phoneOnly.map((l) => (
            <DropdownMenu.Item key={l.to} asChild>
              <Link to={l.to} className={`nav-menu-item${on(l.to) ? ' active' : ''}`}>
                {l.icon}
                <span className="nav-menu-text"><b>{l.label}</b><small>{l.hint}</small></span>
              </Link>
            </DropdownMenu.Item>
          ))
        : null}
      {phone ? <DropdownMenu.Separator className="nav-sep" /> : null}
      {tools.map((l) => (
        <DropdownMenu.Item key={l.to} asChild>
          <Link to={l.to} className={`nav-menu-item${on(l.to) ? ' active' : ''}`}>
            {l.icon}
            <span className="nav-menu-text"><b>{l.label}</b><small>{l.hint}</small></span>
            {lock(l.to)}
          </Link>
        </DropdownMenu.Item>
      ))}
    </>
  );
  const toolsActive = tools.some((l) => on(l.to));
  return (
    <>
      <nav className="topnav" aria-label="Main">
        <NavLink to="/" className="brand" aria-label="Radiology Monster home">
          <img className="brand-mark" src="/logo-mark.svg" alt="" width={22} height={23} />
          <span className="brand-name">Radiology Monster</span>
        </NavLink>
        <div className="nav-main">
          {main.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.to === '/'} className={({ isActive }) => `navlink${isActive ? ' active' : ''}`}>
              <span>{l.label}</span>
              {lock(l.to)}
            </NavLink>
          ))}
          <DropdownMenu.Root modal={false}>
            <DropdownMenu.Trigger asChild>
              <button className={`navlink nav-more${toolsActive ? ' active' : ''}`} aria-label="More sections">
                <span>More</span>
                <ChevronDown size={14} aria-hidden className="nav-more-chevron" />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content className="nav-menu" align="start" sideOffset={8}>
                {moreItems(false)}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
        <span className="spacer" />
        <button className="nav-search" onClick={onSearch} aria-label="Search (Ctrl K)" title="Search pages, conditions, chapters and cases">
          <Search size={15} aria-hidden />
          <span className="nav-search-text">
            <span className="nav-search-long">Search cases, conditions, chapters…</span>
            <span className="nav-search-short">Search…</span>
          </span>
          <kbd>{MAC ? '⌘K' : 'Ctrl K'}</kbd>
        </button>
        <AccountMenu />
      </nav>
      <nav className="tabbar" aria-label="Sections">
        {tabs.map((l) => (
          <NavLink key={l.to} to={l.to} end={l.to === '/'} className={({ isActive }) => `tab${isActive ? ' active' : ''}`}>
            {l.icon}
            <span>{l.label}</span>
            {lock(l.to)}
          </NavLink>
        ))}
        <DropdownMenu.Root modal={false}>
          <DropdownMenu.Trigger asChild>
            <button className={`tab${toolsActive || phoneOnly.some((l) => on(l.to)) ? ' active' : ''}`} aria-label="More sections">
              <LayoutGrid size={16} aria-hidden />
              <span>More</span>
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className="nav-menu nav-menu-sheet" side="top" align="end" sideOffset={8} collisionPadding={8}>
              {moreItems(true)}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </nav>
    </>
  );
}

/** A page's code is on its way: the reading-room loader, sized to the page area. */
function Loading() {
  return <ScanLoader label="Loading…" compact />;
}

const SITE_TITLE = 'Radiology Monster · Real radiology cases for medical students';
/** Page titles for browser tabs and search results (pages with their own subject, e.g. a condition, refine it). */
const PAGE_TITLES: Array<[RegExp, string]> = [
  [/^\/cases/, 'Cases'],
  [/^\/atlas/, 'Anatomy atlas'],
  [/^\/drill/, 'Drills'],
  [/^\/oncall/, 'On call'],
  [/^\/measure/, 'Measure'],
  [/^\/course/, 'Course'],
  [/^\/book/, 'Book'],
  [/^\/progress/, 'Progress'],
  [/^\/certificates/, 'Certificates'],
  [/^\/import/, 'Import'],
  [/^\/author/, 'Author'],
  [/^\/settings/, 'Settings'],
  [/^\/guide/, 'Guide'],
  [/^\/read\//, 'Reading'],
  [/^\/join\//, 'Join a class'],
  [/^\/class/, 'My class'],
];

export function App() {
  // The arrival is the log's `land`; later route changes are `page` events.
  const evPathRef = useRef<string | null>(null);
  const loc = useLocation();
  const navigate = useNavigate();
  // Signed up from a class join link: go back to its invitation once.
  useEffect(() => {
    const code = pendingJoinCode();
    if (code && !loc.pathname.startsWith('/join/')) navigate(`/join/${code}`, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (evPathRef.current !== null && evPathRef.current !== loc.pathname) evPage(loc.pathname);
    evPathRef.current = loc.pathname;
    if (loc.pathname.startsWith('/conditions')) return; // titled by the condition shown
    const t = PAGE_TITLES.find(([re]) => re.test(loc.pathname))?.[1];
    document.title = t ? `${t} · Radiology Monster` : SITE_TITLE;
  }, [loc.pathname]);
  const [searching, setSearching] = useState(false);
  // Ctrl/⌘ K opens quick search on every page, the reading room included (caught before the page's own keys).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        e.stopPropagation();
        setSearching((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  const { free } = useApp();
  const bookAccount = useAccount()?.account.book === true;
  const locked = free ? lockedFor(loc.pathname, bookAccount) : null;
  const reading = loc.pathname.startsWith('/read');
  const fullHeight = reading || loc.pathname === '/drill' || /^\/book(\/\d+)?$/.test(loc.pathname);
  return (
    <Tooltip.Provider>
      <div className={`shell${reading ? '' : ' with-tabbar'}`}>
        {reading ? null : <TopNav onSearch={() => setSearching(true)} />}
        {reading ? null : <FreeBanner />}
        <CommandPalette open={searching} onClose={() => setSearching(false)} />
        <main className="page" style={fullHeight ? { overflow: 'hidden' } : undefined} id="main">
          <ErrorBoundary resetKey={loc.pathname}>
          <Suspense fallback={<Loading />}>
            {locked ? <LockedFeature {...LOCKED[locked]} /> : (
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/cases" element={<LibraryPage />} />
              <Route path="/conditions" element={<ConditionsPage />} />
              <Route path="/atlas" element={<AtlasPage />} />
              <Route path="/drill" element={<DrillPage />} />
              <Route path="/oncall" element={<OnCallPage />} />
              <Route path="/measure" element={<Suspense fallback={<div className="vp-status">Loading…</div>}><MeasurePage /></Suspense>} />
              <Route path="/read/:caseId" element={<Suspense fallback={<RoomPreview />}><Workstation /></Suspense>} />
              <Route path="/book" element={<BookReader />} />
              <Route path="/book/figures" element={<BookFigures />} />
              <Route path="/book/:physical" element={<BookReader />} />
              <Route path="/course" element={<CoursePage />} />
              <Route path="/course/:unitId" element={<CoursePage />} />
              <Route path="/progress" element={<ProgressPage />} />
              <Route path="/certificates" element={<CertificatesPage />} />
              <Route path="/certificates/exam/:id" element={<ExamResultPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/import" element={<ImportPage />} />
              <Route path="/author" element={<AuthorPage />} />
              <Route path="/guide" element={<GuidePage />} />
              <Route path="/admin" element={<AdminPage />} />
              <Route path="/class" element={<ClassPage />} />
              <Route path="/join/:code" element={<JoinPage />} />
              <Route path="*" element={<NotFound onSearch={() => setSearching(true)} />} />
            </Routes>
            )}
          </Suspense>
          </ErrorBoundary>
        </main>
      </div>
    </Tooltip.Provider>
  );
}

/** A wrong or old address: say so, and offer the places people usually want. */
function NotFound({ onSearch }: { onSearch: () => void }) {
  return (
    <div className="page-inner page-problem">
      <h1>This page does not exist</h1>
      <p className="muted">The link may be old or mistyped. Here is where most people want to go.</p>
      <div className="row wrap">
        <Link className="btn primary lg" to="/">
          <House size={16} /> Today
        </Link>
        <Link className="btn lg" to="/cases">
          <Library size={16} /> Cases
        </Link>
        <Link className="btn lg" to="/conditions">
          <Stethoscope size={16} /> Conditions
        </Link>
        <button className="btn lg" onClick={onSearch}>
          <Search size={16} /> Search <span className="kbd-hint">{MAC ? '⌘' : 'Ctrl'} K</span>
        </button>
      </div>
    </div>
  );
}
