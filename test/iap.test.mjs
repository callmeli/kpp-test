/* App 内购校验的接口测试：起一个本地模拟的 Google Play / App Store 接口，再起本地 Worker，把整条流程走一遍。
 *   node test/iap.test.mjs          （要先 npm run build 出 web/dist；会自己起 wrangler dev，端口 8795 / 8796）
 * 模拟服务会真的校验 Worker 发来的 JWT 签名（Google 用 RS256，Apple 用 ES256），所以签名写错这里会失败。 */
import http from 'node:http';
import { generateKeyPairSync, createVerify, verify as cverify } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const MOCK = 8796, BASE = 'http://127.0.0.1:8795';
const PKG = 'cc.luckylab.kpp', PRODUCT = 'kpp_unlock_all';
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else { fail++; console.error('✗', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 400)); } };

/* ---------- 密钥 ---------- */
const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const pem = (k) => k.export({ type: 'pkcs8', format: 'pem' });
const SA = { type: 'service_account', client_email: 'kpp-iap@test.iam.gserviceaccount.com', private_key: pem(rsa.privateKey) };
const b64u = (s) => Buffer.from(s).toString('base64url');
const parts = (jwt) => jwt.split('.');
const jhead = (jwt) => JSON.parse(Buffer.from(parts(jwt)[0], 'base64url'));
const jbody = (jwt) => JSON.parse(Buffer.from(parts(jwt)[1], 'base64url'));
const rsOk = (jwt) => { const [h, p, s] = parts(jwt); const v = createVerify('RSA-SHA256'); v.update(h + '.' + p); return v.verify(rsa.publicKey, Buffer.from(s, 'base64url')); };
const esOk = (jwt) => { const [h, p, s] = parts(jwt); return cverify('sha256', Buffer.from(h + '.' + p), { key: ec.publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')); };
const fakeJws = (o) => b64u(JSON.stringify({ alg: 'ES256' })) + '.' + b64u(JSON.stringify(o)) + '.sig';

/* ---------- 模拟的 Google / Apple 接口 ---------- */
const seen = { gToken: 0, gApi: 0, aProd: 0, aSb: 0, badSig: 0 };
const server = http.createServer(async (req, res) => {
  const send = (s, o) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  let body = ''; for await (const c of req) body += c;
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/token' && req.method === 'POST') {
    seen.gToken++;
    const a = new URLSearchParams(body).get('assertion') || '';
    const b = jbody(a);
    if (!rsOk(a) || b.iss !== SA.client_email || !/androidpublisher/.test(b.scope)) { seen.badSig++; return send(400, { error: 'invalid_grant' }); }
    return send(200, { access_token: 'g-access', expires_in: 3600 });
  }
  const gm = u.pathname.match(/^\/androidpublisher\/v3\/applications\/([^/]+)\/purchases\/products\/([^/]+)\/tokens\/([^/]+)$/);
  if (gm) {
    seen.gApi++;
    if (req.headers.authorization !== 'Bearer g-access') return send(401, { error: 'unauthorized' });
    if (gm[1] !== PKG || gm[2] !== PRODUCT) return send(404, {});
    const tok = decodeURIComponent(gm[3]);
    if (tok === 'g-good') return send(200, { purchaseState: 0, orderId: 'GPA.1111-2222', purchaseType: 0, acknowledgementState: 1 });
    if (tok === 'g-pending') return send(200, { purchaseState: 2 });
    if (tok === 'g-refunded') return send(200, { purchaseState: 1, orderId: 'GPA.3333' });
    return send(404, { error: { code: 404 } });
  }
  const am = u.pathname.match(/^\/(apple|apple-sb)\/inApps\/v1\/transactions\/(\d+)$/);
  if (am) {
    const auth = (req.headers.authorization || '').replace(/^Bearer /, '');
    const h = jhead(auth), b = jbody(auth);
    if (process.env.DEBUG) console.error('apple jwt', h, b, esOk(auth));
    if (!esOk(auth) || h.kid !== 'KEYID123' || b.iss !== 'issuer-uuid' || b.aud !== 'appstoreconnect-v1' || b.bid !== PKG) { seen.badSig++; return send(401, {}); }
    const sb = am[1] === 'apple-sb', id = am[2];
    sb ? seen.aSb++ : seen.aProd++;
    const tx = {
      '2000000001': { env: 'prod', info: { bundleId: PKG, productId: PRODUCT, transactionId: '2000000001', originalTransactionId: '2000000001', environment: 'Production' } },
      '2000000002': { env: 'sb', info: { bundleId: PKG, productId: PRODUCT, transactionId: '2000000002', originalTransactionId: '2000000002', environment: 'Sandbox' } },
      '2000000003': { env: 'prod', info: { bundleId: 'com.other.app', productId: PRODUCT, transactionId: '2000000003', environment: 'Production' } },
      '2000000004': { env: 'prod', info: { bundleId: PKG, productId: PRODUCT, transactionId: '2000000004', revocationDate: 1764000000000, environment: 'Production' } },
    }[id];
    if (!tx || (tx.env === 'sb') !== sb) return send(404, { errorCode: 4040010 });
    return send(200, { signedTransactionInfo: fakeJws(tx.info) });
  }
  send(404, {});
});
await new Promise((r) => server.listen(MOCK, '127.0.0.1', r));

/* ---------- 本地 Worker（测试用配置 + .dev.vars） ---------- */
// 端口上已经有服务（多半是上次没退干净的 wrangler，带着别的密钥）会让测试连到旧进程，先拦下
if (await fetch(BASE + '/api/me').then(() => true, () => false)) { console.error('端口 8795 已被占用：先结束旧的 wrangler dev（pkill -f "wrangler dev"）'); server.close(); process.exit(1); }
const dir = mkdtempSync(path.join(tmpdir(), 'kpp-iap-'));
writeFileSync(path.join(dir, 'wrangler.jsonc'), JSON.stringify({
  name: 'kpp-iap-test', main: path.join(root, 'worker/index.js'), compatibility_date: '2026-10-28', compatibility_flags: ['nodejs_als'],
  assets: { directory: path.join(root, 'web/dist'), binding: 'ASSETS', run_worker_first: ['/api/*', '/lt/*', '/', '/index.html', '/robots.txt', '/sitemap.xml'], not_found_handling: 'single-page-application' },
  d1_databases: [{ binding: 'DB', database_name: 'kpp-iap-test', database_id: '00000000-0000-0000-0000-000000000000' }],
}));
const q = (s) => "'" + s.replace(/\n/g, '\\n') + "'";   // 单引号 = 原样（.dev.vars 的规则），换行写成 \n，worker 那边认
writeFileSync(path.join(dir, '.dev.vars'), [
  'DEV_LK=1', 'IAP_SECRET=test-secret-123',
  'GOOGLE_PLAY_SA=' + q(JSON.stringify(SA)),
  'APPLE_IAP_KEY=' + q(pem(ec.privateKey)), 'APPLE_IAP_KEY_ID=KEYID123', 'APPLE_ISSUER_ID=issuer-uuid',
  `IAP_GOOGLE_TOKEN_URL=http://127.0.0.1:${MOCK}/token`, `IAP_GOOGLE_API=http://127.0.0.1:${MOCK}`,
  `IAP_APPLE_API=http://127.0.0.1:${MOCK}/apple`, `IAP_APPLE_SANDBOX_API=http://127.0.0.1:${MOCK}/apple-sb`,
].join('\n') + '\n');
const wr = spawn(path.join(root, 'node_modules/.bin/wrangler'), ['dev', '-c', path.join(dir, 'wrangler.jsonc'), '--port', '8795', '--persist-to', path.join(dir, 'state')], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; wr.stdout.on('data', (d) => { log += d; }); wr.stderr.on('data', (d) => { log += d; });
const stop = () => { try { wr.kill(); } catch (e) { /* 已退出 */ } server.close(); rmSync(dir, { recursive: true, force: true }); };
for (let i = 0; i < 90; i++) { try { const r = await fetch(BASE + '/api/me'); if (r.ok) break; } catch (e) { /* 还没起来 */ } await new Promise((r) => setTimeout(r, 1000)); }

const call = async (p, { body, ent, origin, cookie, method } = {}) => {
  const h = {}; if (body) h['content-type'] = 'application/json'; if (ent) h['x-kpp-ent'] = ent; if (origin) h.origin = origin; if (cookie) h.cookie = cookie;
  const r = await fetch(BASE + p, { method: method || (body ? 'POST' : 'GET'), headers: h, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) { /* 不是 JSON */ }
  return { s: r.status, h: r.headers, j, t };
};
const verify = (platform, token, productId = PRODUCT) => call('/api/iap/verify', { body: { platform, productId, token }, origin: 'https://localhost' });

try {
  /* 跨域：只认 App 的来源 */
  let r = await call('/api/me', { method: 'OPTIONS', origin: 'capacitor://localhost' });
  ok(r.s === 204 && r.h.get('access-control-allow-origin') === 'capacitor://localhost' && /x-kpp-ent/.test(r.h.get('access-control-allow-headers')), 'iOS 来源的预检请求放行', [r.s, r.h.get('access-control-allow-origin')]);
  r = await call('/api/me', { origin: 'https://evil.example' });
  ok(r.s === 200 && !r.h.get('access-control-allow-origin'), '别的网站来源不给跨域头');
  r = await call('/api/me', { origin: 'https://localhost' });
  ok(r.j && r.j.ent === false && r.h.get('access-control-allow-origin') === 'https://localhost', 'Android 来源有跨域头；没买 ent = false', r.j);

  /* Google Play */
  r = await verify('android', 'g-good');
  ok(r.s === 200 && r.j.ok && /^v1\./.test(r.j.ent) && r.j.env === 'test', 'Android：付过款的凭据校验通过，发解锁凭证', r.j);
  const entA = r.j && r.j.ent;
  ok(seen.gToken === 1 && seen.gApi === 1 && seen.badSig === 0, 'Google：服务账号 JWT 签名正确，拿到访问令牌再查购买', seen);
  r = await verify('android', 'g-good');
  ok(r.s === 200 && r.j.ok && seen.gToken === 1, '同一笔再校验一次照样通过，访问令牌复用不重新换', seen);
  ok((await verify('android', 'g-pending')).j.error === 'pending', 'Android：还没付款（待付款）不给');
  ok((await verify('android', 'g-refunded')).j.error === 'canceled', 'Android：已退款 / 取消不给');
  r = await verify('android', 'g-nonexistent');
  ok(r.s === 402 && r.j.error === 'not_found', 'Android：瞎编的凭据不给', r.j);
  ok((await verify('android', 'g-good', 'kpp_other')).s === 400, '别的商品 ID 直接拒');

  /* App Store */
  r = await verify('ios', '2000000002');
  ok(r.s === 200 && r.j.ok && r.j.env === 'test' && seen.aProd >= 1 && seen.aSb === 1, 'iOS：正式环境查不到就查沙盒（TestFlight / 审核）', { j: r.j, seen });
  const entI = r.j && r.j.ent;
  r = await verify('ios', '2000000001');
  ok(r.j && r.j.ok && r.j.env === 'prod', 'iOS：正式环境的购买', r.j);
  ok((await verify('ios', '2000000003')).j.error === 'mismatch', 'iOS：别的 App 的交易不认');
  ok((await verify('ios', '2000000004')).j.error === 'canceled', 'iOS：已退款的不给');
  ok((await verify('ios', '9999999999')).j.error === 'not_found', 'iOS：两个环境都查不到');
  ok((await verify('ios', 'abc')).j.error === 'bad_token', 'iOS：交易号格式不对');
  ok(seen.badSig === 0, 'Apple：ES256 JWT 签名、kid、issuer、bundle 都对', seen);

  /* 解锁凭证 */
  r = await call('/api/me', { ent: entA });
  ok(r.j && r.j.ent === true && r.j.user === null, '带凭证：ent = true（不用登录）', r.j);
  ok((await call('/api/me', { ent: entI })).j.ent === true, 'iOS 发的凭证也认');
  const forged = String(entA).slice(0, -4) + (String(entA).endsWith('AAAA') ? 'BBBB' : 'AAAA');
  ok((await call('/api/me', { ent: forged })).j.ent === false, '改过的凭证不认');
  ok((await call('/api/me', { ent: 'v1.' + b64u(JSON.stringify({ p: 'android', k: 'x', t: 1 })) + '.abc' })).j.ent === false, '自己拼的凭证不认');

  /* 驾校报价：带凭证就是解锁的 */
  const ck = 'dev_uid=iaptester';
  const sc = await call('/api/schools', { body: { name: 'Sekolah Memandu Ujian ' + Date.now().toString(36), state: 'Selangor' }, cookie: ck });
  ok(sc.j && sc.j.ok && sc.j.id, '建一所测试驾校', sc.j);
  await call('/api/prices', { body: { sid: sc.j.id, cls: 'DA', price: 2800, incl: ['jpj'] }, cookie: ck });
  r = await call('/api/schools/' + sc.j.id);
  ok(r.j && r.j.open === false && !r.j.rows, '没凭证：报价锁着', r.j);
  r = await call('/api/schools/' + sc.j.id, { ent: entA });
  ok(r.j && r.j.open === true && r.j.rows.length === 1 && r.j.rows[0].price === 2800, '带凭证：报价直接能看', r.j);
  r = await call('/api/schools?state=Selangor', { ent: entA });
  ok(r.j && r.j.list.some((x) => x.id === sc.j.id && x.open), '驾校列表里也标成已解锁');

  /* 隐私政策页 */
  r = await call('/privacy');
  ok(r.s === 200 && /Privacy Policy/.test(r.t) && /Bahasa Melayu/.test(r.t), '隐私政策页 /privacy');
} finally {
  stop();
}
if (fail) console.error(process.env.DEBUG ? log : log.split('\n').filter((l) => /error|✘|iap verify/i.test(l)).slice(-15).join('\n'));
console.log(`iap: ${pass} 项通过${fail ? `，${fail} 项失败` : ''}`);
process.exit(fail ? 1 : 0);
