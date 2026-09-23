import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import path from "node:path";

const packagesRoot = path.resolve(__dirname, "../../packages");

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // 直接指向源码，避免 Vite 吃 CJS dist 时丢失具名导出导致白屏
      "@ezshell/core": path.join(packagesRoot, "core/src/index.ts"),
      "@ezshell/shared": path.join(packagesRoot, "shared/src/index.ts"),
      "@ezshell/ui-tokens/css": path.join(packagesRoot, "ui-tokens/src/tokens.css"),
      "@ezshell/ui-tokens": path.join(packagesRoot, "ui-tokens/src/index.ts"),
      "@ezshell/sdk": path.join(packagesRoot, "sdk/src/index.ts"),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5174,
    strictPort: true,
  },
  base: "./",
  optimizeDeps: {
    include: ["@xterm/xterm", "@xterm/addon-fit", "naive-ui"],
    exclude: ["@ezshell/core", "@ezshell/shared", "@ezshell/ui-tokens", "@ezshell/sdk"],
  },
});
