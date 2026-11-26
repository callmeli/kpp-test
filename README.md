# KPP 驾考刷题（kpp.luckylab.cc）

马来西亚 KPP01 驾照理论考试题库，LuckyLab 旗下应用：账号、幸运币和其他 *.luckylab.cc 应用共用。

## 2026-11 改版要点
- **部署**：从 GitHub Pages 搬到 Cloudflare Workers（`wrangler.jsonc`）。前端 `web/`（React + Vite，去掉了 antd-mobile / i18next，产物 65 KB gzip），接口 `worker/index.js`，数据 D1 `kpp`。
- **题库上服务端**：`/api/bank` 下发，前端按版本号缓存在本机（离线也能刷）。表 `q` 一题一行，首次请求 / 题库版本升级时从 `worker/bank.json` 导入；后台改过的题（`src = 'admin'`）导入新版时不会被覆盖。
- **题目准确性**：447 题（原 450 题去掉 3 道完全重复的）逐题审校过：
  - 答案：没有发现标错的；3 道酒驾上限题按的是 2020 年修法前的数值（尿液 107 mg / 血液 70 mg），保留 KPP 原答案，答题后显示「法规已更新为血液 50 mg / 尿液 67 mg」的说明（`data/bank_fixes/manual.json` 的 `notes`）。
  - 中文：修了 265 题的翻译（意思反了的、机翻的、「[翻译失败]」占位、零宽字符），统一马来西亚华文用词（大道、摩哆、回旋处、暂准驾照 PDL、学习驾照 LDL）。
  - 英文：114 题轻改错别字 / 语法。
  - 新增马来文（Bahasa Melayu）全部 447 题。
  - 审校结果在 `data/bank_fixes/review_*.json`（`ans_ok` / `conf` / `reason` 字段可以复查低置信度的题）。
- **用户纠错**：每题右上角「纠错」（答案不对 / 翻译 / 图片 / 其他），管理员在「我的 → 纠错审核」一键采纳（可直接改答案），题库版本 +1，所有人下次打开自动更新；第一个报告的登录用户奖励 20 幸运币。
- **答对自动下一题**（默认开，「我的 → 设置」可关）；答错停在本题、标出正确答案，自动收进错题集。
- **三种语言**：界面 中文 / English / Bahasa Melayu；题目语言 English / Bahasa Melayu（JPJ 考试用这两种），对照翻译 中 / 英 / 马 / 不显示。
- **打赏**：去掉支付宝收款码，改成幸运币打赏：每刷 100 题，在第 30–95 题之间随机弹一次（10 / 30 / 66 币，可直接「下次再说」）。

## 幸运币（价格在 `worker/index.js` 的 `ECON`，前端从 `/api/me` 读）
| 功能 | 价格 |
|---|---|
| 刷题（全部题库、分类、随机、没做过） | 免费 |
| 模拟考试（50 题 / 45 分钟 / 42 及格，按三部分比例抽题，不显示翻译） | 每场 20 |
| 错题集（记录一直免费；查看、重练要解锁） | 一次 50，永久 |
| 驾校行情：各州整体行情（中位数、最低–最高） | 免费 |
| 驾校行情：某所驾校的逐条报价（价格、包含项目、报名月份、砍价经验） | 每校 20，永久；自己晒过这所的免费 |
| 晒学费 | 每校第一次 +30，每人最多 3 次 |
| 纠错被采纳 | +20 |
| 打赏 | 10 / 30 / 66 |

扣费都经 LuckyLab 平台 RPC（`env.PAY.coinSpend`），每笔带 ref 去重：考试用前端生成的 nonce（网络重试不重扣），解锁用 `unlock:<uid>:<item>`。

## 驾校行情（为什么做）
同一家驾校、同一种驾照，不同人报的价能差 RM 2000–3000。这里让学员匿名晒实付价格（驾照类型 D / DA / B2 / B / 套餐、总价、含 KPP01 / L 牌 / JPJ 考试费 / 补考 / 接送 / 分期、报名月份、备注），整体行情免费看，具体驾校按条解锁。价格限 RM 200–20000，每人每校每种驾照一条（再交覆盖）。不实报价管理员用 `POST /api/admin/hide {price|school}` 隐藏。

## 部署（第一次）
1. `npx wrangler d1 create kpp`，把 database_id 填进 `wrangler.jsonc`。
2. Cloudflare Workers Builds 接 `callmeli/kpp-test`：根目录 `/`，构建命令 `npm run build`，部署命令 `npx wrangler deploy`。要和 `paycenter` 在同一个 Cloudflare 账号（Service Binding `PAY`）。
3. 自定义域名 `kpp.luckylab.cc` 在 `routes` 里，部署时自动绑定。
4. `ADMIN_UIDS` 填管理员的 LuckyLab 账号 ID。
5. 可选：Workers 的 Build variables 里加 `VITE_GA_MEASUREMENT_ID`（Google Analytics）。
旧地址 `/KPP-Test/...` 301 到根目录。GitHub Pages 的自动部署已停（`.github/workflows/deploy.yml` 只能手动触发）。

## 更新题库
```bash
# 改 data/source/*.json（抓取原文 / 中文）或 data/bank_fixes/*.json（审校、手工答案修正、要下线的题、说明）
python3 scripts/build_bank.py          # 生成 worker/bank.json，版本号默认 YYYYMMDDHH
git commit && git push                 # 部署后第一次请求自动导入 D1（后台改过的题不覆盖），前端自动拉新版
```
`data/bank_fixes/manual.json`：`drop`（下线的题 ID）、`answers`（`{id: "B"}` 人工确认的答案修正）、`notes`（答题后显示的说明，`{id: {zh, en, ms}}`）。

## 本地运行
```bash
npm install && (cd web && npm install && npm run build)
npx wrangler dev --var DEV_LK:1        # http://127.0.0.1:8787 ；DEV_LK 时打开 /__devlogin 假登录（送 200 测试币），线上不要配
cd web && npm run dev                  # 前端热更新（/api 代理到 8787）
```

## 接口
| 接口 | 说明 |
|---|---|
| `GET /api/bank[?v=]` | 题库（带版本号的地址长缓存） |
| `GET /api/me` | 题库版本、价格、登录用户、余额、已解锁、错题数 |
| `POST /api/report` | 纠错（不登录也能报，每天 30 条） |
| `GET/POST /api/wrong` | 错题集同步（POST 免费；GET 没解锁只给数量） |
| `POST /api/unlock {item: wrong \| school:<id>}` | 解锁 |
| `POST /api/exam/start {nonce}` · `/api/exam/finish` · `GET /api/exams` | 模拟考试 |
| `GET /api/schools?state=&q=` · `GET /api/schools/:id` · `POST /api/schools` · `POST /api/prices` | 驾校行情 |
| `POST /api/tip {amount}` | 打赏 |
| `/api/admin/reports` · `/api/admin/resolve` · `/api/admin/hide` | 管理员 |

---

# 以下是改版前的说明（数据抓取部分仍然适用）

# KPP 驾考题库 Web 应用

## 项目简介

本项目是一个马来西亚 KPP 驾考题库的 Web 应用，提供无广告的移动端练习和模拟考试功能。题目数据通过网页抓取从 `kpptestmy.com` 获取，并提供了完整的英文原文和中文翻译支持。

## 功能特性

- ✅ **题目练习**：逐题练习模式，支持查看答案和翻译
- ✅ **模拟考试**：50道题随机抽取，42道通过标准，支持暂停和恢复
- ✅ **错题复习**：查看考试中的错题及正确答案
- ✅ **国际化支持**：英文原文 + 中文翻译，可切换显示
- ✅ **移动端优化**：H5 适配的移动端界面（React + Ant Design Mobile）
- ✅ **数据完整**：450 道题目，100% 答案覆盖率
- ✅ **图片支持**：支持题目和选项中的图片显示
- ✅ **访问统计**：集成 Google Analytics 4，支持用户数量、地区和使用量统计

## 技术栈

### 前端
- **React 18** + **TypeScript**
- **Vite** - 构建工具
- **Ant Design Mobile** - UI 组件库
- **react-i18next** - 国际化支持

### 数据抓取
- **Python 3.8+**
- **Selenium** - 动态网页交互
- **BeautifulSoup4** - HTML 解析
- **requests** - HTTP 请求

## 项目结构

```
KPP/
├── data/                    # 题目数据
│   ├── questions/          # 原始题目数据
│   └── scraper_progress.json
├── docs/                   # 文档
│   └── ui_element_reference.md
├── scripts/                # 数据抓取脚本
│   ├── web_scraper.py      # 核心抓取脚本
│   ├── scrape_all_sections.py  # 全量抓取
│   ├── verify_*.py         # 数据验证脚本
│   └── translate_questions.py   # 翻译生成脚本
├── web/                    # Web 应用
│   ├── src/
│   │   ├── components/     # React 组件
│   │   │   ├── QuestionCard/    # 题目卡片
│   │   │   ├── OptionItem/      # 选项组件
│   │   │   ├── ExamResult/       # 考试结果
│   │   │   ├── LanguageToggle/  # 语言切换
│   │   │   └── ErrorBoundary/   # 错误边界
│   │   ├── pages/          # 页面组件
│   │   │   ├── Practice/        # 练习页面
│   │   │   ├── Exam/            # 考试页面
│   │   │   ├── Review/          # 复习页面
│   │   │   └── Settings/        # 设置页面
│   │   ├── hooks/          # 自定义 Hooks
│   │   │   └── useLocalStorage.ts
│   │   ├── utils/          # 工具函数
│   │   │   ├── index.ts        # 题目数据加载
│   │   │   └── logger.ts        # 日志工具
│   │   ├── i18n/          # 国际化配置
│   │   │   ├── config.ts
│   │   │   └── locales/        # 翻译文件
│   │   ├── data/          # 题目数据
│   │   │   └── questions.json  # 450 道题目
│   │   └── types/         # TypeScript 类型定义
│   ├── public/
│   │   ├── images/        # 题目和选项图片
│   │   └── translations/  # 题目翻译数据
│   └── package.json
├── README.md              # 项目说明
├── context.md            # 详细需求文档
└── requirements.txt      # Python 依赖
```

## 快速开始

### 环境要求

1. **Node.js 16+** 和 **npm**
2. **Python 3.8+**（仅用于数据抓取）

### 安装和运行

#### Web 应用

```bash
# 进入 web 目录
cd web

# 安装依赖
npm install

# 开发模式运行
npm run dev

# 构建生产版本
npm run build

# 预览生产构建
npm run preview
```

#### 配置访问统计（可选）

应用已集成 Google Analytics 4，可以统计用户数量、地区分布和使用量。要启用统计功能：

1. **创建 Google Analytics 账户**
   - 访问 https://analytics.google.com/
   - 创建新的 GA4 属性（如果还没有）

2. **获取 Measurement ID**
   - 在"管理" -> "数据流" -> "网站"中找到 Measurement ID
   - 格式：`G-XXXXXXXXXX`

3. **配置环境变量**

   **本地开发环境：**
   - 在 `web` 目录下创建 `.env` 文件
   - 添加：`VITE_GA_MEASUREMENT_ID=G-XXXXXXXXXX`
   - 注意：`.env` 文件不应提交到 Git

   **GitHub Pages 部署：**
   - 在 GitHub 仓库中，进入 **Settings** -> **Secrets and variables** -> **Actions**
   - 点击 **New repository secret**
   - Name: `VITE_GA_MEASUREMENT_ID`
   - Value: 你的 Measurement ID（如 `G-XXXXXXXXXX`）
   - 点击 **Add secret**
   - 下次推送代码时，GitHub Actions 会自动使用这个 secret 进行构建

4. **重新构建**
   ```bash
   npm run build
   ```

**统计功能包括：**
- 页面访问统计（练习、考试、设置等页面）
- 用户行为跟踪（开始练习、提交答案、开始考试等）
- 地区分布统计（通过 GA 自动获取）
- 使用量统计（练习次数、考试次数等）

**隐私说明：**
- 已启用 IP 匿名化，保护用户隐私
- 不收集个人身份信息
- 仅用于了解应用使用情况

#### 数据抓取（可选）

如果需要重新抓取题目数据：

```bash
# 安装 Python 依赖
pip install -r requirements.txt

# 运行全量抓取
python scripts/scrape_all_sections.py
```

## 题目数据

- **总题数**：450 道
- **答案覆盖率**：100%（450/450）
- **分布**：
  - Section A：149 道
  - Section B：218 道
  - Section C：83 道
- **数据文件**：`web/src/data/questions.json`
- **图片资源**：`web/public/images/`

## 主要功能说明

### 练习模式
- 逐题浏览，支持前进/后退
- 选择答案后立即显示正确/错误
- 支持跳转到指定题目
- 可切换显示/隐藏中文翻译

### 模拟考试
- 随机抽取 50 道题目
- 42 道通过标准（84%）
- 支持暂停和恢复
- 完成后显示详细结果和错题列表

### 设置
- 语言切换（英文/中文）
- 默认显示翻译设置
- 数据持久化到 localStorage

## 开发说明

### 代码规范
- 使用 TypeScript 严格模式
- 使用 logger 工具替代 console.log（生产环境自动禁用）
- 使用自定义 Hook 统一管理 localStorage
- 组件化设计，代码复用

### 数据更新流程
1. 运行 `scripts/scrape_all_sections.py` 抓取最新题目
2. 运行验证脚本检查数据完整性
3. 生成翻译数据（如需要）
4. 更新 `web/src/data/questions.json`

## 部署

### GitHub Pages 自动部署

项目已配置 GitHub Actions，支持自动部署到 GitHub Pages。

**快速配置：**

1. **启用 GitHub Pages**
   - 仓库 **Settings** -> **Pages** -> Source 选择 **GitHub Actions**

2. **配置统计功能（可选）**
   - 仓库 **Settings** -> **Secrets and variables** -> **Actions**
   - 添加 Secret：`VITE_GA_MEASUREMENT_ID` = `G-XXXXXXXXXX`

3. **推送代码**
   - 推送到 `main` 分支即可自动部署
   - 访问：`https://<你的用户名>.github.io/KPP-Test/`

**详细配置说明：** 请查看 [GitHub Pages 部署指南](./docs/GITHUB_PAGES_SETUP.md)

### 其他静态托管服务

项目支持部署到其他静态托管服务：

```bash
cd web
npm run build
# 将 dist/ 目录部署到静态服务器
```

## 注意事项

1. **数据来源**：题目数据来自 `kpptestmy.com`，仅用于学习目的
2. **图片资源**：题目和选项图片存储在 `web/public/images/` 目录
3. **翻译数据**：中文翻译存储在 `web/public/translations/` 目录
4. **浏览器兼容**：建议使用现代浏览器（Chrome、Safari、Firefox 等）

## 详细文档

请查看 [context.md](./context.md) 了解详细的项目需求和技术实现说明。

## 支持项目

如果这个项目对你有帮助，欢迎打赏支持：

[![打赏](https://img.shields.io/badge/打赏-支持项目-ff6b6b?style=flat-square)](https://qr.alipay.com/fkx10871ew38ukfqghwjx86)

<div align="center">

### 💰 支付宝打赏

[![支付宝二维码](./docs/images/alipay-qrcode.png)](https://qr.alipay.com/fkx10871ew38ukfqghwjx86)

**扫描二维码或 [点击这里](https://qr.alipay.com/fkx10871ew38ukfqghwjx86) 进行打赏**

感谢你的支持！🙏

</div>

## 许可证

本项目仅用于个人学习使用，请勿用于商业用途。
