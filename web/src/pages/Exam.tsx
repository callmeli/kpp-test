/* 模拟考试：和 JPJ 电脑考试一样 50 题 / 45 分钟 / 42 题及格；每场扣幸运币，开考时扣（同一 nonce 不重扣） */
import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { addWrong, api, bank, load, nonce, Q, qById, save } from '../lib';
import { QuestionView } from '../Question';
import { CoinIcon, CoinPill, confirmBox, LoginCard, Seg, toast, useApp, useSpendError } from '../ui';
import { trackExam } from '../utils/analytics';

const N = 50, MIN = 45, PASS = 42;
type Run = { id: string; ids: string[]; ans: Record<string, string>; end: number; i: number };
type Done = { ids: string[]; ans: Record<string, string>; score: number; timeUp?: boolean };

/** 按三部分在题库里的比例抽题，保证每部分都有 */
function draw(): string[] {
  const all = bank(), out: string[] = [];
  for (const s of ['A', 'B', 'C'] as const) {
    const pool = all.filter((q) => q.s === s).map((q) => q.id);
    const k = Math.round((pool.length / all.length) * N);
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    out.push(...pool.slice(0, k));
  }
  return out.slice(0, N);
}
const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

export function Exam({ active }: { active: boolean }) {
  const { me, set, setSet, setCoins, refresh } = useApp();
  const onErr = useSpendError();
  const [run, setRun] = useState<Run | null>(() => load<Run | null>('exam', null));
  const [done, setDone] = useState<Done | null>(null);
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [hist, setHist] = useState<{ ts: number; score: number; total: number; passed: number }[]>([]);
  const finishing = useRef(false);

  useEffect(() => { save('exam', run); }, [run]);
  useEffect(() => { if (!run) return; const h = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(h); }, [run]);
  useEffect(() => { if (me?.user && active && !run) api('/exams').then((r) => setHist(r.list)).catch(() => {}); }, [me?.user, active, run, done]);

  const finish = async (r: Run, timeUp = false) => {
    if (finishing.current) return; finishing.current = true;
    const score = r.ids.filter((id) => r.ans[id] === qById(id)?.a).length;
    r.ids.forEach((id) => { const q = qById(id); if (q && r.ans[id] !== q.a && set.autoWrong) addWrong(id, r.ans[id] || ''); });
    setDone({ ids: r.ids, ans: r.ans, score, timeUp }); setRun(null); setReview(false);
    trackExam.submit(score, score >= PASS, r.ids.length);
    if (timeUp) toast(t('timeUp'));
    api('/exam/finish', { id: r.id, score, total: r.ids.length, passed: score >= PASS }).catch(() => {});
    finishing.current = false;
  };
  const left = run ? Math.max(0, Math.round((run.end - now) / 1000)) : 0;
  useEffect(() => { if (run && left <= 0) finish(run, true); }, [left, run]);   // eslint-disable-line react-hooks/exhaustive-deps

  const start = async () => {
    setBusy(true);
    const nn = load('examNonce', '') || nonce(); save('examNonce', nn);   // 网络重试用同一个 nonce，不会重复扣
    try {
      const r = await api<{ id: string; lc: number }>('/exam/start', { nonce: nn });
      save('examNonce', '');
      setCoins(r.lc);
      setDone(null);
      setRun({ id: r.id, ids: draw(), ans: {}, end: Date.now() + MIN * 60e3, i: 0 });
      trackExam.start(N, MIN);
      window.scrollTo({ top: 0 });
    } catch (e) { await onErr(e); refresh(); }
    setBusy(false);
  };

  /* ---------- 考试中 ---------- */
  if (run) {
    const q = qById(run.ids[run.i]) as Q, answered = Object.keys(run.ans).length;
    const setI = (i: number) => { setRun({ ...run, i }); window.scrollTo({ top: 0 }); };
    return (
      <div className="page exam-run">
        <header className="top">
          <button className="link" onClick={async () => { if (await confirmBox(t('examQuitAsk'), t('examQuit'), true)) { setRun(null); } }}>{t('examQuit')}</button>
          <span className={'timer' + (left < 300 ? ' warn' : '')}>⏱ {mmss(left)}</span>
          <button className="btn primary sm" onClick={async () => { const un = run.ids.length - answered; if (!un || (await confirmBox(t('examSubmitAsk', { n: un }), t('examSubmit')))) finish(run); }}>{t('examSubmit')}</button>
        </header>
        <div className="bar"><i style={{ width: `${(answered / run.ids.length) * 100}%` }} /></div>
        <div className="card q-card">
          <QuestionView q={q} picked={run.ans[q.id] || null} reveal={false} noTrans num={`${run.i + 1} / ${run.ids.length} · `}
            onPick={(l) => {
              const ans = { ...run.ans, [q.id]: l };
              setRun({ ...run, ans });
              if (run.i < run.ids.length - 1) setTimeout(() => setRun((r) => (r && r.i === run.i ? { ...r, i: r.i + 1 } : r)), 280);
            }} />
        </div>
        <nav className="pager">
          <button className="btn ghost" disabled={run.i === 0} onClick={() => setI(run.i - 1)}>{t('prev')}</button>
          <span className="pos">{answered}<small>/{run.ids.length}</small></span>
          <button className="btn ghost" disabled={run.i === run.ids.length - 1} onClick={() => setI(run.i + 1)}>{t('next')}</button>
        </nav>
        <div className="grid-nums">
          {run.ids.map((id, k) => <button key={id} className={(run.ans[id] ? 'a' : '') + (k === run.i ? ' cur' : '')} onClick={() => setI(k)}>{k + 1}</button>)}
        </div>
      </div>
    );
  }

  /* ---------- 成绩 ---------- */
  if (done) {
    const pass = done.score >= PASS, wrongIds = done.ids.filter((id) => done.ans[id] !== qById(id)?.a);
    return (
      <div className="page">
        <header className="top"><h1>{t('examTitle')}</h1><CoinPill /></header>
        <div className={'card result ' + (pass ? 'pass' : 'fail')}>
          <div className="big-score">{done.score}<small>/{done.ids.length}</small></div>
          <div className="badge">{pass ? t('passed') : t('failed')}</div>
          <p>{t('scoreLine', { c: done.score, t: done.ids.length, p: PASS })}</p>
          <div className="row2">
            {wrongIds.length > 0 && <button className="btn ghost" onClick={() => setReview(!review)}>{t('reviewWrong')} ({wrongIds.length})</button>}
            <button className="btn primary" onClick={() => { setDone(null); }}>{t('again')}</button>
          </div>
        </div>
        {review && wrongIds.map((id, k) => {
          const q = qById(id)!;
          return (
            <div className="card q-card" key={id}>
              <QuestionView q={q} picked={done.ans[id] || '-'} reveal onPick={() => {}} num={`${k + 1} · `} />
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
        <div className="hero-ic" aria-hidden="true">🚦</div>
        <p className="lead">{t('examRule', { q: N, m: MIN, p: PASS })}</p>
        <div className="field-row">
          <span>{t('examLang')}</span>
          <Seg value={set.ql} onChange={(v) => setSet({ ql: v })} items={[{ v: 'en', label: 'English' }, { v: 'ms', label: 'Bahasa Melayu' }]} />
        </div>
        <p className="muted small">{t('examNoTrans')} · {t('practiceFree')}</p>
        {me?.user ? (
          <button className="btn primary block lg" disabled={busy || bank().length < N} onClick={start}><CoinIcon size={18} /> {t('examStart', { n: price })}</button>
        ) : null}
      </div>
      {!me?.user && <LoginCard />}
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
