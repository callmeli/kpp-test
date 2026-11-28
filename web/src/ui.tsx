/* 通用小组件：弹层、提示条、幸运币徽标、全局状态（Ctx） */
import { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { t } from './i18n';
import { APP, ApiError, isPro, loginUrl, Me, Settings, walletUrl } from './lib';
import * as iap from './iap';

export type Ctx = {
  me: Me | null; refresh: () => Promise<void>; setCoins: (n: number | null | undefined) => void;
  set: Settings; setSet: (s: Partial<Settings>) => void;
  go: (tab: Tab, sub?: string) => void;
  pro: boolean; setPro: (v: boolean) => void;   // App 版：买断过没有
  practiceIds: string[] | null; setPracticeIds: (ids: string[] | null) => void;
};
export type Tab = 'practice' | 'exam' | 'schools' | 'me';
export const AppCtx = createContext<Ctx>(null as unknown as Ctx);
export const useApp = () => useContext(AppCtx);

/* ---------- 提示条 ---------- */
let pushToast: (s: string) => void = () => {};
export const toast = (s: string) => pushToast(s);
export function Toaster() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    let tm: ReturnType<typeof setTimeout>;
    pushToast = (s) => { setMsg(s); clearTimeout(tm); tm = setTimeout(() => setMsg(null), 2600); };
  }, []);
  return msg ? <div className="toast" role="status">{msg}</div> : null;
}

/* ---------- 底部弹层 ---------- */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', k); return () => removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="mask" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        {title && <h3 className="sheet-title">{title}</h3>}
        {children}
      </div>
    </div>, document.body);
}

/* 确认框（Promise 风格） */
let pushConfirm: (o: { msg: string; ok: string; danger?: boolean; res: (v: boolean) => void }) => void = () => {};
export const confirmBox = (msg: string, ok = t('ok'), danger = false) => new Promise<boolean>((res) => pushConfirm({ msg, ok, danger, res }));
export function Confirmer() {
  const [c, setC] = useState<null | { msg: string; ok: string; danger?: boolean; res: (v: boolean) => void }>(null);
  useEffect(() => { pushConfirm = setC; }, []);
  const done = (v: boolean) => { c?.res(v); setC(null); };
  return (
    <Sheet open={!!c} onClose={() => done(false)}>
      <p className="confirm-msg">{c?.msg}</p>
      <div className="row2">
        <button className="btn secondary" onClick={() => done(false)}>{t('cancel')}</button>
        <button className={'btn primary' + (c?.danger ? ' danger' : '')} onClick={() => done(true)}>{c?.ok}</button>
      </div>
    </Sheet>
  );
}

/* ---------- 幸运币 ---------- */
export const CoinIcon = ({ size = 16 }: { size?: number }) => <img className="coin-ic" src="/coin.webp" width={size} height={size} alt="" />;
export function CoinPill() {
  const { me, pro } = useApp();
  if (APP) return pro ? <span className="pill pro"><Icon n="check" size={16} />{t('proActive')}</span> : <button className="pill" onClick={openPaywall}><Icon n="lock" size={16} />{t('unlockAll')}</button>;
  if (!me?.user) return <a className="pill" href={loginUrl()}>{t('login')}</a>;
  return <a className="pill coin" href={walletUrl()} title={t('topUp')}><CoinIcon />{me.coins ?? '—'}</a>;
}

/** 付费动作的统一错误处理：没登录 → 去登录；币不够 → 去充值 */
export function useSpendError() {
  const { setCoins } = useApp();
  return async (e: unknown) => {
    if (APP && e instanceof ApiError && (e.status === 401 || e.status === 402)) { openPaywall(); return; }
    if (e instanceof ApiError) {
      if (e.status === 401) { if (await confirmBox(t('loginNeed'), t('login'))) location.href = loginUrl(); return; }
      if (e.status === 402) { setCoins(e.data?.lc); if (await confirmBox(t('notEnough', { n: e.data?.need ?? '' }), t('topUp'))) location.href = walletUrl(); return; }
    }
    toast(t('err'));
  };
}

/** 未登录时的引导卡片（App 版没有登录：换成解锁卡片） */
export function LoginCard() {
  if (APP) return (
    <div className="card login-card">
      <p>{t('proTitle')}</p>
      <button className="btn primary block" onClick={openPaywall}><Icon n="lock" size={18} /> {t('unlockAll')}</button>
    </div>
  );
  return (
    <div className="card login-card">
      <p>{t('loginHint')}</p>
      <a className="btn primary block" href={loginUrl()}>{t('login')}</a>
    </div>
  );
}

export const Seg = <T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { v: T; label: ReactNode }[] }) => (
  <div className="seg" role="tablist">
    {items.map((x) => <button key={x.v} role="tab" aria-selected={value === x.v} className={value === x.v ? 'on' : ''} onClick={() => onChange(x.v)}>{x.label}</button>)}
  </div>
);

/* 线条图标（和底部导航同一种描边） */
const PATHS: Record<string, string> = {
  left: 'M15 5l-7 7 7 7', right: 'M9 5l7 7-7 7', down: 'M6 9l6 6 6-6', back: 'M15 5l-7 7 7 7',
  check: 'M5 12.5l4.5 4.5L19 7.5', x: 'M6 6l12 12M18 6L6 18',
  filter: 'M4 6h16M7 12h10M10 18h4', grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  clock: 'M12 7v5l3 3M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', flag: 'M5 21V4h11l-1.5 4L16 12H5',
  book: 'M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h11', tool: 'M14 6a4 4 0 0 0 5 5l-8 8a2.1 2.1 0 0 1-3-3z',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M5 11h14v9H5z', doc: 'M6 3h9l4 4v14H6zM9 12h7M9 16h7', target: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
};
export const Icon = ({ n, size = 20 }: { n: string; size?: number }) => (
  <svg className="ic" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={PATHS[n] || ''} /></svg>
);

/* ---------- App 版：买断弹层 ---------- */
let pushPay: () => void = () => {};
export const openPaywall = () => pushPay();
export function Paywall() {
  const { setPro, refresh } = useApp();
  const [open, setOpen] = useState(false);
  const [p, setP] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { pushPay = () => setOpen(true); }, []);
  useEffect(() => { if (open && !p) iap.price().then(setP); }, [open, p]);
  const done = async (r: iap.Result, restoring: boolean) => {
    if (r === 'ok') { setPro(isPro()); setOpen(false); toast(t('proThanks')); await refresh(); return; }
    if (r === 'pending') toast(t('proPending'));
    else if (r === 'net') toast(t('proNet'));
    else if (r === 'none' && restoring) toast(t('proNone'));
    else if (r !== 'cancel') toast(t('err'));
  };
  const run = async (restoring: boolean) => { setBusy(true); try { await done(restoring ? await iap.restore(true) : await iap.buy(), restoring); } finally { setBusy(false); } };
  return (
    <Sheet open={open} onClose={() => !busy && setOpen(false)} title={t('proTitle')}>
      <ul className="pro-list">
        {['proItem1', 'proItem2', 'proItem3'].map((k) => <li key={k}><Icon n="check" size={18} /> {t(k)}</li>)}
      </ul>
      <button className="btn primary block" disabled={busy} onClick={() => run(false)}>{t('proBuy', { p: p || '…' })}</button>
      <button className="btn secondary block" disabled={busy} onClick={() => run(true)}>{t('proRestore')}</button>
      <p className="muted small">{t('proNote')} {t('proPayBy', { s: iap.storeName() })}</p>
      <p className="muted small"><a href="https://kpp.luckylab.cc/privacy" target="_blank" rel="noreferrer">{t('privacy')}</a></p>
    </Sheet>
  );
}
