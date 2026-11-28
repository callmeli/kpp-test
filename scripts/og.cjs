/* 分享图 web/public/og.jpg（1200×630）和主屏图标 web/public/icon-180.png。
 * 分享图是链接发到 WhatsApp、微信、Telegram、X 时显示的预览图，<head> 里的 og:image 指向它（worker/seo.js、web/index.html）。
 * 改了图标或文案后重新生成：node scripts/og.cjs（需要 playwright）。中文用的是这台电脑上的字体。 */
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const pub = path.join(__dirname, '..', 'web', 'public');
const icon = 'data:image/svg+xml;base64,' + fs.readFileSync(path.join(pub, 'icon.svg')).toString('base64');
const font = (f) => 'data:font/woff2;base64,' + fs.readFileSync(path.join(pub, 'fonts', f)).toString('base64');
const html = `<!doctype html><meta charset="utf-8"><style>
  @font-face { font-family: Sora; font-weight: 700; src: url(${font('sora-latin-700-normal.woff2')}); }
  @font-face { font-family: Sora; font-weight: 600; src: url(${font('sora-latin-600-normal.woff2')}); }
  @font-face { font-family: Figtree; font-weight: 500; src: url(${font('figtree-latin-500-normal.woff2')}); }
  body { margin: 0; width: 1200px; height: 630px; overflow: hidden; position: relative; color: #f4efe6;
    background: radial-gradient(760px 560px at 84% 42%, #3a2d55 0%, #1a1526 48%, #0b0a10 100%); font-family: Sora, "PingFang SC", "WenQuanYi Zen Hei", sans-serif; }
  .t { position: absolute; left: 80px; top: 112px; }
  .k { font: 600 21px/1 Sora, sans-serif; letter-spacing: .3em; color: #e8c26a; }
  h1 { font: 700 132px/1 Sora, sans-serif; margin: 30px 0 0; letter-spacing: -3px; } h1 em { font-style: normal; color: #e8c26a; }
  h2 { font: 700 50px/1.3 Sora, "PingFang SC", "WenQuanYi Zen Hei", sans-serif; margin: 26px 0 0; }
  p { font: 500 27px/1.5 Figtree, "PingFang SC", "WenQuanYi Zen Hei", sans-serif; color: #aaa398; margin: 22px 0 0; }
  .l { display: flex; gap: 12px; margin-top: 34px; } .l span { font: 600 21px/1 Sora, "WenQuanYi Zen Hei", sans-serif; padding: 12px 18px; border-radius: 10px; border: 1px solid #f4efe640; }
  .i { position: absolute; right: 104px; top: 150px; width: 330px; height: 330px; transform: rotate(6deg); filter: drop-shadow(0 40px 70px #000c) drop-shadow(0 0 90px #e8c26a33); }
</style>
<img class="i" src="${icon}">
<div class="t"><div class="k">MALAYSIA · JPJ</div><h1>KPP<em>01</em></h1><h2>驾考刷题 · Practice Test</h2><p>Free question bank, mock tests, driving school fees</p>
<div class="l"><span>中文</span><span>English</span><span>Bahasa Melayu</span></div></div>`;
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await p.setContent(html); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(300);
  await p.screenshot({ path: path.join(pub, 'og.jpg'), type: 'jpeg', quality: 88 });
  // 主屏图标：iOS 会自己切圆角，所以铺满不留透明边
  await p.setViewportSize({ width: 180, height: 180 });
  await p.setContent(`<body style="margin:0;background:#0b0a10"><img src="${icon}" style="display:block;width:216px;height:216px;margin:-18px">`); await p.waitForTimeout(100);
  await p.screenshot({ path: path.join(pub, 'icon-180.png') });
  await b.close();
  console.log('ok', fs.statSync(path.join(pub, 'og.jpg')).size, fs.statSync(path.join(pub, 'icon-180.png')).size);
})();
