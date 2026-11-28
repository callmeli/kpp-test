/* 数据层：接口、题库（服务端下发 + 本机缓存）、本机进度、错题集同步 */
import { getLang, Lang } from './i18n';
import { ltHeaders } from './utils/analytics';

/* App 版（iOS / Android，npm run build:app 构建）：页面在手机里本地打开，接口跨域调 kpp.luckylab.cc；
 * 不用账号、不用幸运币，商店里买断「全部解锁」后带解锁凭证（x-kpp-ent 头，见 worker/iap.js） */
export const APP = import.meta.env.VITE_APP === '1';
const API_BASE = APP ? (import.meta.env.VITE_API_BASE ?? 'https://kpp.luckylab.cc') : '';   // VITE_API_BASE= （空）：测试时和接口同源
export const entToken = () => load<string>('ent', '');
/** App 里买断过（本机有服务端发的解锁凭证） */
export const isPro = () => APP && !!entToken();

export type TL = { en: string; zh?: string | null; ms?: string | null };
export type Opt = { l: string; t?: TL; img?: string };
export type Q = { id: string; s: 'A' | 'B' | 'C'; t: TL; o: Opt[]; a: string; img?: string[]; n?: TL };
export type Econ = { exam: number; wrong: number; school: number; report: number; reportCap: number; fix: number; tips: number[] };
export type Me = {
  bankV: number; bankN: number; econ: Econ; states: string[]; classes: string[]; lk: boolean;
  user: null | { id: string; name: string; admin: boolean }; ent?: boolean;
  coins?: number | null; unlocks?: string[]; wrongN?: number; reportsLeft?: number;
};

export class ApiError extends Error { status: number; code: string; data: any; constructor(s: number, c: string, d: any) { super(c); this.status = s; this.code = c; this.data = d; } }
export async function api<T = any>(path: string, body?: unknown): Promise<T> {
  // 带上埋点的设备 ID / 首次渠道（x-lt-*），服务端事件靠它和网页事件对上
  const h: Record<string, string> = { ...ltHeaders(), ...(APP && entToken() ? { 'x-kpp-ent': entToken() } : {}) };
  const credentials: RequestCredentials = APP ? 'omit' : 'include';   // App 里没有登录 Cookie，靠解锁凭证
  const r = await fetch(API_BASE + '/api' + path, body === undefined ? { credentials, headers: h } : { method: 'POST', credentials, headers: { 'content-type': 'application/json', ...h }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) throw new ApiError(r.status, j.error || 'error', j);
  return j as T;
}

/* ---------- 本机存储（读写都包 try：隐私模式下可能不可用） ---------- */
export function load<T>(k: string, d: T): T { try { const v = localStorage.getItem('kpp_' + k); return v === null ? d : JSON.parse(v); } catch { return d; } }
export function save(k: string, v: unknown) { try { localStorage.setItem('kpp_' + k, JSON.stringify(v)); } catch { /* 满了或不可用 */ } }

/* ---------- 题库 ---------- */
let BANK: Q[] = [];
let BY: Map<string, Q> = new Map();
export const bank = () => BANK;
export const qById = (id: string) => BY.get(id);
function setBank(qs: Q[]) { BANK = qs; BY = new Map(qs.map((q) => [q.id, q])); }
/** 按服务端版本号取题库：版本没变用本机缓存（离线也能刷），变了重新下 */
export async function loadBank(v?: number): Promise<Q[]> {
  const cached = load<{ v: number; qs: Q[] } | null>('bank', null);
  if (cached && (v === undefined || cached.v === v)) { setBank(cached.qs); return BANK; }
  try {
    const r = await fetch(API_BASE + '/api/bank' + (v ? '?v=' + v : ''));
    if (!r.ok) throw new Error('bank ' + r.status);
    const j = await r.json();
    setBank(j.qs);
    save('bank', { v: j.v, qs: j.qs });
  } catch (e) {
    if (cached) { setBank(cached.qs); return BANK; }
    if (!APP) throw e;
    // App 第一次打开就没网：用打包进 App 的那份题库（scripts/app-bank.mjs 构建时下载）
    const j = await (await fetch('/bank.json')).json();
    setBank(j.qs);
    save('bank', { v: j.v, qs: j.qs });
  }
  return BANK;
}

/** 题干 / 选项在某种语言下的文字（没有就回落英文） */
export const tx = (x: TL | undefined, l: Lang | 'off') => (x ? (l === 'off' ? '' : (x[l] || '')) : '');
export const txOr = (x: TL | undefined, l: Lang) => (x ? x[l] || x.en : '');

/* ---------- 设置 ---------- */
export type Settings = { ui: Lang; ql: 'en' | 'ms'; tr: Lang | 'off'; autoNext: boolean; autoWrong: boolean; sound: boolean };
export function defaultSettings(ui: Lang): Settings {
  // 题目默认英文（大部分华人考英文卷），界面是马来文就默认马来文卷；翻译默认跟界面语言
  const ql = ui === 'ms' ? 'ms' : 'en';
  return { ui, ql, tr: ui === ql ? 'off' : ui, autoNext: true, autoWrong: true, sound: true };
}

/* ---------- 进度：每题最近一次是否答对 ---------- */
export type Progress = Record<string, 0 | 1>;
export const getProgress = () => load<Progress>('prog', {});
export function mark(id: string, ok: boolean) { const p = getProgress(); p[id] = ok ? 1 : 0; save('prog', p); }

/* ---------- 错题集：本机一份，登录后同步到服务端 ---------- */
export type WrongItem = { qid: string; ts: number; ans?: string };
export const getWrong = () => load<WrongItem[]>('wrong', []);
export function addWrong(qid: string, ans: string) {
  const w = getWrong().filter((x) => x.qid !== qid);
  w.unshift({ qid, ts: Date.now(), ans });
  save('wrong', w);
  queue('add', { qid, ts: Date.now(), ans });
}
export function delWrong(qid: string) { save('wrong', getWrong().filter((x) => x.qid !== qid)); queue('del', qid); }
export function clearWrong() { save('wrong', []); save('wq', { add: [], del: [], clear: true }); flushWrong(); }
type WQ = { add: WrongItem[]; del: string[]; clear?: boolean };
function queue(kind: 'add' | 'del', v: any) {
  const q = load<WQ>('wq', { add: [], del: [] });
  if (kind === 'add') { q.add = q.add.filter((x) => x.qid !== v.qid).concat(v); q.del = q.del.filter((x) => x !== v.qid); }
  else { q.del = q.del.filter((x) => x !== v).concat(v); q.add = q.add.filter((x) => x.qid !== v); }
  save('wq', q);
  clearTimeout(flushT); flushT = setTimeout(flushWrong, 1500);
}
let flushT: ReturnType<typeof setTimeout> | undefined;
let loggedIn = false;
export const setLoggedIn = (v: boolean) => { loggedIn = v; };
/** 把本机没同步的错题推上去（没登录就先攒着，登录后第一次打开会把本机全部错题合并上去） */
export async function flushWrong() {
  if (!loggedIn) return;
  const q = load<WQ>('wq', { add: [], del: [] });
  if (!q.add.length && !q.del.length && !q.clear) return;
  try { await api('/wrong', q); save('wq', { add: [], del: [] }); } catch { /* 下次再推 */ }
}
/** 登录后：本机错题全部合并到服务端，再以服务端为准（解锁后才拿得到列表） */
export async function syncWrong(open: boolean) {
  if (!load('wmerged', false)) { const q = load<WQ>('wq', { add: [], del: [] }); q.add = [...getWrong(), ...q.add]; save('wq', q); }
  await flushWrong();
  save('wmerged', true);
  if (open) { const r = await api<{ list: WrongItem[] }>('/wrong'); save('wrong', r.list.filter((x) => BY.has(x.qid))); }
}

/* ---------- 打赏提醒：每刷 100 题，在其中随机一题之后提醒一次 ---------- */
export function countAnswer(): number | null {
  const n = load<number>('answered', 0) + 1;
  save('answered', n);
  const blk = Math.floor((n - 1) / 100);
  let at = load<Record<string, number>>('tipAt', {});
  if (at[blk] === undefined) { at = { [blk]: blk * 100 + 30 + Math.floor(Math.random() * 66) }; save('tipAt', at); }   // 30–95 题之间
  return n === at[blk] ? n : null;
}

// 登录只在 kpp.luckylab.cc 上有效（LuckyLab 的登录 Cookie 只发给 *.luckylab.cc）；workers.dev 等其他地址登录后回到正式地址。本机开发走假登录
const isLocal = () => /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
const canonHref = () => (location.hostname.endsWith('luckylab.cc') ? location.href : 'https://kpp.luckylab.cc' + location.pathname + location.search + location.hash);
export const loginUrl = () => (isLocal() ? '/__devlogin?next=' + encodeURIComponent(location.href) : 'https://luckylab.cc/login?next=' + encodeURIComponent(canonHref()));
export const walletUrl = () => 'https://luckylab.cc/wallet?next=' + encodeURIComponent(canonHref());
export const accountUrl = () => 'https://luckylab.cc/account?next=' + encodeURIComponent(canonHref());
export const nonce = () => Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
export const lang = getLang;

/* ---------- 音效（Web Audio 合成，不用素材） ---------- */
let ac: AudioContext | null = null;
export function beep(ok: boolean, on: boolean) {
  if (!on) return;
  try {
    ac = ac || new (window.AudioContext || (window as any).webkitAudioContext)();
    const o = ac.createOscillator(), g = ac.createGain(), t0 = ac.currentTime;
    o.type = 'sine';
    o.frequency.setValueAtTime(ok ? 880 : 220, t0);
    if (ok) o.frequency.setValueAtTime(1320, t0 + 0.08);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.12, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t0 + (ok ? 0.22 : 0.3));
    o.connect(g).connect(ac.destination); o.start(t0); o.stop(t0 + 0.32);
    if (!ok && navigator.vibrate) navigator.vibrate(60);
  } catch { /* 不支持就算了 */ }
}
