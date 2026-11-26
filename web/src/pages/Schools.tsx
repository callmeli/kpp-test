/* 驾校学费行情：大家晒实付价格。各州整体行情免费；某所驾校的逐条报价要解锁（晒过这所的自己免费看）；晒学费有奖励 */
import { useCallback, useEffect, useState } from 'react';
import { t } from '../i18n';
import { api, load, save } from '../lib';
import { CoinIcon, CoinPill, LoginCard, Sheet, toast, useApp, useSpendError } from '../ui';

type Stat = { cls: string; n: number; min: number; max: number; med: number };
type School = { id: string; name: string; state: string; city?: string; n: number; open: boolean; rating?: number | null; rn?: number };
type Comment = { id: number; name?: string; text: string; ts: number; mine: boolean };
const DURS = [1, 2, 3, 6, 12];
const Stars = ({ v }: { v: number }) => <span className="stars" aria-label={v + ' / 5'}>{'★'.repeat(Math.round(v))}<i>{'★'.repeat(5 - Math.round(v))}</i></span>;
type Detail = { school: School; n: number; open: boolean; price: number; stats?: Stat[]; rows?: { id: number; cls: string; price: number; ym?: string; incl: string[]; note?: string; ts: number; rating?: number | null; dur?: number | null; mine: boolean }[]; rating?: number | null; rn?: number; cn?: number; comments?: Comment[]; classes?: string[] };
const INCL = ['kpp01', 'ldl', 'jpj', 'retest', 'pickup', 'install'];
const rm = (n: number) => 'RM ' + n.toLocaleString('en-MY');

function Stats({ list }: { list: Stat[] }) {
  if (!list.length) return null;
  return (
    <div className="stats">
      {list.map((s) => (
        <div key={s.cls} className="stat">
          <div className="stat-h"><b>{t('cls_' + s.cls)}</b><span>{t('reports', { n: s.n })}</span></div>
          <div className="stat-v"><span>{t('median')}</span><strong>{rm(s.med)}</strong></div>
          <div className="range"><span>{rm(s.min)}</span><i /><span>{rm(s.max)}</span></div>
          {s.max - s.min >= 300 && <p className="hint">{t('spread', { n: (s.max - s.min).toLocaleString() })}</p>}
        </div>
      ))}
    </div>
  );
}

export function Schools({ active }: { active: boolean }) {
  const { me } = useApp();
  const [state, setState] = useState<string>(() => load('state', ''));
  const [qq, setQq] = useState('');
  const [data, setData] = useState<{ overall: Stat[]; list: School[] } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState<{ sid?: string } | null>(null);

  const reload = useCallback(() => {
    const p = new URLSearchParams(); if (state) p.set('state', state); if (qq.trim()) p.set('q', qq.trim());
    api('/schools?' + p).then(setData).catch(() => toast(t('err')));
  }, [state, qq]);
  useEffect(() => { save('state', state); }, [state]);
  useEffect(() => { if (!active) return; const h = setTimeout(reload, qq ? 300 : 0); return () => clearTimeout(h); }, [reload, active]);   // eslint-disable-line react-hooks/exhaustive-deps

  const econ = me?.econ;
  const canEarn = !!me?.user && (me.reportsLeft ?? 0) > 0;
  return (
    <div className="page">
      <header className="top"><h1>{t('schoolsTitle')}</h1><CoinPill /></header>
      <p className="lead">{t('schoolsWhy')}</p>
      <div className="filters">
        <select className="input" value={state} onChange={(e) => setState(e.target.value)} aria-label={t('state')}>
          <option value="">{t('allStates')}</option>
          {(me?.states || []).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <input className="input" placeholder={t('searchSchool')} value={qq} onChange={(e) => setQq(e.target.value)} />
      </div>

      <button className="btn secondary block" onClick={() => setForm({})}>
        {canEarn ? <><CoinIcon size={18} /> {t('shareMine', { n: econ!.report })}</> : t('shareMineNoReward')}
      </button>

      {data && data.overall.length > 0 && (
        <div className="card">
          <h3>{t('overall', { s: state || t('allStates') })}</h3>
          <Stats list={data.overall} />
        </div>
      )}

      {data && (data.list.length ? (
        <ul className="school-list">
          {data.list.map((s) => (
            <li key={s.id}>
              <button onClick={() => setOpen(s.id)}>
                <span className="sn">{s.name}</span>
                <span className="sm">{s.city ? s.city + ', ' : ''}{s.state}</span>
                <span className="sr">{s.rating ? <><b className="star">★</b> {s.rating.toFixed(1)} · </> : null}{t('reports', { n: s.n })}{s.open ? ' · ✓' : ''}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : <div className="card empty"><p>{t('noSchools')}</p></div>)}

      <SchoolSheet id={open} onClose={() => setOpen(null)} onShare={(sid) => { setOpen(null); setForm({ sid }); }} />
      <PriceForm open={!!form} sid={form?.sid} schools={data?.list || []} onClose={() => setForm(null)} onDone={() => { setForm(null); reload(); }} />
    </div>
  );
}

function SchoolSheet({ id, onClose, onShare }: { id: string | null; onClose: () => void; onShare: (sid: string) => void }) {
  const { me, setCoins } = useApp();
  const onErr = useSpendError();
  const [d, setD] = useState<Detail | null>(null);
  const [busy, setBusy] = useState(false);
  const get = useCallback(() => { if (id) api<Detail>('/schools/' + id).then(setD).catch(() => toast(t('err'))); }, [id]);
  useEffect(() => { setD(null); get(); }, [get]);
  const unlock = async () => {
    setBusy(true);
    try { const r = await api<{ lc: number }>('/unlock', { item: 'school:' + id }); setCoins(r.lc); get(); }
    catch (e) { await onErr(e); }
    setBusy(false);
  };
  const [cmt, setCmt] = useState('');
  const sendCmt = async () => {
    setBusy(true);
    try { await api('/schools/' + id + '/comments', { text: cmt.trim() }); setCmt(''); toast(t('fThanks')); get(); }
    catch (e) { await onErr(e); }
    setBusy(false);
  };
  const med = d?.stats?.[0]?.med;
  return (
    <Sheet open={!!id} onClose={onClose} title={d ? d.school.name : '…'}>
      {d && (
        <>
          <p className="muted">{d.school.city ? d.school.city + ', ' : ''}{d.school.state} · {t('reports', { n: d.n })}</p>
          {d.rating ? <p className="rating-line"><Stars v={d.rating} /> <b>{d.rating.toFixed(1)}</b> <span className="muted small">{t('ratedBy', { n: d.rn || 0 })}</span></p> : null}
          {d.open ? (
            <>
              <Stats list={d.stats || []} />
              {med && <p className="hint strong">{t('bargain', { m: med.toLocaleString() })}</p>}
              <ul className="rows">
                {(d.rows || []).map((r) => (
                  <li key={r.id}>
                    <div><b>{rm(r.price)}</b> · {t('cls_' + r.cls)}{r.mine && <span className="tag">{t('mine')}</span>}</div>
                    <div className="muted small">{r.ym || new Date(r.ts).toISOString().slice(0, 7)}{r.incl.length ? ' · ' + r.incl.map((x) => t('incl_' + x)).join(' / ') : ''}</div>
                    {(r.rating || r.dur) && <div className="small">{r.rating ? <Stars v={r.rating} /> : null}{r.dur ? <span className="muted"> {t('durGot', { d: t('dur_' + r.dur) })}</span> : null}</div>}
                    {r.note && <p className="note">{r.note}</p>}
                  </li>
                ))}
              </ul>
              <h3 className="sub-h">{t('cmtTitle')}{d.comments?.length ? ` · ${d.comments.length}` : ''}</h3>
              {(d.comments || []).length === 0 && <p className="muted small">{t('cmtEmpty')}</p>}
              <ul className="rows cmts">
                {(d.comments || []).map((c) => (
                  <li key={c.id}><p>{c.text}</p><div className="muted small">{c.name || '—'} · {new Date(c.ts).toISOString().slice(0, 10)}{c.mine && <span className="tag">{t('mine')}</span>}</div></li>
                ))}
              </ul>
              {me?.user && (
                <div className="cmt-box">
                  <textarea className="input" rows={2} maxLength={400} placeholder={t('cmtPh')} value={cmt} onChange={(e) => setCmt(e.target.value)} />
                  <button className="btn secondary sm" disabled={busy || cmt.trim().length < 4} onClick={sendCmt}>{t('cmtSend')}</button>
                </div>
              )}
            </>
          ) : (
            <div className="locked">
              {d.classes && d.classes.length > 0 && <p className="chips">{d.classes.map((c) => <span key={c} className="chip">{t('cls_' + c)}</span>)}</p>}
              <div className="blur" aria-hidden="true"><b>RM 2,8██</b><b>RM 4,1██</b><b>RM 3,3██</b></div>
              <p>{t('schoolLocked')}{d.cn ? ' · ' + t('cmtCount', { n: d.cn }) : ''}</p>
              {me?.user ? <button className="btn primary block" disabled={busy || !d.n} onClick={unlock}><CoinIcon size={18} /> {t('unlockSchool', { n: d.price })}</button> : <LoginCard />}
            </div>
          )}
          <button className="btn secondary block" onClick={() => onShare(d.school.id)}>{t('shareMineNoReward')}</button>
        </>
      )}
    </Sheet>
  );
}

function PriceForm({ open, sid, schools, onClose, onDone }: { open: boolean; sid?: string; schools: School[]; onClose: () => void; onDone: () => void }) {
  const { me, setCoins, refresh } = useApp();
  const onErr = useSpendError();
  const [name, setName] = useState(''), [st, setSt] = useState(''), [city, setCity] = useState('');
  const [cls, setCls] = useState('DA'), [price, setPrice] = useState(''), [ym, setYm] = useState(new Date().toISOString().slice(0, 7));
  const [incl, setIncl] = useState<string[]>(['kpp01', 'ldl', 'jpj']), [note, setNote] = useState(''), [busy, setBusy] = useState(false);
  const [rating, setRating] = useState(0), [dur, setDur] = useState(0);
  useEffect(() => {
    if (!open) return;
    const s = schools.find((x) => x.id === sid);
    setName(s ? s.name : ''); setSt(s ? s.state : load('state', '')); setCity(s?.city || '');
  }, [open, sid, schools]);
  if (!me?.user) return <Sheet open={open} onClose={onClose} title={t('formTitle')}><LoginCard /></Sheet>;
  const p = Number(price), ok = name.trim().length >= 3 && !!st && p >= 200 && p <= 20000;
  const submit = async () => {
    setBusy(true);
    try {
      const match = schools.find((x) => x.name.toLowerCase() === name.trim().toLowerCase() && x.state === st);
      const id = match ? match.id : (await api<{ id: string }>('/schools', { name: name.trim(), state: st, city })).id;
      const r = await api<{ gained: number; lc: number }>('/prices', { sid: id, cls, price: p, ym, incl, note, rating: rating || null, dur: dur || null });
      setCoins(r.lc); toast(r.gained ? t('fGained', { n: r.gained }) : t('fThanks'));
      refresh(); onDone(); setPrice(''); setNote('');
    } catch (e) { await onErr(e); }
    setBusy(false);
  };
  return (
    <Sheet open={open} onClose={onClose} title={t('formTitle')}>
      <label className="field">{t('fSchool')}
        <input className="input" list="schools-dl" placeholder={t('fSchoolPick')} value={name} maxLength={60} onChange={(e) => {
          setName(e.target.value);
          const m = schools.find((x) => x.name === e.target.value); if (m) { setSt(m.state); setCity(m.city || ''); }
        }} />
        <datalist id="schools-dl">{schools.map((s) => <option key={s.id} value={s.name}>{s.state}</option>)}</datalist>
      </label>
      <div className="row2">
        <label className="field">{t('state')}
          <select className="input" value={st} onChange={(e) => setSt(e.target.value)}><option value="">—</option>{me.states.map((s) => <option key={s}>{s}</option>)}</select>
        </label>
        <label className="field">{t('fCity')}<input className="input" value={city} maxLength={40} onChange={(e) => setCity(e.target.value)} /></label>
      </div>
      <label className="field">{t('fClass')}
        <div className="chips">{me.classes.map((c) => <button key={c} className={'chip' + (cls === c ? ' on' : '')} onClick={() => setCls(c)}>{t('cls_' + c)}</button>)}</div>
      </label>
      <div className="row2">
        <label className="field">{t('fPrice')}<input className="input" type="number" inputMode="numeric" placeholder="3200" value={price} onChange={(e) => setPrice(e.target.value)} /></label>
        <label className="field">{t('fYm')}<input className="input" type="month" value={ym} onChange={(e) => setYm(e.target.value)} /></label>
      </div>
      <label className="field">{t('fIncl')}
        <div className="chips">{INCL.map((x) => <button key={x} className={'chip' + (incl.includes(x) ? ' on' : '')} onClick={() => setIncl(incl.includes(x) ? incl.filter((y) => y !== x) : [...incl, x])}>{t('incl_' + x)}</button>)}</div>
      </label>
      <div className="field">{t('fRating')}
        <div className="star-pick" role="radiogroup">{[1, 2, 3, 4, 5].map((n) => <button key={n} role="radio" aria-checked={rating === n} aria-label={n + ' / 5'} className={n <= rating ? 'on' : ''} onClick={() => setRating(rating === n ? 0 : n)}>★</button>)}</div>
      </div>
      <div className="field">{t('fDur')}
        <div className="chips">{DURS.map((x) => <button key={x} className={'chip' + (dur === x ? ' on' : '')} onClick={() => setDur(dur === x ? 0 : x)}>{t('dur_' + x)}</button>)}</div>
      </div>
      <label className="field">{t('fNote')}<textarea rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} /></label>
      <p className="muted small">{t('fReward', { n: me.econ.report, c: me.econ.reportCap, l: me.reportsLeft ?? 0 })}</p>
      <button className="btn primary block" disabled={!ok || busy} onClick={submit}>{t('fSend')}</button>
    </Sheet>
  );
}
