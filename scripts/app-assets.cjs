/* App 图标和启动图的原图（web/assets/，1024 / 2732 px），由 web/public/icon.svg 画出来；
 * 之后 npx @capacitor/assets generate 按它们生成 Android / iOS 各尺寸。改了图标重新跑：
 *   node scripts/app-assets.cjs && cd web && npx @capacitor/assets generate --iconBackgroundColor '#0b0a10' --splashBackgroundColor '#0f0e0c' --splashBackgroundColorDark '#0f0e0c' */
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const web = path.join(__dirname, '..', 'web');
const svg = fs.readFileSync(path.join(web, 'public/icon.svg'), 'utf8');
// 图标 SVG 自带圆角深色底；主屏图标要铺满（系统自己切圆角），所以把底色那块改成直角铺满
const full = svg.replace(/<rect width="64" height="64" rx="14"/, '<rect width="64" height="64" rx="0"');
const fg = svg.replace(/<rect width="64" height="64" rx="14" fill="url\(#g\)"\/>/, '');   // Android 自适应图标的前景：只要那张 L 牌
const uri = (s) => 'data:image/svg+xml;base64,' + Buffer.from(s).toString('base64');
(async () => {
  const b = await chromium.launch(), p = await b.newPage({ deviceScaleFactor: 1 });
  const shot = async (w, h, html, file, transparent = false) => {
    await p.setViewportSize({ width: w, height: h });
    await p.setContent(`<body style="margin:0;width:${w}px;height:${h}px;overflow:hidden;${transparent ? 'background:transparent' : ''}">${html}</body>`);
    await p.waitForTimeout(100);
    await p.screenshot({ path: path.join(web, 'assets', file), omitBackground: transparent });
  };
  await shot(1024, 1024, `<img src="${uri(full)}" style="display:block;width:1024px;height:1024px">`, 'icon-only.png');
  // 自适应图标的安全区是中间 66%，L 牌缩到 70% 放中间
  await shot(1024, 1024, `<div style="width:1024px;height:1024px;display:grid;place-items:center"><img src="${uri(fg)}" style="width:720px;height:720px"></div>`, 'icon-foreground.png', true);
  await shot(1024, 1024, `<div style="width:1024px;height:1024px;background:linear-gradient(135deg,#231c33,#0b0a10)"></div>`, 'icon-background.png');
  const splash = `<div style="width:2732px;height:2732px;background:#0f0e0c;display:grid;place-items:center"><img src="${uri(svg)}" style="width:520px;height:520px"></div>`;
  await shot(2732, 2732, splash, 'splash.png'); await shot(2732, 2732, splash, 'splash-dark.png');
  await b.close();
  console.log('ok', fs.readdirSync(path.join(web, 'assets')).join(' '));
})();
