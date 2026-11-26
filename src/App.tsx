import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { readPref, useI18n, writePref, type MessageKey } from './i18n';
import { Empty, Notice, Segmented } from './components/ui';

const Overview = lazy(() => import('./pages/Overview'));
const Explorer = lazy(() => import('./pages/Explorer'));
const StatisticsLab = lazy(() => import('./pages/StatisticsLab'));
const Simulator = lazy(() => import('./pages/Simulator'));
const Inflation = lazy(() => import('./pages/Inflation'));
const Trends = lazy(() => import('./pages/Trends'));
const Methodology = lazy(() => import('./pages/Methodology'));
const Banks = lazy(() => import('./pages/Banks'));
const BankProfile = lazy(() => import('./pages/BankProfile'));
const Compare = lazy(() => import('./pages/Compare'));
const BankIndex = lazy(() => import('./pages/BankIndex'));
const Research = lazy(() => import('./pages/Research'));
const ReportView = lazy(() => import('./pages/ReportView'));
const Assistant = lazy(() => import('./pages/Assistant'));
const Learn = lazy(() => import('./pages/Learn'));
const Account = lazy(() => import('./pages/Account'));
const Admin = lazy(() => import('./pages/Admin'));

interface Page { path: string; label: MessageKey; element: ReactNode }

export const NAV: { group: MessageKey; pages: Page[] }[] = [
  {
    group: 'group_consumer',
    pages: [
      { path: '/explorer', label: 'nav_explorer', element: <Explorer /> },
      { path: '/compare', label: 'nav_compare', element: <Compare /> },
      { path: '/simulator', label: 'nav_simulator', element: <Simulator /> },
      { path: '/inflation', label: 'nav_inflation', element: <Inflation /> },
      { path: '/learn', label: 'nav_learn', element: <Learn /> },
    ],
  },
  {
    group: 'group_intelligence',
    pages: [
      { path: '/', label: 'nav_overview', element: <Overview /> },
      { path: '/banks', label: 'nav_banks', element: <Banks /> },
      { path: '/index', label: 'nav_index', element: <BankIndex /> },
      { path: '/statistics', label: 'nav_stats', element: <StatisticsLab /> },
      { path: '/trends', label: 'nav_trends', element: <Trends /> },
      { path: '/assistant', label: 'nav_assistant', element: <Assistant /> },
    ],
  },
  { group: 'group_research', pages: [{ path: '/research', label: 'nav_research', element: <Research /> }, { path: '/methodology', label: 'nav_methodology', element: <Methodology /> }] },
  { group: 'group_platform', pages: [{ path: '/account', label: 'nav_account', element: <Account /> }, { path: '/admin', label: 'nav_admin', element: <Admin /> }] },
];

export const PAGES = NAV.flatMap((g) => g.pages);

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    return this.state.error ? <Notice tone="warn">{this.state.error.message}</Notice> : this.props.children;
  }
}

export function App() {
  const { t, lang, setLang } = useI18n();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState(() => readPref('theme') ?? (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  // Lets the account page apply a saved preference.
  useEffect(() => {
    const apply = (e: Event) => setTheme((e as CustomEvent<string>).detail);
    window.addEventListener('azfi-theme', apply);
    return () => window.removeEventListener('azfi-theme', apply);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    writePref('theme', theme);
  }, [theme]);
  useEffect(() => {
    setOpen(false);
    const page = PAGES.find((p) => p.path === pathname) ?? PAGES.find((p) => p.path !== '/' && pathname.startsWith(`${p.path}/`));
    document.title = page ? `${t(page.label)} · AZ Finance Intelligence` : 'AZ Finance Intelligence';
  }, [pathname, t]);

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[232px_minmax(0,1fr)]">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-surface focus:p-2">{t('skip')}</a>
      <aside className="bg-[#0c1a30] text-white lg:sticky lg:top-0 lg:h-screen lg:overflow-y-auto">
        <div className="flex items-center justify-between gap-3 px-4 py-4">
          <div>
            <div className="text-sm font-semibold tracking-tight">AZ Finance Intelligence</div>
            <div className="mt-0.5 text-xs text-slate-400">{t('positioning')}</div>
          </div>
          <button type="button" className="rounded border border-white/20 px-2.5 py-1 text-xs lg:hidden" aria-expanded={open} aria-controls="nav" onClick={() => setOpen(!open)}>
            {t('menu')}
          </button>
        </div>
        <nav id="nav" aria-label={t('menu')} className={`${open ? 'block' : 'hidden'} px-2 pb-3 lg:block`}>
          {NAV.map((g) => (
            <div key={g.group} className="mb-2">
              <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{t(g.group)}</div>
              {g.pages.map((p) => (
                <NavLink key={p.path} to={p.path} end={p.path === '/'}
                  className={({ isActive }) => `block rounded-md px-3 py-1.5 text-sm ${isActive ? 'bg-teal-400/15 font-medium text-white' : 'text-slate-300 hover:bg-white/5 hover:text-white'}`}>
                  {t(p.label)}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-col">
        <div className="flex items-center justify-end gap-2 border-b border-line bg-surface px-4 py-2">
          <Segmented label={t('language')} value={lang} onChange={setLang} options={[{ value: 'en', label: 'EN' }, { value: 'az', label: 'AZ' }]} />
          <button type="button" className="btn" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
            {theme === 'dark' ? t('theme_light') : t('theme_dark')}
          </button>
        </div>
        <main id="main" className="mx-auto w-full max-w-[1280px] flex-1 px-4 py-5 sm:px-6">
          <ErrorBoundary key={pathname}>
            <Suspense fallback={<Empty>{t('loading')}</Empty>}>
              <Routes>
                {PAGES.map((p) => <Route key={p.path} path={p.path} element={p.element} />)}
                <Route path="/banks/:slug" element={<BankProfile />} />
                <Route path="/research/:slug" element={<ReportView />} />
                <Route path="*" element={<Empty>{t('not_found')}</Empty>} />
              </Routes>
            </Suspense>
          </ErrorBoundary>
        </main>
        <footer className="border-t border-line px-4 py-3 text-xs text-ink-2 sm:px-6">{t('footer')}</footer>
      </div>
    </div>
  );
}
