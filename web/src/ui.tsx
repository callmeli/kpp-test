/* 通用小组件：弹层、提示条、幸运币徽标、全局状态（Ctx） */
import { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { t } from './i18n';
import { ApiError, loginUrl, Me, Settings, walletUrl } from './lib';

export type Ctx = {
  me: Me | null; refresh: () => Promise<void>; setCoins: (n: number | null | undefined) => void;
  set: Settings; setSet: (s: Partial<Settings>) => void;
  go: (tab: Tab, sub?: string) => void;
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
        <button className="btn ghost" onClick={() => done(false)}>{t('cancel')}</button>
        <button className={'btn ' + (c?.danger ? 'danger' : 'primary')} onClick={() => done(true)}>{c?.ok}</button>
      </div>
    </Sheet>
  );
}

/* ---------- 幸运币 ---------- */
export const CoinIcon = ({ size = 16 }: { size?: number }) => <img className="coin-ic" src="/coin.webp" width={size} height={size} alt="" />;
export function CoinPill() {
  const { me } = useApp();
  if (!me?.user) return <a className="pill" href={loginUrl()}>{t('login')}</a>;
  return <a className="pill coin" href={walletUrl()} title={t('topUp')}><CoinIcon />{me.coins ?? '—'}</a>;
}

/** 付费动作的统一错误处理：没登录 → 去登录；币不够 → 去充值 */
export function useSpendError() {
  const { setCoins } = useApp();
  return async (e: unknown) => {
    if (e instanceof ApiError) {
      if (e.status === 401) { if (await confirmBox(t('loginNeed'), t('login'))) location.href = loginUrl(); return; }
      if (e.status === 402) { setCoins(e.data?.lc); if (await confirmBox(t('notEnough', { n: e.data?.need ?? '' }), t('topUp'))) location.href = walletUrl(); return; }
    }
    toast(t('err'));
  };
}

/** 未登录时的引导卡片 */
export function LoginCard() {
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
