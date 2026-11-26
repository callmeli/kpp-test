/* 刷题：免费。分类 + 顺序 / 随机 / 没做过；答对自动下一题；答错收进错题集；每 100 题随机提醒一次打赏 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { t } from '../i18n';
import { addWrong, api, bank, beep, countAnswer, delWrong, getProgress, load, mark, nonce, qById, save, loginUrl } from '../lib';
import { QuestionView } from '../Question';
import { CoinIcon, CoinPill, Seg, Sheet, toast, useApp, useSpendError } from '../ui';
import { trackPractice } from '../utils/analytics';

type Sec = 'all' | 'A' | 'B' | 'C';
type Mode = 'order' | 'random' | 'new';

function shuffle<T>(a: T[]): T[] { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; }

export function Practice() {
  const { set, practiceIds, setPracticeIds, me } = useApp();
  const redo = !!practiceIds;   // 错题重练
  const [sec, setSec] = useState<Sec>(() => load('sec', 'all'));
  const [mode, setMode] = useState<Mode>(() => load('mode', 'order'));
  const [seed, setSeed] = useState(0);
  const list = useMemo(() => {
    if (practiceIds) return practiceIds.map(qById).filter(Boolean).map((q) => q!.id);
    let qs = bank().filter((q) => sec === 'all' || q.s === sec);
    if (mode === 'new') { const p = getProgress(); qs = qs.filter((q) => p[q.id] === undefined); }
    const ids = qs.map((q) => q.id);
    return mode === 'order' ? ids : shuffle(ids);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sec, mode, seed, practiceIds]);
  const posKey = redo ? null : `pos_${sec}_${mode}`;
  const [i, setI] = useState(() => (posKey && mode === 'order' ? Math.min(load(posKey, 0), Math.max(0, list.length - 1)) : 0));
  const [picked, setPicked] = useState<string | null>(null);
  const [tipN, setTipN] = useState<number | null>(null);
  const [jump, setJump] = useState(false);
  const [prog, setProg] = useState(getProgress);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => { save('sec', sec); save('mode', mode); }, [sec, mode]);
  useEffect(() => { setI(posKey && mode === 'order' ? Math.min(load(posKey, 0), Math.max(0, list.length - 1)) : 0); setPicked(null); }, [list]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (posKey && mode === 'order') save(posKey, i); }, [i, posKey, mode]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const q = list[i] ? qById(list[i]) : undefined;
  const go = (d: number) => { clearTimeout(timer.current); setPicked(null); setI((x) => Math.max(0, Math.min(list.length, x + d))); window.scrollTo({ top: 0 }); };

  const pick = (l: string) => {
    if (!q || picked) return;
    setPicked(l);
    const ok = l === q.a;
    beep(ok, set.sound);
    mark(q.id, ok); setProg(getProgress());
    trackPractice.submit(ok);
    if (!ok && set.autoWrong) addWrong(q.id, l);
    if (ok && redo) delWrong(q.id);   // 重练答对 → 移出错题集
    const tipAt = countAnswer();
    if (tipAt) { setTipN(tipAt); return; }
    if (ok && set.autoNext && !q.n) timer.current = setTimeout(() => go(1), 650);
  };

  const done = Object.keys(prog).length, right = Object.values(prog).filter((x) => x === 1).length;
  const secCount = (s: Sec) => (s === 'all' ? bank().length : bank().filter((x) => x.s === s).length);

  return (
    <div className="page">
      <header className="top">
        {redo ? <button className="link" onClick={() => setPracticeIds(null)}>← {t('back')}</button> : <h1>{t('appName')}</h1>}
        <CoinPill />
      </header>

      {!redo && (
        <>
          <div className="scroll-x">
            <Seg value={sec} onChange={setSec} items={(['all', 'A', 'B', 'C'] as Sec[]).map((s) => ({ v: s, label: <>{t(s === 'all' ? 'secAll' : 'sec' + s)} <i>{secCount(s)}</i></> }))} />
          </div>
          <div className="stat-strip">
            <span>{t('done', { n: `${done}/${bank().length}` })} · {t('accuracy', { p: done ? Math.round((right / done) * 100) : 0 })}</span>
            <span className="mini"><Seg value={mode} onChange={(m) => { setMode(m); setSeed((x) => x + 1); }} items={[{ v: 'order', label: t('modeOrder') }, { v: 'random', label: t('modeRandom') }, { v: 'new', label: t('modeNew') }]} /></span>
          </div>
        </>
      )}
      {redo && <p className="muted center">{t('wrongMastered')}</p>}

      {list.length > 0 && <div className="bar" aria-hidden="true"><i style={{ width: `${(Math.min(i + (picked ? 1 : 0), list.length) / list.length) * 100}%` }} /></div>}

      {q ? (
        <div className="card q-card" key={q.id}>
          <QuestionView q={q} picked={picked} reveal onPick={pick} num={`${i + 1} / ${list.length} · `} />
          {picked && (
            <div className={'verdict ' + (picked === q.a ? 'ok' : 'no')}>
              {picked === q.a ? t('correct') : t('wrongAns', { a: q.a })}
            </div>
          )}
        </div>
      ) : (
        <div className="card empty">
          <p>{t('allDone')}</p>
          <button className="btn primary" onClick={() => { if (redo) setPracticeIds(null); else { setI(0); setSeed((x) => x + 1); } }}>{redo ? t('back') : t('restart')}</button>
        </div>
      )}

      {q && (
        <nav className="pager">
          <button className="btn ghost" disabled={i === 0} onClick={() => go(-1)}>{t('prev')}</button>
          <button className="pos" onClick={() => setJump(true)}>{i + 1}<small>/{list.length}</small></button>
          <button className={'btn ' + (picked ? 'primary' : 'ghost')} onClick={() => go(1)}>{t('next')}</button>
        </nav>
      )}

      <JumpSheet open={jump} max={list.length} onClose={() => setJump(false)} onGo={(n) => { setJump(false); setPicked(null); setI(n - 1); }} />
      <TipSheet n={tipN} onClose={() => { setTipN(null); if (picked && q && picked === q.a && set.autoNext) go(1); }} loggedIn={!!me?.user} />
    </div>
  );
}

function JumpSheet({ open, max, onClose, onGo }: { open: boolean; max: number; onClose: () => void; onGo: (n: number) => void }) {
  const [v, setV] = useState('');
  const n = parseInt(v, 10), ok = n >= 1 && n <= max;
  return (
    <Sheet open={open} onClose={onClose} title={t('jumpTitle')}>
      <input className="input big" type="number" inputMode="numeric" min={1} max={max} placeholder={`1 – ${max}`} value={v} autoFocus
        onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ok && onGo(n)} />
      <button className="btn primary block" disabled={!ok} onClick={() => onGo(n)}>{t('go')}</button>
    </Sheet>
  );
}

/** 打赏提醒：刷题每 100 题随机弹一次，可以直接关掉 */
function TipSheet({ n, onClose, loggedIn }: { n: number | null; onClose: () => void; loggedIn: boolean }) {
  const { me, setCoins } = useApp();
  const onErr = useSpendError();
  const [busy, setBusy] = useState(false);
  const tip = async (amount: number) => {
    setBusy(true);
    try { const r = await api<{ lc: number }>('/tip', { amount, nonce: nonce() }); setCoins(r.lc); toast(t('tipThanks')); onClose(); }
    catch (e) { await onErr(e); }
    setBusy(false);
  };
  return (
    <Sheet open={n !== null} onClose={onClose} title={t('tipTitle', { n: n ?? 0 })}>
      <p className="muted">{t('tipBody')}</p>
      {loggedIn ? (
        <div className="tips">
          {(me?.econ.tips || [10, 30, 66]).map((a) => (
            <button key={a} className="btn tip" disabled={busy} onClick={() => tip(a)}><CoinIcon size={18} /> {a}</button>
          ))}
        </div>
      ) : <a className="btn primary block" href={loginUrl()}>{t('login')} · {t('tip')}</a>}
      <button className="btn ghost block" onClick={onClose}>{t('tipLater')}</button>
    </Sheet>
  );
}
