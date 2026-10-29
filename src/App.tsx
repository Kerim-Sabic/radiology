import { lazy, Suspense, useEffect, useState } from 'react';
import { NavLink, Route, Routes, useLocation } from 'react-router';
import { Tooltip } from 'radix-ui';
import { BookOpen, Bone, ChartColumn, FolderOpen, GraduationCap, House, Library, Search, Settings as SettingsIcon, NotebookPen, Siren, Stethoscope, Target } from 'lucide-react';
import { HomePage } from './pages/Home';
import { LibraryPage } from './pages/Library';
import { AccountMenu } from './auth/AccountGate';
import { CommandPalette } from './components/CommandPalette';

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

function TopNav({ onSearch }: { onSearch: () => void }) {
  const links = [
    { to: '/', label: 'Today', icon: <House size={16} /> },
    { to: '/cases', label: 'Cases', icon: <Library size={16} /> },
    { to: '/conditions', label: 'Conditions', icon: <Stethoscope size={16} /> },
    { to: '/atlas', label: 'Atlas', icon: <Bone size={16} /> },
    { to: '/drill', label: 'Drills', icon: <Target size={16} /> },
    { to: '/oncall', label: 'On call', icon: <Siren size={16} /> },
    { to: '/course', label: 'Course', icon: <GraduationCap size={16} /> },
    { to: '/book', label: 'Book', icon: <BookOpen size={16} /> },
    { to: '/progress', label: 'Progress', icon: <ChartColumn size={16} /> },
    { to: '/import', label: 'Import', icon: <FolderOpen size={16} />, minor: true },
    { to: '/author', label: 'Author', icon: <NotebookPen size={16} />, minor: true },
    { to: '/settings', label: 'Settings', icon: <SettingsIcon size={16} />, minor: true },
  ];
  return (
    <nav className="topnav" aria-label="Main">
      <NavLink to="/" className="brand" aria-label="radiology.monster home">
        <img className="brand-mark" src="/logo-mark.svg" alt="" width={21} height={22} />
        <span>
          radiology<span className="brand-tld">.monster</span>
        </span>
      </NavLink>
      {links.map((l) => (
        <NavLink key={l.to} to={l.to} end={l.to === '/'} title={l.label} aria-label={l.label} className={({ isActive }) => `navlink${l.minor ? ' minor' : ''}${isActive ? ' active' : ''}`}>
          {l.icon}
          <span>{l.label}</span>
        </NavLink>
      ))}
      <span className="spacer" />
      <button className="navlink nav-search" onClick={onSearch} aria-label="Search (Ctrl K)" title="Search pages, conditions, chapters and cases">
        <Search size={16} />
        <span>Search</span>
        <kbd>{MAC ? '⌘K' : 'Ctrl K'}</kbd>
      </button>
      <AccountMenu />
      <NavLink to="/guide" className={({ isActive }) => `navlink${isActive ? ' active' : ''}`}>
        <span>Guide</span>
      </NavLink>
    </nav>
  );
}

function Loading() {
  return (
    <div className="vp-status" style={{ position: 'static', height: '100%' }}>
      Loading…
    </div>
  );
}

const SITE_TITLE = 'radiology.monster — Real cases. Deeper understanding.';
/** Page titles for browser tabs and search results (pages with their own subject, e.g. a condition, refine it). */
const PAGE_TITLES: Array<[RegExp, string]> = [
  [/^\/cases/, 'Cases'],
  [/^\/atlas/, 'Anatomy atlas'],
  [/^\/drill/, 'Drills'],
  [/^\/oncall/, 'On call'],
  [/^\/course/, 'Course'],
  [/^\/book/, 'Book'],
  [/^\/progress/, 'Progress'],
  [/^\/import/, 'Import'],
  [/^\/author/, 'Author'],
  [/^\/settings/, 'Settings'],
  [/^\/guide/, 'Guide'],
  [/^\/read\//, 'Reading'],
];

export function App() {
  const loc = useLocation();
  useEffect(() => {
    if (loc.pathname.startsWith('/conditions')) return; // titled by the condition shown
    const t = PAGE_TITLES.find(([re]) => re.test(loc.pathname))?.[1];
    document.title = t ? `${t} · radiology.monster` : SITE_TITLE;
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
  const reading = loc.pathname.startsWith('/read');
  const fullHeight = reading || loc.pathname === '/drill' || /^\/book(\/\d+)?$/.test(loc.pathname);
  return (
    <Tooltip.Provider>
      <div className="shell">
        {reading ? null : <TopNav onSearch={() => setSearching(true)} />}
        <CommandPalette open={searching} onClose={() => setSearching(false)} />
        <main className="page" style={fullHeight ? { overflow: 'hidden' } : undefined} id="main">
          <Suspense fallback={<Loading />}>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/cases" element={<LibraryPage />} />
              <Route path="/conditions" element={<ConditionsPage />} />
              <Route path="/atlas" element={<AtlasPage />} />
              <Route path="/drill" element={<DrillPage />} />
              <Route path="/oncall" element={<OnCallPage />} />
              <Route path="/read/:caseId" element={<Workstation />} />
              <Route path="/book" element={<BookReader />} />
              <Route path="/book/figures" element={<BookFigures />} />
              <Route path="/book/:physical" element={<BookReader />} />
              <Route path="/course" element={<CoursePage />} />
              <Route path="/course/:unitId" element={<CoursePage />} />
              <Route path="/progress" element={<ProgressPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/import" element={<ImportPage />} />
              <Route path="/author" element={<AuthorPage />} />
              <Route path="/guide" element={<GuidePage />} />
              <Route path="*" element={<div className="page-inner"><h1>Not found</h1><p className="muted">This address does not exist. <NavLink to="/">Go to Today</NavLink>.</p></div>} />
            </Routes>
          </Suspense>
        </main>
      </div>
    </Tooltip.Provider>
  );
}
