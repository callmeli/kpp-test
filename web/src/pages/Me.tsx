/* 我的：账号与幸运币、进度、错题集（记录免费，查看 / 重练要解锁）、设置、纠错审核（管理员）、更多 LuckyLab 应用 */
import { useEffect, useState } from 'react';
import { LANGS, t } from '../i18n';
import { accountUrl, api, clearWrong, delWrong, getProgress, getWrong, qById, syncWrong, txOr, walletUrl, WrongItem } from '../lib';
import { CoinIcon, confirmBox, Icon, LoginCard, Seg, Sheet, toast, useApp, useSpendError } from '../ui';

export function Me({ active }: { active: boolean }) {
  const { me, set, setSet, refresh } = useApp();
  const [wrongOpen, setWrongOpen] = useState(false);
  const [admin, setAdmin] = useState(false);
  const p = getProgress(), done = Object.keys(p).length, right = Object.values(p).filter((x) => x === 1).length;
  const [wn, setWn] = useState(getWrong().length);
  useEffect(() => { if (active) setWn(me?.user && me.unlocks?.includes('wrong') ? getWrong().length : Math.max(getWrong().length, me?.wrongN || 0)); }, [active, me]);

  const logout = async () => {
    if (!(await confirmBox(t('logout') + '?', t('logout'), true))) return;
    // 退出在 LuckyLab 账号页做（所有应用一起退出）
    location.href = accountUrl();
  };

  return (
    <div className="page me">
      <header className="top"><h1>{t('tabMe')}</h1></header>

      {me?.user ? (
        <div className="card me-card">
          <div className="avatar">{(me.user.name.match(/[\p{L}\p{N}]/u) || ['?'])[0].toUpperCase()}</div>
          <div className="me-info"><b>{me.user.name}</b><a className="muted small" href={accountUrl()}>{t('account')} →</a></div>
          <a className="coin-box" href={walletUrl()}><CoinIcon size={22} /><b>{me.coins ?? '—'}</b><small>{t('topUp')}</small></a>
        </div>
      ) : <LoginCard />}

      <div className="card">
        <h3>{t('stats')}</h3>
        <div className="kpis">
          <div><b>{done}</b><span>{t('statDone')}</span></div>
          <div><b>{done ? Math.round((right / done) * 100) : 0}%</b><span>{t('statAcc')}</span></div>
          <div><b>{wn}</b><span>{t('wrongSet')}</span></div>
        </div>
      </div>

      <button className="card row-btn" onClick={() => setWrongOpen(true)}>
        <span><Icon n="book" /> {t('wrongSet')}</span>
        <span className="muted">{me?.unlocks?.includes('wrong') ? t('unlocked') : <><Icon n="lock" size={16} /> {me?.econ.wrong ?? 50}</>} <Icon n="right" size={18} /></span>
      </button>

      <div className="card settings">
        <h3>{t('settings')}</h3>
        <div className="set-row"><span>{t('uiLang')}</span><Seg value={set.ui} onChange={(v) => setSet({ ui: v })} items={LANGS.map((l) => ({ v: l.v, label: l.name }))} /></div>
        <div className="set-row col">
          <span>{t('qLang')}</span>
          <Seg value={set.ql} onChange={(v) => setSet({ ql: v })} items={[{ v: 'en', label: 'English' }, { v: 'ms', label: 'Bahasa Melayu' }]} />
          <small className="muted">{t('qLangHint')}</small>
        </div>
        <div className="set-row"><span>{t('translation')}</span>
          <Seg value={set.tr} onChange={(v) => setSet({ tr: v })} items={[{ v: 'zh', label: '中文' }, { v: 'en', label: 'EN' }, { v: 'ms', label: 'BM' }, { v: 'off', label: t('off') }]} />
        </div>
        <Toggle label={t('autoNext')} on={set.autoNext} set={(v) => setSet({ autoNext: v })} />
        <Toggle label={t('autoWrong')} on={set.autoWrong} set={(v) => setSet({ autoWrong: v })} />
        <Toggle label={t('sound')} on={set.sound} set={(v) => setSet({ sound: v })} />
      </div>

      {me?.user?.admin && <button className="card row-btn" onClick={() => setAdmin(true)}><span><Icon n="tool" /> {t('admin')}</span><Icon n="right" size={18} /></button>}

      <a className="card row-btn more" href="https://luckylab.cc/?from=kpp">
        <span><img src="/lk-logo.svg" alt="" width={22} height={22} /> {t('more')}</span><Icon n="right" size={18} />
      </a>
      {me?.user && <button className="link danger center block" onClick={logout}>{t('logout')}</button>}
      <p className="muted small center">{me && t('bankInfo', { n: me.bankN, v: me.bankV })}</p>
      <p className="muted small center pad">{t('disclaimer')}</p>

      <WrongSheet open={wrongOpen} onClose={() => { setWrongOpen(false); setWn(getWrong().length); refresh(); }} />
      {me?.user?.admin && <AdminSheet open={admin} onClose={() => setAdmin(false)} />}
    </div>
  );
}

const Toggle = ({ label, on, set }: { label: string; on: boolean; set: (v: boolean) => void }) => (
  <label className="set-row toggle"><span>{label}</span><input type="checkbox" role="switch" checked={on} onChange={(e) => set(e.target.checked)} /></label>
);

function WrongSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { me, set, setCoins, refresh, setPracticeIds, go } = useApp();
  const onErr = useSpendError();
  const isOpen = !!me?.unlocks?.includes('wrong');
  const [list, setList] = useState<WrongItem[]>(getWrong);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open && me?.user) syncWrong(isOpen).then(() => setList(getWrong())).catch(() => {}); else if (open) setList(getWrong()); }, [open, isOpen, me?.user]);
  const n = isOpen ? list.length : Math.max(list.length, me?.wrongN || 0);
  const unlock = async () => {
    setBusy(true);
    try { const r = await api<{ lc: number }>('/unlock', { item: 'wrong' }); setCoins(r.lc); await refresh(); }
    catch (e) { await onErr(e); }
    setBusy(false);
  };
  return (
    <Sheet open={open} onClose={onClose} title={t('wrongSet')}>
      <p className="muted">{t('wrongDesc', { n })}</p>
      {!isOpen ? (
        <div className="locked">
          <p>{t('wrongLocked')}</p>
          {me?.user ? <button className="btn primary block" disabled={busy} onClick={unlock}><CoinIcon size={18} /> {t('unlockFor', { n: me.econ.wrong })}</button> : <LoginCard />}
        </div>
      ) : list.length === 0 ? <p className="center">{t('wrongEmpty')}</p> : (
        <>
          <div className="row2">
            <button className="btn secondary" onClick={async () => { if (await confirmBox(t('wrongClearAsk', { n: list.length }), t('wrongClear'), true)) { clearWrong(); setList([]); } }}>{t('wrongClear')}</button>
            <button className="btn primary" onClick={() => { setPracticeIds(list.map((x) => x.qid)); go('practice'); onClose(); }}>{t('wrongPractice')} ({list.length})</button>
          </div>
          <ul className="wrong-list">
            {list.map((w) => {
              const q = qById(w.qid); if (!q) return null;
              return (
                <li key={w.qid}>
                  <p>{txOr(q.t, set.ql)}</p>
                  <div className="muted small">{w.ans ? t('yourAns', { a: w.ans }) + ' · ' : ''}✓ {q.a}
                    <button className="link small" onClick={() => { delWrong(w.qid); setList(getWrong()); }}>{t('wrongRemove')}</button>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Sheet>
  );
}

type Rep = { id: number; qid: string; kind: string; suggest?: string; note?: string; lang?: string; ts: number; same: number };
function AdminSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { set } = useApp();
  const [list, setList] = useState<Rep[]>([]);
  const load = () => api<{ list: Rep[] }>('/admin/reports').then((r) => setList(r.list)).catch(() => toast(t('err')));
  useEffect(() => { if (open) load(); }, [open]);
  const resolve = async (r: Rep, action: 'accept' | 'reject', patch?: unknown) => {
    try { await api('/admin/resolve', { id: r.id, action, patch }); load(); } catch { toast(t('err')); }
  };
  return (
    <Sheet open={open} onClose={onClose} title={t('admin')}>
      {list.length === 0 && <p className="center muted">—</p>}
      <ul className="wrong-list">
        {list.map((r) => {
          const q = qById(r.qid);
          return (
            <li key={r.id}>
              <p><b>[{r.kind}{r.same > 1 ? ` ×${r.same}` : ''}]</b> {q ? txOr(q.t, set.ql) : r.qid}</p>
              {q && <p className="muted small">{q.o.map((o) => `${o.l}${o.l === q.a ? '✓' : ''}. ${o.t ? txOr(o.t, set.ql) : '🖼'}`).join('  ')}</p>}
              {r.note && <p className="note">{r.note}</p>}
              <div className="chips">
                {r.kind === 'answer' && r.suggest && r.suggest !== q?.a && <button className="chip on" onClick={() => resolve(r, 'accept', { a: r.suggest })}>{t('setAns', { a: r.suggest })}</button>}
                <button className="chip" onClick={() => resolve(r, 'accept')}>{t('accept')}</button>
                <button className="chip" onClick={() => resolve(r, 'reject')}>{t('reject')}</button>
              </div>
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}
