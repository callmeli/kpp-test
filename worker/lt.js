/* ================= 埋点：接 luckylab analytics（callmeli/meantobe 仓库 analytics/ 目录，独立 Worker「analytics」）=================
 * 通过 Service Binding 直接调用（wrangler.jsonc 里的 LT 绑定），不走公网、不需要任何密钥。
 *   1. 网页埋点：前端加载 /lt/t.js，事件发到 /lt/v1/track，这里补上访客国家后交给分析服务。
 *      key 别名决定记到哪个应用（kpp）。网页事件不能写 pay_success 这类只限服务端的事件。
 *   2. 服务端埋点：注册、抽取、签到、发帖、广告、付款到账这些以服务端为准的事件，在业务代码里调 lt('事件名', uid, props)，
 *      本次请求结束后一次性发过去（ctx.waitUntil，不拖慢接口）。
 *      前端每个 /api 请求都带 x-lt-a（设备 ID）/ x-lt-s（首次渠道）/ x-lt-r（邀请人），服务端事件用它们和网页事件对上；
 *      Stripe 回调这种没有前端头的，分析服务按 user_id 找这个人最近的设备 ID 和渠道补上。
 * 没有 LT 绑定（比如本地开发）时，埋点全部静默跳过，不影响业务；分析服务出错也只打日志。
 */
import { AsyncLocalStorage } from 'node:async_hooks';

const APP = 'kpp';
const als = new AsyncLocalStorage();
const APPS = new Set(['kpp']);
const on = (env) => !!(env && env.LT && typeof env.LT.send === 'function');

/* 包一层请求：收集本次请求里的服务端事件，响应后统一发送 */
export function ltRun(req, env, ctx, fn) {
  if (!on(env)) return fn();
  const store = { q: [], h: {
    anon_id: (req.headers.get('x-lt-a') || '').slice(0, 64) || null,
    utm_source: (req.headers.get('x-lt-s') || '').slice(0, 64) || null,
    ref: (req.headers.get('x-lt-r') || '').slice(0, 64) || null,
    region: (req.cf && req.cf.country) || null,
  } };
  return als.run(store, async () => {
    try { return await fn(); }
    finally {
      if (store.q.length) ctx.waitUntil(env.LT.send(APP, store.q, { server: true }).then(
        (r) => { if (r && r.rejected && r.rejected.length) console.warn('lt rejected', JSON.stringify(r.rejected)); },
        (e) => console.error('lt', e)));
    }
  });
}

/* 记一条服务端事件；不在 ltRun 里（或没绑定）就什么也不做 */
export function lt(event, uid, props) {
  const s = als.getStore(); if (!s) return;
  s.q.push({ event, user_id: uid || null, ts: Date.now(), props: props || null, ...s.h });
}

/* /lt/t.js 和 /lt/v1/track */
export async function ltProxy(req, env, url) {
  if (!url.pathname.startsWith('/lt/')) return null;
  if (url.pathname === '/lt/t.js') {
    let js = '/* analytics off */';
    if (on(env)) { try { js = await env.LT.sdk(); } catch (e) { console.error('lt sdk', e); } }
    return new Response(js, { headers: { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
  }
  if (url.pathname === '/lt/v1/track' && req.method === 'POST') {
    if (!on(env)) return new Response(null, { status: 204 });
    let b; try { b = JSON.parse(await req.text()); } catch (e) { return new Response('{"error":"bad_json"}', { status: 400 }); }
    if (!b || !APPS.has(b.key)) return new Response(null, { status: 204 });
    const events = (Array.isArray(b.events) ? b.events : []).slice(0, 50);
    try {
      const r = await env.LT.send(b.key, events, { region: (req.cf && req.cf.country) || null });
      return new Response(JSON.stringify(r), { headers: { 'content-type': 'application/json; charset=utf-8' } });
    } catch (e) {
      console.error('lt track', e);
      return new Response(null, { status: 204 });
    }
  }
  return new Response('not found', { status: 404 });
}
