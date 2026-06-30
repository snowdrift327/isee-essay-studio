# ISEE Essay Studio

Taotao 的 ISEE Lower Level 限时作文模拟器:随机出题 → 30 分钟倒计时 → 计时结束(或提前交)自动调用 Claude,按**优秀 G6 标准**给出评价并指出具体错误。练习记录存在浏览器 `localStorage` 里。

技术栈:Vite + React。评价通过你自己的代理(Cloudflare Worker)调用 Anthropic API——key 不进前端。

---

## 一次性准备

```bash
# 1. 解压后进入目录
cd isee-essay-studio

# 2. 安装依赖
npm install
```

## 第一步:部署评价代理(Worker)

前端不能直接调 Anthropic(会暴露 key + 跨域),所以先把 `proxy/worker.js` 部署成一个 Worker。

```bash
cd proxy
npx wrangler login          # 首次需要,浏览器授权
npx wrangler deploy         # 部署,完成后会打印 Worker 的 URL
npx wrangler secret put ANTHROPIC_API_KEY   # 粘贴你的 Anthropic key
# 可选,做个简单防盗用:
npx wrangler secret put APP_SECRET          # 自己取一个随机字符串
cd ..
```

> 不想用命令行也行:去 Cloudflare 仪表盘 → Workers → 新建,把 `proxy/worker.js` 内容粘进去,在 **Settings → Variables** 添加 Secret `ANTHROPIC_API_KEY`(必填)、`APP_SECRET`(可选)。
>
> 部署好后,建议把 `worker.js` 里的 `ALLOWED_ORIGIN` 从 `"*"` 改成你的站点(如 `https://snowdrift327.github.io`),再重新部署。

## 第二步:配置前端指向你的 Worker

把 `.env.example` 复制成 `.env`,填入你的 Worker 地址:

```
VITE_API_URL=https://isee-essay-proxy.你的子域.workers.dev
VITE_APP_SECRET=        # 只有设了 Worker 的 APP_SECRET 才需要填,且要一致
```

## 第三步:改 base 路径

打开 `vite.config.js`,把 `base` 改成你的 GitHub 仓库名:

```js
base: "/isee-essay-studio/",   // 仓库叫别的名字就改成 "/仓库名/"
```

## 本地预览

```bash
npm run dev
```

打开终端给出的本地地址即可。评价功能需要 Worker 已部署且 `.env` 配好。

## 部署到 GitHub Pages

```bash
# 先把项目推到一个 GitHub 仓库(仓库名要和 vite.config.js 的 base 一致)
npm run deploy     # 自动 build 并用 gh-pages 推到 gh-pages 分支
```

然后到仓库 **Settings → Pages**,Source 选 `gh-pages` 分支。几分钟后访问:

```
https://snowdrift327.github.io/仓库名/
```

---

## 调整评分严格度

评分标准只在一个地方:`proxy/worker.js` 顶部的 `SYSTEM` 和 `buildUserMessage` 里的 calibration 段。想调严/调松,改这里再 `wrangler deploy` 即可,前端不用动。

## 安全提醒

- `.env` 和 key **绝不要**提交到公开仓库(`.gitignore` 已忽略 `.env`)。
- key 只存在 Worker 的 Secret 里,前端和 Pages 上都看不到。
- 把 `ALLOWED_ORIGIN` 限定到你的域名,可进一步防止别人借用你的 Worker。

## 题库

题目在 `src/App.jsx` 顶部的 `PROMPTS` 数组,按类型(A person / Favorites / Experience / About you / Interests / Imagine / Books)分组,可自行增删。
