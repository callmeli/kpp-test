/* 模拟考试：默认按 2025-08 起的合并卷（KPP Gabungan）70 题 / 75 分钟 / 56 题及格，也可以选旧制 50 题 / 45 分钟 / 42 题；每场扣幸运币，开考时扣（同一 nonce 不重扣） */
import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { addWrong, api, APP, bank, load, loginUrl, nonce, Q, qById, save } from '../lib';
import { QuestionView } from '../Question';
import { CoinIcon, CoinPill, confirmBox, Icon, openPaywall, Seg, Sheet, toast, useApp, useSpendError } from '../ui';
import { trackExam } from '../utils/analytics';

// JPJ 2025-08 起汽车 + 摩托理论合并成一张卷（KPP Gabungan）：70 题、1 小时 15 分、56 题及格；之前是 50 题、45 分钟、42 题
const FORMATS = { new: { n: 70, min: 75, pass: 56 }, old: { n: 50, min: 45, pass: 42 } } as const;
type Fmt = keyof typeof FORMATS;
type Run = { id: string; ids: string[]; ans: Record<string, string>; end: number; i: number; pass: number };
type Done = { ids: string[]; ans: Record<string, string>; score: number; pass: number; timeUp?: boolean };

/** 按三部分在题库里的比例抽题，保证每部分都有 */
function draw(N: number): string[] {
  const all = bank(), out: string[] = [];
  for (const s of ['A', 'B', 'C'] as const) {
    const pool = all.filter((q) => q.s === s).map((q) => q.id);
    const k = Math.round((pool.length / all.length) * N);
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    out.push(...pool.slice(0, k));
  }
  // 四舍五入后可能差一两题：从没抽到的题里随机补齐
  const rest = all.map((q) => q.id).filter((id) => !out.includes(id));
  while (out.length < N && rest.length) out.push(rest.splice(Math.floor(Math.random() * rest.length), 1)[0]);
  return out.slice(0, N);
}
const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

export function Exam({ active }: { active: boolean }) {
  const { me, set, setSet, setCoins, refresh, pro } = useApp();
  const onErr = useSpendError();
  const [run, setRun] = useState<Run | null>(() => load<Run | null>('exam', null));
  const [done, setDone] = useState<Done | null>(null);
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fmt, setFmt] = useState<Fmt>(() => (load<Fmt>('fmt', 'new') === 'old' ? 'old' : 'new'));
  const { n: N, min: MIN, pass: PASS } = FORMATS[fmt];
  const [now, setNow] = useState(Date.now());
  const [hist, setHist] = useState<{ ts: number; score: number; total: number; passed: number }[]>([]);
  const finishing = useRef(false);
  const [sheet, setSheet] = useState(false);
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => { const k = (e: KeyboardEvent) => keyRef.current(e); addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, []);
  // 考试中隐藏底部导航
  useEffect(() => { document.body.classList.toggle('focus', !!run && active); return () => document.body.classList.remove('focus'); }, [run, active]);

  useEffect(() => { save('exam', run); }, [run]);
  useEffect(() => { if (!run) return; const h = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(h); }, [run]);
  useEffect(() => {
    if (APP) { if (active && !run) setHist(load('hist', [])); return; }   // App：考试记录存本机
    if (me?.user && active && !run) api('/exams').then((r) => setHist(r.list)).catch(() => {});
  }, [me?.user, active, run, done]);

  const finish = async (r: Run, timeUp = false) => {
    if (finishing.current) return; finishing.current = true;
    const score = r.ids.filter((id) => r.ans[id] === qById(id)?.a).length;
    r.ids.forEach((id) => { const q = qById(id); if (q && r.ans[id] && r.ans[id] !== q.a && set.autoWrong) addWrong(id, r.ans[id]); /* 没作答的不算错题 */ });
    const pass = r.pass || FORMATS.old.pass;
    setDone({ ids: r.ids, ans: r.ans, score, pass, timeUp }); setRun(null); setReview(false);
    trackExam.submit(score, score >= pass, r.ids.length);
    if (timeUp) toast(t('timeUp'));
    if (APP) save('hist', [{ ts: Date.now(), score, total: r.ids.length, passed: score >= pass ? 1 : 0 }, ...load<unknown[]>('hist', [])].slice(0, 30));
    else api('/exam/finish', { id: r.id, score, total: r.ids.length, passed: score >= pass }).catch(() => {});
    finishing.current = false;
  };
  const left = run ? Math.max(0, Math.round((run.end - now) / 1000)) : 0;
  useEffect(() => { if (run && left <= 0) finish(run, true); }, [left, run]);   // eslint-disable-line react-hooks/exhaustive-deps

  const start = async () => {
    if (APP) {   // App：买断后不限次数，本机出卷，不用经过服务端
      if (!pro) { openPaywall(); return; }
      setDone(null);
      setRun({ id: 'a' + nonce(), ids: draw(N), ans: {}, end: Date.now() + MIN * 60e3, i: 0, pass: PASS });
      trackExam.start(N, MIN);
      window.scrollTo({ top: 0 });
      return;
    }
    setBusy(true);
    const nn = load('examNonce', '') || nonce(); save('examNonce', nn);   // 网络重试用同一个 nonce，不会重复扣
    try {
      const r = await api<{ id: string; lc: number }>('/exam/start', { nonce: nn });
      save('examNonce', '');
      setCoins(r.lc);
      setDone(null);
      setRun({ id: r.id, ids: draw(N), ans: {}, end: Date.now() + MIN * 60e3, i: 0, pass: PASS });
      trackExam.start(N, MIN);
      window.scrollTo({ top: 0 });
    } catch (e) { await onErr(e); refresh(); }
    setBusy(false);
  };

  /* ---------- 考试中：全屏专注（隐藏底部导航） ---------- */
  if (run) {
    const q = qById(run.ids[run.i]) as Q, answered = Object.keys(run.ans).length, last = run.i === run.ids.length - 1;
    const setI = (i: number) => { setRun({ ...run, i }); setSheet(false); window.scrollTo({ top: 0 }); };
    const keyNav = (e: KeyboardEvent) => {
      if (!active || e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement)?.closest?.('input,textarea,select,[role=dialog]')) return;
      if (e.key === 'ArrowLeft' && run.i > 0) { e.preventDefault(); setI(run.i - 1); }
      else if (e.key === 'ArrowRight' && !last) { e.preventDefault(); setI(run.i + 1); }
    };
    keyRef.current = keyNav;
    const submit = async () => { const un = run.ids.length - answered; if (!un || (await confirmBox(t('examSubmitAsk', { n: un }), t('examSubmit')))) finish(run); };
    return (
      <div className="page has-dock exam-run">
        <header className="top">
          <button className="ic-btn" aria-label={t('examQuit')} onClick={async () => { if (await confirmBox(t('examQuitAsk'), t('examQuit'), true)) setRun(null); }}><Icon n="x" /></button>
          <span className={'timer' + (left < 300 ? ' warn' : '')}>{mmss(left)}</span>
          <button className="btn secondary sm" onClick={() => setSheet(true)}><Icon n="grid" size={16} /> {answered}/{run.ids.length}</button>
        </header>
        <div className="bar"><i style={{ width: `${(answered / run.ids.length) * 100}%` }} /></div>
        <div className="q-card" key={q.id}>
          <QuestionView q={q} picked={run.ans[q.id] || null} reveal={false} noTrans keys={active} num={`${run.i + 1} / ${run.ids.length}`}
            onPick={(l) => {
              setRun({ ...run, ans: { ...run.ans, [q.id]: l } });
              if (!last) setTimeout(() => setRun((r) => (r && r.i === run.i ? { ...r, i: r.i + 1 } : r)), 320);
            }} />
        </div>
        <aside className="exam-aside">
          <div className="aside-h"><b>{answered}</b> / {run.ids.length}</div>
          <div className="grid-nums">
            {run.ids.map((id, k) => <button key={id} className={(run.ans[id] ? 'a' : '') + (k === run.i ? ' cur' : '')} onClick={() => setI(k)}>{k + 1}</button>)}
          </div>
          <button className="btn primary block" onClick={submit}>{t('examSubmit')}</button>
          <p className="muted small kbd-hint">{t('kbdExam')}</p>
        </aside>
        <nav className="dock">
          <div className="btn-row">
            <button className="btn secondary" disabled={run.i === 0} onClick={() => setI(run.i - 1)}>{t('prev')}</button>
            {last || answered === run.ids.length ? <button className="btn primary" onClick={submit}>{t('examSubmit')}</button>
              : <button className="btn secondary" onClick={() => setI(run.i + 1)}>{t('next')}</button>}
          </div>
        </nav>
        <Sheet open={sheet} onClose={() => setSheet(false)} title={`${answered} / ${run.ids.length}`}>
          <div className="grid-nums">
            {run.ids.map((id, k) => <button key={id} className={(run.ans[id] ? 'a' : '') + (k === run.i ? ' cur' : '')} onClick={() => setI(k)}>{k + 1}</button>)}
          </div>
          <button className="btn primary block" onClick={submit}>{t('examSubmit')}</button>
        </Sheet>
      </div>
    );
  }

  /* ---------- 成绩 ---------- */
  if (done) {
    const pass = done.score >= done.pass, wrongIds = done.ids.filter((id) => done.ans[id] !== qById(id)?.a);
    const pct = done.score / done.ids.length, C = 2 * Math.PI * 52;
    return (
      <div className="page">
        <header className="top"><h1>{t('examTitle')}</h1><CoinPill /></header>
        <div className={'card result ' + (pass ? 'pass' : 'fail')}>
          <div className="ring">
            <svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="52" className="ring-bg" /><circle cx="60" cy="60" r="52" className="ring-fg" strokeDasharray={`${C * pct} ${C}`} /></svg>
            <div className="big-score">{done.score}<small>/{done.ids.length}</small></div>
          </div>
          <div className="badge">{pass ? t('passed') : t('failed')}</div>
          <p className="muted">{t('scoreLine', { c: done.score, t: done.ids.length, p: done.pass })}</p>
          <div className="row2">
            {wrongIds.length > 0 && <button className="btn secondary" onClick={() => setReview(!review)}>{t('reviewWrong')} · {wrongIds.length}</button>}
            <button className="btn primary" onClick={() => { setDone(null); }}>{t('again')}</button>
          </div>
        </div>
        {review && wrongIds.map((id, k) => {
          const q = qById(id)!;
          return (
            <div className="card q-card" key={id}>
              <QuestionView q={q} picked={done.ans[id] || '-'} reveal onPick={() => {}} num={`${k + 1} / ${wrongIds.length}`} />
              <div className="verdict no">{done.ans[id] ? t('yourAns', { a: done.ans[id] }) : t('noAns')} · {t('wrongAns', { a: q.a })}</div>
            </div>
          );
        })}
      </div>
    );
  }

  /* ---------- 开考前 ---------- */
  const price = me?.econ.exam ?? 20;
  return (
    <div className="page">
      <header className="top"><h1>{t('examTitle')}</h1><CoinPill /></header>
      <div className="card hero-exam">
        <h2 className="h2">{t('examLike')}</h2>
        <div className="tiles">
          <div><b>{N}</b><span>{t('uQ')}</span></div>
          <div><b>{MIN}</b><span>{t('uMin')}</span></div>
          <div><b>{PASS}</b><span>{t('uPass')}</span></div>
        </div>
        <div className="field-row">
          <span className="muted small">{t('examFmt')}</span>
          <Seg value={fmt} onChange={(v) => { setFmt(v); save('fmt', v); }} items={[{ v: 'new', label: t('fmtNew') }, { v: 'old', label: t('fmtOld') }]} />
        </div>
        <div className="field-row">
          <span className="muted small">{t('examLang')}</span>
          <Seg value={set.ql} onChange={(v) => setSet({ ql: v })} items={[{ v: 'en', label: 'English' }, { v: 'ms', label: 'Bahasa Melayu' }]} />
        </div>
        {APP ? (
          <button className="btn primary block" disabled={bank().length < N} onClick={start}>{pro ? t('examGo') : <><Icon n="lock" size={18} /> {t('unlockAll')}</>}</button>
        ) : me?.user ? (
          <button className="btn primary block" disabled={busy || bank().length < N} onClick={start}>{t('examGo')} · <CoinIcon size={18} /> {price}</button>
        ) : <a className="btn primary block" href={loginUrl()}>{t('login')}</a>}
        <p className="muted small">{APP ? (pro ? t('examNoTrans') : t('examLocked')) : me?.user ? t('examNoTrans') : t('loginHint')}</p>
      </div>
      {hist.length > 0 && (
        <div className="card">
          <h3>{t('history')}</h3>
          <ul className="hist">
            {hist.map((h) => (
              <li key={h.ts}><span>{new Date(h.ts).toLocaleDateString()}</span><b>{h.score}/{h.total}</b><span className={h.passed ? 'ok' : 'no'}>{h.passed ? t('passed') : t('failed')}</span></li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
