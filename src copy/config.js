// 部署后,把评价请求指向你自己的代理(Cloudflare Worker / Vercel function)。
// 推荐用 .env 里的 VITE_API_URL 覆盖(见 .env.example),这样不用改源码。
export const API_URL =
  import.meta.env.VITE_API_URL || "REPLACE_WITH_YOUR_PROXY_URL";

// 可选:与 Worker 的 APP_SECRET 配套,做个简单防盗用。不需要就留空。
export const APP_SECRET = import.meta.env.VITE_APP_SECRET || "";
