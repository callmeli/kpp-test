/* KPP 驾考刷题（kpp.luckylab.cc）：静态前端（web/dist）+ 接口（/api/*）
 * - 题库在 D1（表 q），首次请求 / 题库版本升级时由 worker/bank.json 导入；管理员采纳纠错后直接改库，不用重新部署。
 * - 账号用 LuckyLab（luckylab.cc 的 Cookie lk_s，经 env.PAY 的 RPC session() 读取），本应用不建自己的账号表、不发令牌。
 * - 幸运币：全在 LuckyLab 平台（env.PAY.coinSpend / coinCredit / coinWallet）。刷题免费；模拟考试、错题集、驾校行情、打赏扣币。
 */
import SEED from './bank.json';
import { ltRun, lt, ltProxy } from './lt.js';
import { robots, sitemap, homePage } from './seo.js';

const APP = 'kpp';
const CANON_HOST = 'kpp.luckylab.cc';
// 价格（幸运币）。前端从 /api/me 读同一份
export const ECON = {
  exam: 20,          // 每场模拟考试
  wrong: 50,         // 错题集永久解锁
  school: 20,        // 解锁一所驾校的全部报价
  report: 30,        // 提交一条驾校报价的奖励（每校一次，每人最多 REPORT_CAP 次）
  reportCap: 3,
  fix: 20,           // 纠错被采纳的奖励
  tips: [10, 30, 66],
};
const STATES = ['Johor', 'Kedah', 'Kelantan', 'Melaka', 'Negeri Sembilan', 'Pahang', 'Perak', 'Perlis', 'Pulau Pinang', 'Sabah', 'Sarawak', 'Selangor', 'Terengganu', 'Kuala Lumpur', 'Putrajaya', 'Labuan'];
const CLASSES = ['D', 'DA', 'B2', 'B', 'BD'];   // D 手动挡汽车 · DA 自动挡汽车 · B2 ≤250cc 摩托 · B 全排量摩托 · BD 摩托 + 汽车套餐

const json = (d, s = 200, h = {}) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...h } });
const bad = (error, s = 400, extra = {}) => json({ ok: false, error, ...extra }, s);
const rid = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((x) => (x % 36).toString(36)).join('');
const clip = (s, n) => String(s ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);

/* ---------- 表结构（首次请求自动建） ---------- */
let schemaOk = false;
async function schema(db) {
  if (schemaOk) return;
  await db.batch([
    db.prepare('CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT)'),
    // 题库：data 是整题 JSON；src = seed（来自 bank.json）| admin（后台改过，导入新版 bank.json 时不覆盖）
    db.prepare('CREATE TABLE IF NOT EXISTS q (id TEXT PRIMARY KEY, ord INTEGER NOT NULL, sec TEXT NOT NULL, data TEXT NOT NULL, src TEXT NOT NULL DEFAULT \'seed\', active INTEGER NOT NULL DEFAULT 1, updated INTEGER NOT NULL)'),
    db.prepare('CREATE TABLE IF NOT EXISTS unlocks (uid TEXT NOT NULL, item TEXT NOT NULL, ts INTEGER NOT NULL, PRIMARY KEY (uid, item))'),
    db.prepare('CREATE TABLE IF NOT EXISTS wrong (uid TEXT NOT NULL, qid TEXT NOT NULL, ts INTEGER NOT NULL, ans TEXT, PRIMARY KEY (uid, qid))'),
    db.prepare('CREATE TABLE IF NOT EXISTS exams (id TEXT PRIMARY KEY, uid TEXT NOT NULL, ts INTEGER NOT NULL, done INTEGER, score INTEGER, total INTEGER, passed INTEGER)'),
    db.prepare('CREATE INDEX IF NOT EXISTS exams_uid ON exams (uid, ts)'),
    db.prepare('CREATE TABLE IF NOT EXISTS schools (id TEXT PRIMARY KEY, name TEXT NOT NULL, state TEXT NOT NULL, city TEXT, uid TEXT, ts INTEGER NOT NULL, hidden INTEGER NOT NULL DEFAULT 0)'),
    db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS schools_key ON schools (lower(name), state)'),
    // 报价：price 单位马币；ym = 报名年月（2026-11）；incl = 含哪些（JSON 数组）；rewarded = 发过奖励
    db.prepare('CREATE TABLE IF NOT EXISTS prices (id INTEGER PRIMARY KEY AUTOINCREMENT, sid TEXT NOT NULL, uid TEXT NOT NULL, cls TEXT NOT NULL, price INTEGER NOT NULL, ym TEXT, incl TEXT, note TEXT, ts INTEGER NOT NULL, rewarded INTEGER NOT NULL DEFAULT 0, hidden INTEGER NOT NULL DEFAULT 0)'),
    db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS prices_one ON prices (sid, uid, cls)'),
    db.prepare('CREATE TABLE IF NOT EXISTS reports (id INTEGER PRIMARY KEY AUTOINCREMENT, qid TEXT NOT NULL, uid TEXT, kind TEXT NOT NULL, suggest TEXT, note TEXT, lang TEXT, ts INTEGER NOT NULL, status TEXT NOT NULL DEFAULT \'open\')'),
    db.prepare('CREATE TABLE IF NOT EXISTS tips (ref TEXT PRIMARY KEY, uid TEXT NOT NULL, amount INTEGER NOT NULL, ts INTEGER NOT NULL)'),
  ]);
  // 后加的列：评分（1–5）、从报名到拿到驾照用了几个月（1 / 2 / 3 / 6 / 12 = 一个月内 … 半年以上）。老库没有就补上
  for (const col of ['rating INTEGER', 'dur INTEGER']) { try { await db.prepare('ALTER TABLE prices ADD COLUMN ' + col).run(); } catch (e) { /* 已有 */ } }
  // 学员补充：对某所驾校的文字补充（教练、排期、隐形收费……），解锁这所驾校的人能看
  await db.prepare('CREATE TABLE IF NOT EXISTS comments (id INTEGER PRIMARY KEY AUTOINCREMENT, sid TEXT NOT NULL, uid TEXT NOT NULL, name TEXT, text TEXT NOT NULL, ts INTEGER NOT NULL, hidden INTEGER NOT NULL DEFAULT 0)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS comments_sid ON comments (sid, ts)').run();
  schemaOk = true;
}
const kvGet = async (db, k) => ((await db.prepare('SELECT v FROM kv WHERE k = ?').bind(k).first()) || {}).v;
const kvSet = (db, k, v) => db.prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').bind(k, String(v)).run();

/* ---------- 题库 ---------- */
let seedOk = 0;
async function seed(db) {
  if (seedOk === SEED.v) return;
  const cur = Number(await kvGet(db, 'seed_v')) || 0;
  if (cur < SEED.v) {
    const now = Date.now(), st = [];
    SEED.qs.forEach((x, i) => {
      st.push(db.prepare(`INSERT INTO q (id, ord, sec, data, src, active, updated) VALUES (?1, ?2, ?3, ?4, 'seed', 1, ?5)
        ON CONFLICT(id) DO UPDATE SET ord = excluded.ord, sec = excluded.sec, data = excluded.data, updated = excluded.updated WHERE q.src = 'seed'`).bind(x.id, i, x.s, JSON.stringify(x), now));
    });
    // 新版题库里去掉的题（比如重复题）下线；后台改过的不动
    const ids = new Set(SEED.qs.map((x) => x.id));
    const all = await db.prepare("SELECT id FROM q WHERE src = 'seed' AND active = 1").all();
    for (const r of all.results) if (!ids.has(r.id)) st.push(db.prepare('UPDATE q SET active = 0, updated = ? WHERE id = ?').bind(now, r.id));
    for (let i = 0; i < st.length; i += 90) await db.batch(st.slice(i, i + 90));
    await kvSet(db, 'seed_v', SEED.v);
    await bumpBank(db);
  }
  seedOk = SEED.v;
}
async function bumpBank(db) { const v = (Number(await kvGet(db, 'bank_v')) || 0) + 1; await kvSet(db, 'bank_v', v); bankCache = null; return v; }
let bankCache = null;
async function bank(db) {
  const v = Number(await kvGet(db, 'bank_v')) || 0;
  if (bankCache && bankCache.v === v) return bankCache;
  const r = await db.prepare('SELECT data FROM q WHERE active = 1 ORDER BY ord').all();
  const qs = r.results.map((x) => JSON.parse(x.data));
  bankCache = { v, n: qs.length, body: JSON.stringify({ v, n: qs.length, qs }), ids: new Set(qs.map((x) => x.id)) };
  return bankCache;
}

/* ---------- 账号（LuckyLab） ---------- */
// 本地开发：没有 PAY 绑定且 DEV_LK=1 时，用 Cookie dev_uid 模拟登录，幸运币记在本地 kv
function devPay(env) {
  const db = env.DB, key = (u) => 'devcoin:' + u;
  const bal = async (u) => { const v = await kvGet(db, key(u)); return v === undefined ? 200 : Number(v); };
  return {
    async session(cookie) { const m = /(?:^|;\s*)dev_uid=([a-z0-9_]{2,24})/i.exec(cookie || ''); return m ? { id: 'dev_' + m[1], name: m[1], pks: 1 } : null; },
    async coinWallet(uid) { return { lc: await bal(uid) }; },
    async coinSpend({ uid, amount, ref }) {
      if (await kvGet(db, 'devref:' + ref)) return { ok: true, dup: true };
      const b = await bal(uid); if (b < amount) return { ok: false, error: 'not_enough', lc: b };
      await kvSet(db, key(uid), b - amount); await kvSet(db, 'devref:' + ref, 1); return { ok: true };
    },
    async coinCredit({ uid, amount, ref }) { if (await kvGet(db, 'devref:' + ref)) return { ok: true, dup: true }; await kvSet(db, key(uid), (await bal(uid)) + amount); await kvSet(db, 'devref:' + ref, 1); return { ok: true }; },
    async coinUndo({ uid, ref }) { return { ok: true }; },
    async link() { return true; },
  };
}
const pay = (env) => (env.DEV_LK === '1' ? devPay(env) : env.PAY || null);   // DEV_LK 只给本地测试用，线上不要配
async function who(env, req) {
  const p = pay(env);
  if (!p) return null;
  try { return await p.session(req.headers.get('cookie') || ''); } catch (e) { console.error('lk session', e); return null; }
}
async function balance(env, uid) { try { return (await pay(env).coinWallet(uid)).lc; } catch (e) { console.error('coinWallet', e); return null; } }
async function spend(env, uid, amount, item, ref) {
  const r = await pay(env).coinSpend({ uid, app: APP, item, amount, ref: 'kpp:' + ref });
  lt(r && r.ok ? 'coin_spend' : 'coin_short', uid, { item: String(item).split(':')[0], cost: amount });   // 幸运币花在哪 / 哪里不够
  return { ...r, lc: await balance(env, uid) };
}
const isAdmin = (env, me) => !!me && String(env.ADMIN_UIDS || '').split(',').map((s) => s.trim()).filter(Boolean).includes(me.id);

async function unlocked(db, uid) {
  const r = await db.prepare('SELECT item FROM unlocks WHERE uid = ?').bind(uid).all();
  return r.results.map((x) => x.item);
}
/** 解锁（扣一次币，之后永久有效）。返回 { ok, lc, dup } */
async function unlock(env, me, item, price) {
  const db = env.DB;
  if (await db.prepare('SELECT 1 FROM unlocks WHERE uid = ? AND item = ?').bind(me.id, item).first()) return { ok: true, dup: true, lc: await balance(env, me.id) };
  const r = await spend(env, me.id, price, item, 'unlock:' + me.id + ':' + item);
  if (!r.ok) return r;
  await db.prepare('INSERT OR IGNORE INTO unlocks (uid, item, ts) VALUES (?, ?, ?)').bind(me.id, item, Date.now()).run();
  lt('unlock', me.id, { item: item.split(':')[0], price });
  return { ok: true, lc: r.lc };
}

/* ---------- 驾校行情 ---------- */
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };
function stats(rows) {
  const by = {};
  for (const r of rows) (by[r.cls] = by[r.cls] || []).push(r.price);
  return Object.entries(by).map(([cls, p]) => ({ cls, n: p.length, min: Math.min(...p), max: Math.max(...p), med: median(p) }));
}

async function api(env, req, url, ctx) {
  const db = env.DB, path = url.pathname.slice(4), m = req.method;
  await schema(db);
  await seed(db);
  const body = m === 'POST' ? await req.json().catch(() => ({})) : {};

  if (path === '/bank') {
    const b = await bank(db);
    const etag = `"b${b.v}"`;
    if (req.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers: { etag } });
    // 带 ?v= 的地址内容不会变，可以长缓存；不带的短缓存
    const cc = url.searchParams.get('v') === String(b.v) ? 'public, max-age=31536000, immutable' : 'public, max-age=60';
    return new Response(b.body, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': cc, etag } });
  }

  const me = await who(env, req);

  if (path === '/me') {
    const b = await bank(db);
    const out = { ok: true, bankV: b.v, bankN: b.n, econ: ECON, states: STATES, classes: CLASSES, lk: !!pay(env), user: null };
    if (me) {
      out.user = { id: me.id, name: me.name, admin: isAdmin(env, me) };
      out.coins = await balance(env, me.id);
      out.unlocks = await unlocked(db, me.id);
      const w = await db.prepare('SELECT COUNT(*) n FROM wrong WHERE uid = ?').bind(me.id).first();
      out.wrongN = w.n;
      const rw = await db.prepare('SELECT COUNT(*) n FROM prices WHERE uid = ? AND rewarded = 1').bind(me.id).first();
      out.reportsLeft = Math.max(0, ECON.reportCap - rw.n);
      // 埋点：这个 LuckyLab 账号第一次用驾考 = signup（埋点上线前就用过的老用户，有 linked 记录的，不算新用户）
      const seen = await db.prepare('INSERT OR IGNORE INTO kv (k, v) VALUES (?, ?)').bind('seen:' + me.id, String(Date.now())).run();
      if (seen.meta && seen.meta.changes && !(await kvGet(db, 'linked:' + me.id))) lt('signup', me.id, { method: 'luckylab' });
      if (!(await kvGet(db, 'linked:' + me.id))) ctx.waitUntil(Promise.resolve(pay(env).link(me.id, APP)).then(() => kvSet(db, 'linked:' + me.id, 1)).catch(() => {}));
    }
    return json(out);
  }

  if (path === '/report' && m === 'POST') {   // 题目纠错：不用登录也能报（登录了采纳有奖励）
    const qid = clip(body.qid, 80), kind = ['answer', 'translation', 'image', 'other'].includes(body.kind) ? body.kind : 'other';
    if (!(await bank(db)).ids.has(qid)) return bad('bad_qid');
    const ip = req.headers.get('cf-connecting-ip') || '';
    const day = new Date().toISOString().slice(0, 10), lim = 'rl:' + (me ? me.id : ip) + ':' + day;
    const n = Number(await kvGet(db, lim)) || 0;
    if (n >= 30) return bad('too_many', 429);
    await kvSet(db, lim, n + 1);
    await db.prepare('INSERT INTO reports (qid, uid, kind, suggest, note, lang, ts) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(qid, me ? me.id : null, kind, clip(body.suggest, 4) || null, clip(body.note, 500) || null, clip(body.lang, 8) || null, Date.now()).run();
    return json({ ok: true });
  }

  if (path === '/schools' && m === 'GET') {
    const st = url.searchParams.get('state') || '', qq = clip(url.searchParams.get('q'), 40).toLowerCase();
    let sql = 'SELECT s.id, s.name, s.state, s.city, COUNT(p.id) n, MAX(p.ts) last, ROUND(AVG(p.rating), 1) rating, COUNT(p.rating) rn FROM schools s LEFT JOIN prices p ON p.sid = s.id AND p.hidden = 0 WHERE s.hidden = 0';
    const args = [];
    if (STATES.includes(st)) { sql += ' AND s.state = ?'; args.push(st); }
    if (qq) { sql += ' AND lower(s.name) LIKE ?'; args.push('%' + qq.replace(/[%_]/g, '') + '%'); }
    sql += ' GROUP BY s.id ORDER BY n DESC, last DESC LIMIT 200';
    const r = await db.prepare(sql).bind(...args).all();
    const un = new Set(me ? await unlocked(db, me.id) : []);
    // 各州整体行情免费看（只给区间和中位数），具体某所驾校的报价要解锁
    const all = await db.prepare('SELECT p.cls, p.price FROM prices p JOIN schools s ON s.id = p.sid WHERE p.hidden = 0 AND s.hidden = 0' + (STATES.includes(st) ? ' AND s.state = ?' : '')).bind(...(STATES.includes(st) ? [st] : [])).all();
    return json({ ok: true, overall: stats(all.results), list: r.results.map((x) => ({ ...x, open: un.has('school:' + x.id) })) });
  }

  if (path.startsWith('/schools/') && m === 'GET') {
    const sid = path.slice(9);
    const s = await db.prepare('SELECT id, name, state, city FROM schools WHERE id = ? AND hidden = 0').bind(sid).first();
    if (!s) return bad('not_found', 404);
    const rows = (await db.prepare('SELECT id, uid, cls, price, ym, incl, note, ts, rating, dur FROM prices WHERE sid = ? AND hidden = 0 ORDER BY ts DESC').bind(sid).all()).results;
    const mine = me ? rows.filter((x) => x.uid === me.id) : [];
    const open = me && (mine.length || (await db.prepare('SELECT 1 FROM unlocks WHERE uid = ? AND item = ?').bind(me.id, 'school:' + sid).first()));
    const rated = rows.filter((x) => x.rating);
    // 评分免费看；逐条报价、用时、补充内容要解锁
    const out = { ok: true, school: s, n: rows.length, open: !!open, price: ECON.school, rating: rated.length ? Math.round((rated.reduce((a, x) => a + x.rating, 0) / rated.length) * 10) / 10 : null, rn: rated.length };
    const cn = await db.prepare('SELECT COUNT(*) n FROM comments WHERE sid = ? AND hidden = 0').bind(sid).first();
    out.cn = cn.n;
    if (open) {
      out.stats = stats(rows);
      out.rows = rows.map((x) => ({ id: x.id, cls: x.cls, price: x.price, ym: x.ym, incl: JSON.parse(x.incl || '[]'), note: x.note, ts: x.ts, rating: x.rating, dur: x.dur, mine: !!me && x.uid === me.id }));
      const cs = await db.prepare('SELECT id, uid, name, text, ts FROM comments WHERE sid = ? AND hidden = 0 ORDER BY ts DESC LIMIT 100').bind(sid).all();
      out.comments = cs.results.map((c) => ({ id: c.id, name: c.name, text: c.text, ts: c.ts, mine: !!me && c.uid === me.id }));
    } else out.classes = [...new Set(rows.map((x) => x.cls))];
    return json(out);
  }

  // 以下都要登录
  if (!me) return bad('login_required', 401);

  if (path === '/wrong' && m === 'GET') {
    const r = await db.prepare('SELECT qid, ts, ans FROM wrong WHERE uid = ? ORDER BY ts DESC').bind(me.id).all();
    const un = (await unlocked(db, me.id)).includes('wrong');
    // 没解锁只给数量，题目列表要解锁
    return json({ ok: true, open: un, n: r.results.length, list: un ? r.results : [] });
  }
  if (path === '/wrong' && m === 'POST') {   // 记错题免费（同步本机记录）；删除 / 清空也免费
    const ids = (await bank(db)).ids, now = Date.now(), st = [];
    for (const x of (Array.isArray(body.add) ? body.add : []).slice(0, 500)) {
      const qid = clip(x && x.qid, 80); if (!ids.has(qid)) continue;
      st.push(db.prepare('INSERT INTO wrong (uid, qid, ts, ans) VALUES (?, ?, ?, ?) ON CONFLICT(uid, qid) DO UPDATE SET ts = excluded.ts, ans = excluded.ans').bind(me.id, qid, Number(x.ts) || now, clip(x.ans, 2) || null));
    }
    for (const q of (Array.isArray(body.del) ? body.del : []).slice(0, 500)) st.push(db.prepare('DELETE FROM wrong WHERE uid = ? AND qid = ?').bind(me.id, clip(q, 80)));
    if (body.clear) st.push(db.prepare('DELETE FROM wrong WHERE uid = ?').bind(me.id));
    for (let i = 0; i < st.length; i += 90) await db.batch(st.slice(i, i + 90));
    const n = await db.prepare('SELECT COUNT(*) n FROM wrong WHERE uid = ?').bind(me.id).first();
    return json({ ok: true, n: n.n });
  }

  if (path === '/unlock' && m === 'POST') {
    const item = String(body.item || '');
    if (item === 'wrong') { const r = await unlock(env, me, 'wrong', ECON.wrong); return r.ok ? json(r) : bad(r.error || 'not_enough', 402, { lc: r.lc, need: ECON.wrong }); }
    if (item.startsWith('school:')) {
      const sid = item.slice(7);
      if (!(await db.prepare('SELECT 1 FROM schools WHERE id = ? AND hidden = 0').bind(sid).first())) return bad('not_found', 404);
      const r = await unlock(env, me, item, ECON.school); return r.ok ? json(r) : bad(r.error || 'not_enough', 402, { lc: r.lc, need: ECON.school });
    }
    return bad('bad_item');
  }

  if (path === '/exam/start' && m === 'POST') {
    // 同一个 nonce 只扣一次（网络重试不重扣）
    const nonce = clip(body.nonce, 32).replace(/[^a-z0-9]/gi, '') || rid(12);
    const id = 'e' + me.id.slice(-8) + nonce;
    const ex = await db.prepare('SELECT id FROM exams WHERE id = ? AND uid = ?').bind(id, me.id).first();
    if (ex) return json({ ok: true, id, lc: await balance(env, me.id), dup: true });
    const r = await spend(env, me.id, ECON.exam, 'exam', 'exam:' + id);
    if (!r.ok) return bad(r.error || 'not_enough', 402, { lc: r.lc, need: ECON.exam });
    await db.prepare('INSERT OR IGNORE INTO exams (id, uid, ts) VALUES (?, ?, ?)').bind(id, me.id, Date.now()).run();
    lt('exam_start', me.id, { exam: id });
    return json({ ok: true, id, lc: r.lc });
  }
  if (path === '/exam/finish' && m === 'POST') {
    const id = clip(body.id, 60), total = Math.max(0, Math.min(100, Number(body.total) | 0)), score = Math.max(0, Math.min(total, Number(body.score) | 0));
    const fin = await db.prepare('UPDATE exams SET done = ?, score = ?, total = ?, passed = ? WHERE id = ? AND uid = ? AND done IS NULL').bind(Date.now(), score, total, body.passed ? 1 : 0, id, me.id).run();
    if (fin.meta && fin.meta.changes) lt('exam_finish', me.id, { exam: id, score, total, passed: !!body.passed });
    return json({ ok: true });
  }
  if (path === '/exams' && m === 'GET') {
    const r = await db.prepare('SELECT ts, score, total, passed FROM exams WHERE uid = ? AND done IS NOT NULL ORDER BY ts DESC LIMIT 30').bind(me.id).all();
    return json({ ok: true, list: r.results });
  }

  if (path === '/tip' && m === 'POST') {
    const amount = Number(body.amount) | 0;
    if (!ECON.tips.includes(amount)) return bad('bad_amount');
    const ref = 'tip:' + me.id + ':' + (clip(body.nonce, 24).replace(/[^a-z0-9]/gi, '') || rid(10));
    const r = await spend(env, me.id, amount, 'tip', ref);
    if (!r.ok) return bad(r.error || 'not_enough', 402, { lc: r.lc, need: amount });
    await db.prepare('INSERT OR IGNORE INTO tips (ref, uid, amount, ts) VALUES (?, ?, ?, ?)').bind(ref, me.id, amount, Date.now()).run();
    lt('tip', me.id, { amount });
    return json({ ok: true, lc: r.lc });
  }

  if (path === '/schools' && m === 'POST') {   // 新增驾校（报价时找不到就建）
    const name = clip(body.name, 60).replace(/\s+/g, ' '), state = String(body.state || ''), city = clip(body.city, 40);
    if (name.length < 3 || !STATES.includes(state)) return bad('bad_school');
    const old = await db.prepare('SELECT id FROM schools WHERE lower(name) = lower(?) AND state = ?').bind(name, state).first();
    if (old) return json({ ok: true, id: old.id, dup: true });
    const n = await db.prepare('SELECT COUNT(*) n FROM schools WHERE uid = ? AND ts > ?').bind(me.id, Date.now() - 86400e3).first();
    if (n.n >= 5) return bad('too_many', 429);
    const id = 's' + rid(10);
    await db.prepare('INSERT INTO schools (id, name, state, city, uid, ts) VALUES (?, ?, ?, ?, ?, ?)').bind(id, name, state, city || null, me.id, Date.now()).run();
    return json({ ok: true, id });
  }
  const cm = /^\/schools\/([a-z0-9]{2,20})\/comments$/.exec(path);
  if (cm && m === 'POST') {   // 学员补充：登录就能写，每人每天 5 条
    const sid = cm[1], text = clip(body.text, 400);
    if (text.length < 4) return bad('too_short');
    if (!(await db.prepare('SELECT 1 FROM schools WHERE id = ? AND hidden = 0').bind(sid).first())) return bad('not_found', 404);
    const n = await db.prepare('SELECT COUNT(*) n FROM comments WHERE uid = ? AND ts > ?').bind(me.id, Date.now() - 86400e3).first();
    if (n.n >= 5) return bad('too_many', 429);
    await db.prepare('INSERT INTO comments (sid, uid, name, text, ts) VALUES (?, ?, ?, ?, ?)').bind(sid, me.id, clip(me.name, 20), text, Date.now()).run();
    return json({ ok: true });
  }
  if (path === '/prices' && m === 'POST') {   // 晒学费：每人每校每种驾照一条（再交就覆盖）；每校第一次交给奖励，每人最多 reportCap 次
    const sid = clip(body.sid, 20), cls = String(body.cls || ''), price = Math.round(Number(body.price));
    if (!(await db.prepare('SELECT 1 FROM schools WHERE id = ? AND hidden = 0').bind(sid).first())) return bad('not_found', 404);
    if (!CLASSES.includes(cls)) return bad('bad_class');
    if (!(price >= 200 && price <= 20000)) return bad('bad_price');
    const ym = /^20\d\d-(0[1-9]|1[0-2])$/.test(body.ym || '') ? body.ym : null;
    const incl = JSON.stringify((Array.isArray(body.incl) ? body.incl : []).filter((x) => ['jpj', 'retest', 'kpp01', 'ldl', 'pickup', 'install'].includes(x)).slice(0, 6));
    const rating = [1, 2, 3, 4, 5].includes(Number(body.rating)) ? Number(body.rating) : null;
    const dur = [1, 2, 3, 6, 12].includes(Number(body.dur)) ? Number(body.dur) : null;
    await db.prepare(`INSERT INTO prices (sid, uid, cls, price, ym, incl, note, ts, rating, dur) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(sid, uid, cls) DO UPDATE SET price = excluded.price, ym = excluded.ym, incl = excluded.incl, note = excluded.note, ts = excluded.ts, rating = excluded.rating, dur = excluded.dur`)
      .bind(sid, me.id, cls, price, ym, incl, clip(body.note, 300) || null, Date.now(), rating, dur).run();
    let gained = 0;
    const already = await db.prepare('SELECT 1 FROM prices WHERE sid = ? AND uid = ? AND rewarded = 1').bind(sid, me.id).first();
    const cnt = await db.prepare('SELECT COUNT(*) n FROM prices WHERE uid = ? AND rewarded = 1').bind(me.id).first();
    if (!already && cnt.n < ECON.reportCap) {
      const up = await db.prepare('UPDATE prices SET rewarded = 1 WHERE sid = ? AND uid = ? AND cls = ? AND rewarded = 0').bind(sid, me.id, cls).run();
      if (up.meta.changes) {
        try { await pay(env).coinCredit({ uid: me.id, app: APP, kind: 'task', item: 'price_report', amount: ECON.report, ref: `kpp:price:${me.id}:${sid}` }); gained = ECON.report; }
        catch (e) { console.error('coinCredit', e); await db.prepare('UPDATE prices SET rewarded = 0 WHERE sid = ? AND uid = ? AND cls = ?').bind(sid, me.id, cls).run(); }
      }
    }
    return json({ ok: true, gained, lc: await balance(env, me.id) });
  }

  /* ---------- 管理员：纠错审核、隐藏不实报价 ---------- */
  if (path.startsWith('/admin/')) {
    if (!isAdmin(env, me)) return bad('forbidden', 403);
    if (path === '/admin/reports' && m === 'GET') {
      const r = await db.prepare("SELECT r.*, (SELECT COUNT(*) FROM reports x WHERE x.qid = r.qid AND x.status = 'open') same FROM reports r WHERE r.status = 'open' ORDER BY r.qid, r.ts LIMIT 200").all();
      return json({ ok: true, list: r.results });
    }
    if (path === '/admin/resolve' && m === 'POST') {
      // accept：可带 patch（{a:'B'} 改答案；{t:{zh:'…'}} 改题干；{o:{B:{zh:'…'}}} 改选项），同一题所有 open 的纠错一起关；给第一个报告的登录用户发奖励
      const rep = await db.prepare('SELECT * FROM reports WHERE id = ?').bind(Number(body.id) | 0).first();
      if (!rep) return bad('not_found', 404);
      if (body.action === 'accept' && body.patch) {
        const row = await db.prepare('SELECT data FROM q WHERE id = ?').bind(rep.qid).first();
        const d = JSON.parse(row.data), p = body.patch;
        if (p.a && d.o.some((o) => o.l === p.a)) d.a = p.a;
        if (p.t) d.t = { ...d.t, ...p.t };
        if (p.o) for (const o of d.o) if (p.o[o.l] && o.t) o.t = { ...o.t, ...p.o[o.l] };
        await db.prepare("UPDATE q SET data = ?, src = 'admin', updated = ? WHERE id = ?").bind(JSON.stringify(d), Date.now(), rep.qid).run();
        await bumpBank(db);
      }
      const st = body.action === 'accept' ? 'accepted' : 'rejected';
      const same = body.all === false ? [rep] : (await db.prepare("SELECT * FROM reports WHERE qid = ? AND status = 'open' AND kind = ?").bind(rep.qid, rep.kind).all()).results;
      await db.prepare(`UPDATE reports SET status = ? WHERE id IN (${same.map(() => '?').join(',')})`).bind(st, ...same.map((x) => x.id)).run();
      if (st === 'accepted') {
        const first = same.filter((x) => x.uid).sort((a, b) => a.ts - b.ts)[0];
        if (first) await pay(env).coinCredit({ uid: first.uid, app: APP, kind: 'task', item: 'fix_report', amount: ECON.fix, ref: 'kpp:fix:' + first.id }).catch((e) => console.error(e));
      }
      return json({ ok: true, closed: same.length });
    }
    if (path === '/admin/hide' && m === 'POST') {
      if (body.price) await db.prepare('UPDATE prices SET hidden = ? WHERE id = ?').bind(body.hide === false ? 0 : 1, Number(body.price) | 0).run();
      if (body.comment) await db.prepare('UPDATE comments SET hidden = ? WHERE id = ?').bind(body.hide === false ? 0 : 1, Number(body.comment) | 0).run();
      if (body.school) await db.prepare('UPDATE schools SET hidden = ? WHERE id = ?').bind(body.hide === false ? 0 : 1, clip(body.school, 20)).run();
      return json({ ok: true });
    }
  }
  return bad('not_found', 404);
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const ltp = await ltProxy(req, env, url);   // /lt/*：网页埋点转发（见 lt.js）
    if (ltp) return ltp;
    if (url.pathname.startsWith('/api/')) {
      try { return await ltRun(req, env, ctx, () => api(env, req, url, ctx)); }
      catch (e) { console.error(e); return bad('server_error', 500); }
    }
    // 本地开发假登录：/__devlogin?next=… 设 Cookie dev_uid（只在 DEV_LK=1 时可用，线上不要配）
    if (url.pathname === '/__devlogin' && env.DEV_LK === '1') {
      const next = url.searchParams.get('next') || '/';
      return new Response(null, { status: 302, headers: { location: next.startsWith('http://localhost') || next.startsWith('http://127.0.0.1') || next.startsWith('/') ? next : '/', 'set-cookie': 'dev_uid=tester; path=/; max-age=86400; samesite=lax' } });
    }
    // workers.dev 地址：LuckyLab 的登录 Cookie 只发给 *.luckylab.cc，在这里登录不了，网页一律转到正式地址（接口照常可用）
    if (url.hostname.endsWith('.workers.dev') && req.method === 'GET') return Response.redirect('https://' + CANON_HOST + url.pathname + url.search, 302);
    // 老的 GitHub Pages 路径 /KPP-Test/... → 根目录
    if (url.pathname.startsWith('/KPP-Test')) return Response.redirect(url.origin + (url.pathname.slice(9) || '/') + url.search, 301);
    // SEO：robots、sitemap、首页按语言写 <head>（见 seo.js）。对外地址固定用正式域名，本地 / 预览用当前域名
    if (req.method === 'GET') {
      const origin = url.hostname.endsWith('luckylab.cc') ? 'https://' + CANON_HOST : url.origin;
      if (url.pathname === '/robots.txt') return robots(origin);
      if (url.pathname === '/sitemap.xml') return sitemap(origin);
      if (url.pathname === '/' || url.pathname === '/index.html') return homePage(req, env, url, origin);
    }
    return env.ASSETS.fetch(req);
  },
};
