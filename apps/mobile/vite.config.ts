import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import path from "node:path";

const packagesRoot = path.resolve(__dirname, "../../packages");

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // 直接指向源码，避免 Vite 吃 CJS dist 时丢失具名导出
      "@ezshell/shared": path.join(packagesRoot, "shared/src/index.ts"),
      "@ezshell/ui-tokens/css": path.join(packagesRoot, "ui-tokens/src/tokens.css"),
      "@ezshell/ui-tokens": path.join(packagesRoot, "ui-tokens/src/index.ts"),
      "@ezshell/sdk": path.join(packagesRoot, "sdk/src/index.ts"),
    },
  },
  server: {
    port: 5175,
    strictPort: true,
  },
  optimizeDeps: {
    exclude: ["@ezshell/shared", "@ezshell/ui-tokens", "@ezshell/sdk"],
  },
});
