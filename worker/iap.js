/* ================= App 内购（iOS / Android）：服务端校验 + 解锁凭证 =================
 * App 版不用账号：一次买断「全部解锁」（商品 kpp_unlock_all，非消耗型），买完把商店给的凭据发到 POST /api/iap/verify：
 *   - Android：purchaseToken → Google Play Developer API（purchases.products.get），要服务账号（Secret GOOGLE_PLAY_SA，整段 JSON）
 *   - iOS：transactionId → App Store Server API（/inApps/v1/transactions/{id}），要 App 内购买项目密钥
 *          （Secret APPLE_IAP_KEY = .p8 文件内容；APPLE_IAP_KEY_ID、APPLE_ISSUER_ID）。先查正式环境，查不到再查沙盒（TestFlight / 审核用）
 * 校验通过就发一个解锁凭证（HMAC 签名，Secret IAP_SECRET），App 存在本机，之后每个 /api 请求带 x-kpp-ent 头；服务端认这个头 = 全部解锁。
 * 购买记录在 D1 的 iap 表（同一笔购买重复校验只记一次）。换手机 / 重装：App 里点「恢复购买」，商店把原来那笔给回来，再校验一次。
 * 已知的限制：退款后已经发出去的凭证不会自动失效（要接 Google 的实时开发者通知 / Apple 的服务器通知才能做到），金额小，先不做。
 */
export const APP_ID = 'cc.luckylab.kpp';            // Android 包名 = iOS Bundle ID
export const PRODUCT = 'kpp_unlock_all';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const GOOGLE_API = 'https://androidpublisher.googleapis.com';
const APPLE_API = 'https://api.storekit.itunes.apple.com';
const APPLE_SANDBOX = 'https://api.storekit-sandbox.itunes.apple.com';
// App 的网页来源：Android 上是 https://localhost，iOS 上是 capacitor://localhost（Capacitor 默认）
export const APP_ORIGINS = new Set(['https://localhost', 'capacitor://localhost']);

const enc = new TextEncoder();
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64uStr = (s) => b64u(enc.encode(s));
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const pemDer = (pem) => unb64u(String(pem).replace(/-----[^-]+-----/g, '').replace(/\\n/g, '').replace(/\s+/g, '').replace(/\+/g, '-').replace(/\//g, '_'));
const jwtPayload = (jws) => JSON.parse(new TextDecoder().decode(unb64u(String(jws).split('.')[1] || '')));

/** 测试时可以把商店接口指到本地模拟服务（只在 DEV_LK=1 时生效，线上配了也不认） */
const urls = (env) => {
  const dev = env.DEV_LK === '1';
  return {
    gToken: (dev && env.IAP_GOOGLE_TOKEN_URL) || GOOGLE_TOKEN, gApi: (dev && env.IAP_GOOGLE_API) || GOOGLE_API,
    aApi: (dev && env.IAP_APPLE_API) || APPLE_API, aSandbox: (dev && env.IAP_APPLE_SANDBOX_API) || APPLE_SANDBOX,
  };
};

async function signJwt(header, payload, key, alg) {
  const data = b64uStr(JSON.stringify(header)) + '.' + b64uStr(JSON.stringify(payload));
  const sig = await crypto.subtle.sign(alg, key, enc.encode(data));
  return data + '.' + b64u(sig);
}

/* ---------- Google Play ---------- */
let gTok = null;   // { token, exp, email }：同一个 Worker 实例里复用访问令牌（有效 1 小时）
async function googleToken(env) {
  const sa = typeof env.GOOGLE_PLAY_SA === 'string' ? JSON.parse(env.GOOGLE_PLAY_SA) : env.GOOGLE_PLAY_SA;
  const now = Math.floor(Date.now() / 1000);
  if (gTok && gTok.email === sa.client_email && gTok.exp > now + 60) return gTok.token;
  const u = urls(env);
  const key = await crypto.subtle.importKey('pkcs8', pemDer(sa.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const assertion = await signJwt({ alg: 'RS256', typ: 'JWT' },
    { iss: sa.client_email, scope: 'https://www.googleapis.com/auth/androidpublisher', aud: GOOGLE_TOKEN, iat: now, exp: now + 3600 }, key, 'RSASSA-PKCS1-v1_5');
  const r = await fetch(u.gToken, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + assertion });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error('google_token ' + r.status + ' ' + (j.error || ''));
  gTok = { token: j.access_token, exp: now + (j.expires_in || 3600), email: sa.client_email };
  return gTok.token;
}
/** 返回 { ok, key, env } 或 { ok:false, error } */
async function verifyGoogle(env, productId, token) {
  if (!env.GOOGLE_PLAY_SA) return { ok: false, error: 'iap_off' };
  const u = urls(env), pkg = env.APP_ID || APP_ID;
  const r = await fetch(`${u.gApi}/androidpublisher/v3/applications/${encodeURIComponent(pkg)}/purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(token)}`,
    { headers: { authorization: 'Bearer ' + (await googleToken(env)) } });
  if (r.status === 404 || r.status === 400 || r.status === 410) return { ok: false, error: 'not_found' };
  if (!r.ok) throw new Error('google_api ' + r.status);
  const p = await r.json();
  // purchaseState：0 已付款，1 已取消（含退款），2 待付款（比如便利店现金付款还没付）
  if (p.purchaseState === 2) return { ok: false, error: 'pending' };
  if (p.purchaseState !== 0) return { ok: false, error: 'canceled' };
  return { ok: true, key: 'android:' + (p.orderId || token.slice(0, 64)), env: p.purchaseType === 0 ? 'test' : 'prod' };
}

/* ---------- App Store ---------- */
let aKey = null;
async function appleJwt(env) {
  if (!aKey || aKey.src !== env.APPLE_IAP_KEY) aKey = { src: env.APPLE_IAP_KEY, key: await crypto.subtle.importKey('pkcs8', pemDer(env.APPLE_IAP_KEY), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']) };
  const now = Math.floor(Date.now() / 1000);
  return signJwt({ alg: 'ES256', kid: env.APPLE_IAP_KEY_ID, typ: 'JWT' },
    { iss: env.APPLE_ISSUER_ID, iat: now, exp: now + 1800, aud: 'appstoreconnect-v1', bid: env.APP_ID || APP_ID }, aKey.key, { name: 'ECDSA', hash: 'SHA-256' });
}
async function verifyApple(env, productId, txId) {
  if (!env.APPLE_IAP_KEY || !env.APPLE_IAP_KEY_ID || !env.APPLE_ISSUER_ID) return { ok: false, error: 'iap_off' };
  if (!/^\d{1,30}$/.test(txId)) return { ok: false, error: 'bad_token' };
  const u = urls(env), auth = { authorization: 'Bearer ' + (await appleJwt(env)) };
  let info = null;
  for (const base of [u.aApi, u.aSandbox]) {   // 正式环境查不到（404）再查沙盒：TestFlight 和审核员用的是沙盒
    const r = await fetch(`${base}/inApps/v1/transactions/${txId}`, { headers: auth });
    if (r.status === 404) continue;
    if (!r.ok) throw new Error('apple_api ' + r.status);
    info = jwtPayload((await r.json()).signedTransactionInfo);   // 直接从 Apple 接口取到的，HTTPS 已经保证来源，不再验签名链
    break;
  }
  if (!info) return { ok: false, error: 'not_found' };
  if (info.bundleId !== (env.APP_ID || APP_ID) || info.productId !== productId) return { ok: false, error: 'mismatch' };
  if (info.revocationDate) return { ok: false, error: 'canceled' };
  return { ok: true, key: 'ios:' + (info.originalTransactionId || info.transactionId), env: info.environment === 'Production' ? 'prod' : 'test' };
}

/* ---------- 解锁凭证 ---------- */
const hmacKey = (env) => crypto.subtle.importKey('raw', enc.encode(env.IAP_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
async function issue(env, p, key) {
  const body = b64uStr(JSON.stringify({ p, k: key, t: Date.now() }));
  return 'v1.' + body + '.' + b64u(await crypto.subtle.sign('HMAC', await hmacKey(env), enc.encode('v1.' + body)));
}
/** 请求带的 x-kpp-ent 有效 = 全部解锁 */
export async function entOf(env, req) {
  const t = req.headers.get('x-kpp-ent') || '';
  if (!t || !env.IAP_SECRET) return false;
  const [v, body, sig] = t.split('.');
  if (v !== 'v1' || !body || !sig) return false;
  try { return await crypto.subtle.verify('HMAC', await hmacKey(env), unb64u(sig), enc.encode('v1.' + body)); } catch (e) { return false; }
}

/** POST /api/iap/verify  { platform: 'android' | 'ios', productId, token } → { ok, ent } */
export async function iapVerify(env, req, body, db) {
  if (!env.IAP_SECRET) return { status: 503, body: { ok: false, error: 'iap_off' } };
  const platform = body.platform, productId = String(body.productId || ''), token = String(body.token || '').slice(0, 4096);
  if (productId !== PRODUCT) return { status: 400, body: { ok: false, error: 'bad_product' } };
  if (!token || !['android', 'ios'].includes(platform)) return { status: 400, body: { ok: false, error: 'bad_token' } };
  // 防刷：同一个 IP 每天最多 60 次
  const lim = 'iaprl:' + (req.headers.get('cf-connecting-ip') || '') + ':' + new Date().toISOString().slice(0, 10);
  const n = Number(((await db.prepare('SELECT v FROM kv WHERE k = ?').bind(lim).first()) || {}).v) || 0;
  if (n >= 60) return { status: 429, body: { ok: false, error: 'too_many' } };
  await db.prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').bind(lim, String(n + 1)).run();

  let r;
  try { r = platform === 'android' ? await verifyGoogle(env, productId, token) : await verifyApple(env, productId, token); }
  catch (e) { console.error('iap verify', e); return { status: 502, body: { ok: false, error: 'store_unavailable' } }; }
  if (!r.ok) return { status: r.error === 'iap_off' ? 503 : 402, body: { ok: false, error: r.error } };
  await db.prepare('CREATE TABLE IF NOT EXISTS iap (k TEXT PRIMARY KEY, platform TEXT NOT NULL, product TEXT NOT NULL, env TEXT, ts INTEGER NOT NULL, n INTEGER NOT NULL DEFAULT 1)').run();
  const ins = await db.prepare('INSERT INTO iap (k, platform, product, env, ts) VALUES (?, ?, ?, ?, ?) ON CONFLICT(k) DO UPDATE SET n = n + 1')
    .bind(r.key, platform, productId, r.env, Date.now()).run();
  return { status: 200, body: { ok: true, ent: await issue(env, platform, r.key), env: r.env }, first: !!(ins.meta && ins.meta.changes && r.env === 'prod') };
}

/** App 的跨域：只认 App 自己的来源，不带 Cookie */
export function cors(req) {
  const o = req.headers.get('origin');
  if (!o || !APP_ORIGINS.has(o)) return null;
  return { 'access-control-allow-origin': o, 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type, x-kpp-ent, x-lt-a, x-lt-s, x-lt-r', 'access-control-max-age': '86400', vary: 'origin' };
}
