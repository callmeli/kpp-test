import { ReactNode, useEffect, useState } from 'react';
import { t } from './i18n';
import { api, Q, tx, txOr } from './lib';
import { Icon, Sheet, toast, useApp } from './ui';

type Props = {
  q: Q;
  picked: string | null;
  reveal: boolean;              // 显示对错（刷题）；考试时 false
  noTrans?: boolean;            // 考试不显示翻译
  onPick: (l: string) => void;
  num?: string;
  onNum?: () => void;         // 点题号（刷题：跳题）
  nav?: ReactNode;            // 题号行右边的小按钮（刷题：上一题 / 下一题）
  keys?: boolean;             // 是否响应键盘（同一时间只有当前可见的那道题响应）
};

export function QuestionView({ q, picked, reveal, noTrans, onPick, num, onNum, nav, keys = true }: Props) {
  const { set } = useApp();
  const ql = set.ql, tr = noTrans || set.tr === ql ? 'off' : set.tr;
  const [zoom, setZoom] = useState<string | null>(null);
  const [rep, setRep] = useState(false);
  const imgOpts = q.o.some((o) => o.img);
  // 选项图片和题目图片是同一组时（「选出正确的标志」类题），只在选项里显示
  // 键盘：1 / 2 / 3 或 A / B / C 选答案（桌面）；输入框里打字不算
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement)?.closest?.('input,textarea,select,[role=dialog]')) return;
      const i = '123'.indexOf(e.key) >= 0 ? '123'.indexOf(e.key) : 'abc'.indexOf(e.key.toLowerCase());
      if (keys && i >= 0 && q.o[i] && !(reveal && picked)) { e.preventDefault(); onPick(q.o[i].l); }
    };
    addEventListener('keydown', k); return () => removeEventListener('keydown', k);
  }, [q, picked, reveal, onPick, keys]);
  const qImgs = (q.img || []).filter((p) => !(imgOpts && q.o.some((o) => o.img === p.replace('/questions/', '/options/'))) && !(imgOpts && (q.img || []).length === q.o.length));

  return (
    <div className={'qv' + (qImgs.length ? ' has-img' : '')}>
      <div className="q-main">
      <div className="q-head">
        <span className="q-sec">{num && (onNum ? <button onClick={onNum}>{num}</button> : <b>{num}</b>)}<span>{t('sec' + q.s)}</span></span>
        <span className="q-tools"><button className="link small" onClick={() => setRep(true)}>{t('report')}</button>{nav}</span>
      </div>
      <h2 className="q-text">{txOr(q.t, ql)}</h2>
      {tr !== 'off' && tx(q.t, tr) && <p className="q-tr">{tx(q.t, tr)}</p>}
      {qImgs.length > 0 && (
        <div className={'q-imgs n' + qImgs.length}>
          {qImgs.map((p) => <img key={p} src={p} alt="" onClick={() => setZoom(p)} />)}
        </div>
      )}
      </div>
      <div className="q-side">
      <div className={'opts' + (imgOpts ? ' img-opts' : '')}>
        {q.o.map((o) => {
          const st = reveal && picked ? (o.l === q.a ? 'right' : o.l === picked ? 'wrong' : 'dim') : picked === o.l ? 'sel' : '';
          return (
            <button key={o.l} className={'opt ' + st} onClick={() => onPick(o.l)} disabled={reveal && !!picked}>
              <kbd className="key">{'123'[q.o.indexOf(o)]}</kbd>
              <span className="opt-l">{st === 'right' ? <Icon n="check" size={16} /> : st === 'wrong' ? <Icon n="x" size={16} /> : o.l}</span>
              {o.img ? <img src={o.img} alt={'Option ' + o.l} /> : (
                <span className="opt-body">
                  <span>{txOr(o.t, ql)}</span>
                  {tr !== 'off' && tx(o.t, tr) && <small>{tx(o.t, tr)}</small>}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {reveal && picked && q.n && <p className="q-note">{txOr(q.n, set.ui)}</p>}
      </div>
      <Sheet open={!!zoom} onClose={() => setZoom(null)}>{zoom && <img className="zoom" src={zoom} alt="" onClick={() => setZoom(null)} />}</Sheet>
      <ReportSheet open={rep} onClose={() => setRep(false)} q={q} />
    </div>
  );
}

function ReportSheet({ open, onClose, q }: { open: boolean; onClose: () => void; q: Q }) {
  const { me, set } = useApp();
  const [kind, setKind] = useState('answer');
  const [sug, setSug] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      await api('/report', { qid: q.id, kind, suggest: kind === 'answer' ? sug : '', note, lang: set.ui });
      toast(me?.user ? t('rThanks', { n: me.econ.fix }) : t('rThanksAnon'));
      onClose(); setNote(''); setSug('');
    } catch { toast(t('err')); }
    setBusy(false);
  };
  return (
    <Sheet open={open} onClose={onClose} title={t('reportTitle')}>
      <div className="chips">
        {['answer', 'translation', 'image', 'other'].map((k) => (
          <button key={k} className={'chip' + (kind === k ? ' on' : '')} onClick={() => setKind(k)}>{t('r' + k[0].toUpperCase() + k.slice(1))}</button>
        ))}
      </div>
      {kind === 'answer' && (
        <label className="field">{t('rSuggest')}
          <div className="chips">{q.o.map((o) => <button key={o.l} className={'chip' + (sug === o.l ? ' on' : '')} onClick={() => setSug(o.l)}>{o.l}</button>)}</div>
        </label>
      )}
      <label className="field">{t('rNote')}<textarea rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></label>
      <button className="btn primary block" disabled={busy || (kind === 'answer' && !sug && !note)} onClick={send}>{t('rSend')}</button>
    </Sheet>
  );
}
