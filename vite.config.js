import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 把 base 改成你的 GitHub 仓库名,前后都要有斜杠。
// 例如仓库叫 isee-essay-studio -> base: "/isee-essay-studio/"
// 如果部署在用户主页仓库(snowdrift327.github.io)根目录,则改成 "/"。
export default defineConfig({
  plugins: [react()],
  base: "/isee-essay-studio/",
});