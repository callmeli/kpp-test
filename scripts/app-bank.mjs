/* App 构建的最后一步：把线上题库下载一份打包进 App（dist-app/bank.json）。
 * App 第一次打开如果没网，就用这份；有网时照常从服务器取最新的（见 web/src/lib.ts 的 loadBank）。
 * 用法：node scripts/app-bank.mjs <输出目录>；KPP_BANK_URL 可以换地址（比如本地 http://127.0.0.1:8787/api/bank） */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
const out = process.argv[2] || 'web/dist-app';
const url = process.env.KPP_BANK_URL || 'https://kpp.luckylab.cc/api/bank';
const r = await fetch(url);
if (!r.ok) { console.error('下载题库失败', r.status, url); process.exit(1); }
const j = await r.json();
if (!Array.isArray(j.qs) || j.qs.length < 100) { console.error('题库内容不对', Object.keys(j)); process.exit(1); }
writeFileSync(path.join(out, 'bank.json'), JSON.stringify(j));
console.log(`题库 v${j.v}，${j.qs.length} 题 → ${path.join(out, 'bank.json')}`);
