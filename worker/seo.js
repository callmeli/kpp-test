/* ================= SEO：robots.txt、sitemap.xml、首页 <head> 按语言输出 =================
 * 语言版本统一用 ?lang=xx（zh / en / ms，前端 detectLang 认这个参数），每个版本的 canonical 指向自己，x-default = 英文。
 * 首页是单页应用的壳（web/index.html），这里用 HTMLRewriter 改写 <title>、description，
 * 并补上 canonical、hreflang、og / twitter 分享卡片和结构化数据。
 * 注意：/robots.txt、/sitemap.xml 要写进 wrangler.jsonc 的 run_worker_first，不然会被单页应用兜底成首页 HTML。
 */
export const LANGS = ['zh', 'en', 'ms'];
const HTML_LANG = { zh: 'zh-CN', en: 'en', ms: 'ms' };
const HREFLANG = { zh: 'zh', en: 'en', ms: 'ms' };
const OG_LOCALE = { zh: 'zh_CN', en: 'en_MY', ms: 'ms_MY' };
const META = {
  zh: { name: 'KPP 驾考刷题', title: 'KPP 驾考刷题 · 马来西亚 KPP01 驾照笔试题库（中文 / 英文 / 马来文对照）',
    desc: '马来西亚 KPP01 驾照理论考试题库：免费刷题，中文 / English / Bahasa Melayu 对照，模拟考试、错题集，还有各州驾校学费行情。打开网页就能练，不用下载。' },
  en: { name: 'KPP Driving Theory', title: 'KPP01 Practice Test · Free Malaysia Driving Theory Questions (English / BM / 中文)',
    desc: 'Free KPP01 practice for the Malaysian JPJ driving theory test: the question bank in English, Bahasa Melayu and Chinese side by side, timed mock tests, a mistake book, and driving school fees by state. Runs in your browser, no download.' },
  ms: { name: 'Latihan Teori KPP', title: 'Latihan KPP01 · Soalan Ujian Teori Memandu JPJ Percuma (BM / English / 中文)',
    desc: 'Latihan KPP01 percuma untuk ujian teori memandu JPJ: bank soalan dalam Bahasa Melayu, Inggeris dan Cina, ujian simulasi bermasa, buku kesilapan, serta yuran sekolah memandu mengikut negeri. Terus dalam pelayar, tanpa muat turun.' },
};
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const href = (o, l) => `${o}/?lang=${l}`;
const TXT = { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' };
const XML = { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600' };

/** 和前端 detectLang 一样：?lang= > 浏览器语言（印尼语算马来文）> 英文 */
export function reqLang(req, url) {
  const q = (url.searchParams.get('lang') || '').slice(0, 2).toLowerCase();
  if (LANGS.includes(q)) return q;
  for (const part of (req.headers.get('accept-language') || '').split(',')) {
    const l = part.split(';')[0].trim();
    if (/^zh/i.test(l)) return 'zh';
    if (/^(ms|id)/i.test(l)) return 'ms';
    if (/^en/i.test(l)) return 'en';
  }
  return 'en';
}

export const robots = (o) => new Response(`User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${o}/sitemap.xml\n`, { headers: TXT });

export function sitemap(o) {
  const today = new Date().toISOString().slice(0, 10);
  const alts = LANGS.map((l) => `<xhtml:link rel="alternate" hreflang="${HREFLANG[l]}" href="${href(o, l)}"/>`).join('')
    + `<xhtml:link rel="alternate" hreflang="x-default" href="${href(o, 'en')}"/>`;
  const urls = LANGS.map((l) => `<url><loc>${href(o, l)}</loc><lastmod>${today}</lastmod>${alts}</url>`).join('\n');
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls}\n</urlset>\n`, { headers: XML });
}

/** 首页：取静态的 index.html，按语言改写 <head> */
export async function homePage(req, env, url, origin) {
  const res = await env.ASSETS.fetch(new Request(new URL('/', url)));
  if (!res.ok) return res;
  const lang = reqLang(req, url), m = META[lang], self = href(origin, lang), img = `${origin}/og.jpg`;
  const ld = {
    '@context': 'https://schema.org', '@type': 'WebApplication', name: m.name, url: self, inLanguage: HTML_LANG[lang],
    applicationCategory: 'EducationalApplication', operatingSystem: 'Web browser (iOS, Android, Windows, macOS)',
    description: m.desc, image: img, offers: { '@type': 'Offer', price: '0', priceCurrency: 'MYR' },
    publisher: { '@type': 'Organization', name: 'LuckyLab', url: 'https://luckylab.cc/' },
  };
  const extra = `<link rel="canonical" href="${self}" />`
    + LANGS.map((l) => `<link rel="alternate" hreflang="${HREFLANG[l]}" href="${href(origin, l)}" />`).join('')
    + `<link rel="alternate" hreflang="x-default" href="${href(origin, 'en')}" />`
    + `<meta name="robots" content="index,follow,max-image-preview:large" />`
    + `<meta property="og:type" content="website" /><meta property="og:site_name" content="${esc(m.name)}" /><meta property="og:locale" content="${OG_LOCALE[lang]}" />`
    + `<meta property="og:title" content="${esc(m.title)}" /><meta property="og:description" content="${esc(m.desc)}" /><meta property="og:url" content="${self}" />`
    + `<meta property="og:image" content="${img}" /><meta property="og:image:width" content="1200" /><meta property="og:image:height" content="630" />`
    + `<meta name="twitter:card" content="summary_large_image" /><meta name="twitter:title" content="${esc(m.title)}" /><meta name="twitter:description" content="${esc(m.desc)}" /><meta name="twitter:image" content="${img}" />`
    + `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>`;
  const out = new HTMLRewriter()
    .on('html', { element(e) { e.setAttribute('lang', HTML_LANG[lang]); } })
    .on('title', { element(e) { e.setInnerContent(m.title); } })
    .on('meta[name="description"]', { element(e) { e.setAttribute('content', m.desc); } })
    .on('link[rel="canonical"]', { element(e) { e.remove(); } })   // 静态文件里兜底的那几条，换成上面按语言拼的
    .on('meta[property^="og:"]', { element(e) { e.remove(); } })
    .on('meta[name^="twitter:"]', { element(e) { e.remove(); } })
    .on('head', { element(e) { e.append(extra, { html: true }); } })
    .transform(res);
  return new Response(out.body, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' } });
}
