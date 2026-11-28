/* App 版界面测试：用浏览器打开 App 模式的页面，走一遍「没买 → 付费墙」「买断后 → 全部解锁」「第一次打开没网 → 用内置题库」。
 *   cd web && VITE_API_BASE= npx vite build --mode app --outDir <目录> && cp dist-app/bank.json <目录>/
 *   APP_DIST=<目录> node test/app-ui.test.mjs
 * VITE_API_BASE 留空 = 接口和页面同源（这里由本地 Worker 一起提供），这样不用真的跨域。商店付款本身要在真机上测，这里不覆盖。 */
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = createRequire(import.meta.url)('playwright');
const DIST = process.env.APP_DIST;
if (!DIST) { console.error('要先构建测试用的 App 页面，见文件开头的说明'); process.exit(1); }
const PORT = 8798, BASE = `http://127.0.0.1:${PORT}`, SECRET = 'ui-test-secret';
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else { fail++; console.error('✗', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 300)); } };

if (await fetch(BASE + '/api/me').then(() => true, () => false)) { console.error(`端口 ${PORT} 已被占用`); process.exit(1); }
const dir = mkdtempSync(path.join(tmpdir(), 'kpp-ui-'));
writeFileSync(path.join(dir, 'wrangler.jsonc'), JSON.stringify({
  name: 'kpp-ui-test', main: path.join(root, 'worker/index.js'), compatibility_date: '2026-10-28', compatibility_flags: ['nodejs_als'],
  assets: { directory: DIST, binding: 'ASSETS', run_worker_first: ['/api/*'], not_found_handling: 'single-page-application' },
  d1_databases: [{ binding: 'DB', database_name: 'kpp-ui-test', database_id: '00000000-0000-0000-0000-000000000000' }],
}));
writeFileSync(path.join(dir, '.dev.vars'), `DEV_LK=1\nIAP_SECRET=${SECRET}\n`);
const wr = spawn(path.join(root, 'node_modules/.bin/wrangler'), ['dev', '-c', path.join(dir, 'wrangler.jsonc'), '--port', String(PORT), '--persist-to', path.join(dir, 'state')], { cwd: dir, stdio: 'ignore' });
for (let i = 0; i < 90; i++) { if (await fetch(BASE + '/api/me').then((r) => r.ok, () => false)) break; await new Promise((r) => setTimeout(r, 1000)); }

// 服务端买断后发的解锁凭证（格式同 worker/iap.js 的 issue）
const body = Buffer.from(JSON.stringify({ p: 'android', k: 'android:GPA.test', t: Date.now() })).toString('base64url');
const ENT = 'v1.' + body + '.' + createHmac('sha256', SECRET).update('v1.' + body).digest('base64url');

const b = await chromium.launch();
try {
  // 准备一所有报价的驾校（用网页版的测试登录建）
  const ck = { cookie: 'dev_uid=uitester', 'content-type': 'application/json' };
  const sc = await (await fetch(BASE + '/api/schools', { method: 'POST', headers: ck, body: JSON.stringify({ name: 'Akademi Memandu Ujian', state: 'Johor' }) })).json();
  await fetch(BASE + '/api/prices', { method: 'POST', headers: ck, body: JSON.stringify({ sid: sc.id, cls: 'DA', price: 2800, incl: ['jpj'] }) });

  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-US' });
  const errs = [];
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push(e.message));
  // 埋点 SDK：App 里（localhost 不带端口）不加载；这里是 127.0.0.1:端口，会去取 /lt/t.js，测试 Worker 没有埋点服务，挡掉
  await ctx.route('**/lt/**', (r) => r.abort());
  const tab = (name) => page.locator('nav.tabbar button', { hasText: name }).click();
  const text = () => page.locator('body').innerText();

  /* ---------- 没买 ---------- */
  await page.goto(BASE + '/?lang=en#practice');
  await page.waitForSelector('nav.tabbar');
  ok(/\d+ \/ 447/.test(await text()), '刷题免费：题目正常出来');
  await tab('Mock test');
  ok(await page.locator('.hero-exam button.btn.primary', { hasText: 'Unlock all' }).count() === 1, '模拟考：按钮是「全部解锁」，不是幸运币');
  await page.locator('.hero-exam button.btn.primary').click();
  await page.waitForSelector('.sheet .pro-list');
  const sheet = await page.locator('.sheet').innerText();
  ok(/One purchase, everything unlocked/.test(sheet) && /Restore purchase/.test(sheet) && /Privacy policy/.test(sheet) && /Google Play/.test(sheet), '付费墙：标题、三条权益、恢复购买、隐私政策', sheet);
  await page.locator('.mask').click({ position: { x: 10, y: 10 } });
  await tab('Me');
  let t = await text();
  ok(/Restore purchase/.test(t) && /Privacy policy/.test(t) && /Unlock all/.test(t), '我的：解锁入口、恢复购买、隐私政策');
  ok(!/LuckyLab|Sign in|Top up|LuckyCoin/i.test(t), '我的：没有 LuckyLab 账号、登录、充值、幸运币', t.slice(0, 300));
  await tab('Schools');
  await page.waitForSelector('.school-list');
  t = await text();
  ok(!/Share what I paid/.test(t), '驾校：没有「晒学费」（App 不用账号）');
  await page.locator('.school-list button', { hasText: 'Akademi Memandu Ujian' }).click();
  await page.waitForSelector('.sheet .locked');
  ok(/RM 2,8██/.test(await page.locator('.sheet').innerText()) && await page.locator('.sheet .locked button', { hasText: 'Unlock all' }).count() === 1, '驾校报价锁着，按钮是「全部解锁」');

  /* ---------- 买断后（本机有凭证） ---------- */
  await page.evaluate((e) => localStorage.setItem('kpp_ent', JSON.stringify(e)), ENT);
  await page.goto(BASE + '/?lang=en&r=1#exam');   // 地址只差 # 后面的话浏览器不会重新加载，所以多带一个参数
  await page.waitForSelector('nav.tabbar');
  ok(/Everything unlocked/.test(await text()), '顶部：已全部解锁');
  await page.locator('.hero-exam button.btn.primary', { hasText: 'Start test' }).click();
  await page.waitForTimeout(500);
  t = await text();
  ok(/1 \/ 70/.test(t) && /\d\d:\d\d/.test(t), '模拟考：直接开考，70 题，有倒计时', t.slice(0, 200));
  await page.evaluate(() => { localStorage.removeItem('kpp_exam'); });
  await page.goto(BASE + '/?lang=en&r=2#schools');
  await page.waitForSelector('.school-list');
  await page.locator('.school-list button', { hasText: 'Akademi Memandu Ujian' }).click();
  await page.waitForSelector('.sheet .rows');
  ok(/RM 2,800/.test(await page.locator('.sheet').innerText()), '驾校报价直接能看（服务端认凭证）');
  await page.goto(BASE + '/?lang=en&r=3#me');
  await page.waitForSelector('nav.tabbar');
  t = await text();
  ok(/Everything unlocked/.test(t) && !/Restore purchase/.test(t), '我的：已全部解锁，不再显示恢复购买');

  /* ---------- 第一次打开就没网：用内置题库 ---------- */
  const p2 = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  p2.on('pageerror', (e) => errs.push(e.message));
  await p2.route('**/api/**', (r) => r.abort());
  await p2.route('**/lt/**', (r) => r.abort());
  await p2.goto(BASE + '/?lang=ms');
  await p2.waitForSelector('nav.tabbar', { timeout: 15000 }).catch(() => {});
  ok(/\d+ \/ 447/.test(await p2.locator('body').innerText()), '没网：用打包进 App 的题库照样能刷');

  ok(errs.length === 0, '页面没有报错', errs);
} finally {
  await b.close(); wr.kill(); rmSync(dir, { recursive: true, force: true });
}
console.log(`app-ui: ${pass} 项通过${fail ? `，${fail} 项失败` : ''}`);
process.exit(fail ? 1 : 0);
