import { useCallback, useEffect, useState } from 'react';
import { detectLang, setLang, t } from './i18n';
import { api, defaultSettings, flushWrong, load, loadBank, Me as MeT, save, setLoggedIn, Settings, syncWrong } from './lib';
import { Exam } from './pages/Exam';
import { Me } from './pages/Me';
import { Practice } from './pages/Practice';
import { Schools } from './pages/Schools';
import { AppCtx, CoinPill, Confirmer, Tab, Toaster } from './ui';
import { ltIdentify, trackPageView } from './utils/analytics';

const TABS: { k: Tab; icon: JSX.Element }[] = [
  { k: 'practice', icon: <svg viewBox="0 0 24 24"><path d="M5 4h11l3 3v13H5z" /><path d="M8 10h8M8 14h8M8 18h5" /></svg> },
  { k: 'exam', icon: <svg viewBox="0 0 24 24"><circle cx="12" cy="13" r="7.5" /><path d="M12 9v4l2.5 2.5M9.5 2.5h5" /></svg> },
  { k: 'schools', icon: <svg viewBox="0 0 24 24"><path d="M5 17h14l-1.6-6.2A2 2 0 0 0 15.5 9h-7a2 2 0 0 0-1.9 1.8z" /><circle cx="8" cy="17.5" r="1.8" /><circle cx="16" cy="17.5" r="1.8" /><path d="M3 13h2M19 13h2" /></svg> },
  { k: 'me', icon: <svg viewBox="0 0 24 24"><circle cx="12" cy="8.5" r="3.8" /><path d="M4.5 20c1.2-3.6 4-5.5 7.5-5.5s6.3 1.9 7.5 5.5" /></svg> },
];
const NAMES: Record<Tab, string> = { practice: 'tabPractice', exam: 'tabExam', schools: 'tabSchools', me: 'tabMe' };

export default function App() {
  const [set, setSetState] = useState<Settings>(() => ({ ...defaultSettings(detectLang()), ...load<Partial<Settings>>('set', {}) }));
  setLang(set.ui);
  const [me, setMe] = useState<MeT | null>(null);
  const [ready, setReady] = useState<'load' | 'ok' | 'fail'>('load');
  const [tab, setTab] = useState<Tab>(() => (location.hash.slice(1) as Tab) in NAMES ? (location.hash.slice(1) as Tab) : 'practice');
  const [practiceIds, setPracticeIds] = useState<string[] | null>(null);

  const setSet = (s: Partial<Settings>) => setSetState((o) => { const n = { ...o, ...s }; save('set', n); return n; });
  const refresh = useCallback(async () => {
    try { const m = await api<MeT>('/me'); setMe(m); setLoggedIn(!!m.user); ltIdentify(m.user?.id); if (m.user) flushWrong(); } catch { /* 离线：照常用本机题库 */ }
  }, []);
  const boot = useCallback(async () => {
    setReady('load');
    let m: MeT | null = null;
    try { m = await api<MeT>('/me'); setMe(m); setLoggedIn(!!m.user); ltIdentify(m.user?.id); } catch { /* 离线 */ }
    try { await loadBank(m?.bankV); setReady('ok'); } catch { setReady('fail'); return; }
    if (m?.user) syncWrong(!!m.unlocks?.includes('wrong')).catch(() => {});
  }, []);
  useEffect(() => { boot(); }, [boot]);
  useEffect(() => { history.replaceState(null, '', '#' + tab); trackPageView('/' + tab, tab); }, [tab]);
  // 从充值 / 登录页回来时刷新余额
  useEffect(() => { const v = () => document.visibilityState === 'visible' && refresh(); document.addEventListener('visibilitychange', v); return () => document.removeEventListener('visibilitychange', v); }, [refresh]);

  const ctx = {
    me, refresh, set, setSet, practiceIds, setPracticeIds,
    setCoins: (n: number | null | undefined) => { if (typeof n === 'number') setMe((m) => (m ? { ...m, coins: n } : m)); },
    go: (k: Tab) => setTab(k),
  };

  if (ready !== 'ok') {
    return (
      <div className="boot">
        <img src="/icon.svg" width={64} height={64} alt="" />
        <p>{ready === 'load' ? t('loading') : t('loadFail')}</p>
        {ready === 'fail' && <button className="btn primary" onClick={boot}>{t('retry')}</button>}
      </div>
    );
  }
  return (
    <AppCtx.Provider value={ctx}>
      <main className="app" key={set.ui}>
        <section hidden={tab !== 'practice'}><Practice key={practiceIds ? 'redo' : 'all'} active={tab === 'practice'} /></section>
        <section hidden={tab !== 'exam'}><Exam active={tab === 'exam'} /></section>
        <section hidden={tab !== 'schools'}><Schools active={tab === 'schools'} /></section>
        <section hidden={tab !== 'me'}><Me active={tab === 'me'} /></section>
      </main>
      <nav className="tabbar">
        <a className="side-brand" href="#practice" onClick={(e) => { e.preventDefault(); setTab('practice'); }}><img src="/icon.svg" width={32} height={32} alt="" /><span>{t('appName')}</span></a>
        {TABS.map((x) => (
          <button key={x.k} className={tab === x.k ? 'on' : ''} onClick={() => { setTab(x.k); window.scrollTo({ top: 0 }); }} aria-current={tab === x.k ? 'page' : undefined}>
            {x.icon}<span>{t(NAMES[x.k])}</span>
          </button>
        ))}
        <div className="side-foot"><CoinPill /><a href="https://luckylab.cc/?from=kpp" className="muted small">LuckyLab</a></div>
      </nav>
      <Toaster /><Confirmer />
    </AppCtx.Provider>
  );
}
