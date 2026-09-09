import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import vue from "@vitejs/plugin-vue";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const packagesRoot = path.resolve(root, "../../packages");
const electronMain = path.join(root, "electron/main.cjs");

/**
 * 等待 Vite 可访问后再拉起 Electron，避免首屏空白。
 *
 * @param {string} url - 开发服务器地址
 * @param {number} [timeoutMs=20000] - 超时毫秒
 * @returns {Promise<void>}
 */
async function waitForVite(url, timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // 继续重试
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`等待 Vite 就绪超时：${url}`);
}

/**
 * 启动 Vite 开发服务器并拉起 Electron；渲染层走 Vite HMR，主进程文件变更自动重启窗口进程。
 *
 * @returns {Promise<void>}
 */
async function main() {
  const server = await createServer({
    configFile: false,
    root,
    plugins: [vue()],
    resolve: {
      alias: {
        "@": path.resolve(root, "src"),
        "@ezshell/core": path.resolve(packagesRoot, "core/src/index.ts"),
        "@ezshell/shared": path.resolve(packagesRoot, "shared/src/index.ts"),
        "@ezshell/ui-tokens/css": path.resolve(
          packagesRoot,
          "ui-tokens/src/tokens.css",
        ),
        "@ezshell/ui-tokens": path.resolve(
          packagesRoot,
          "ui-tokens/src/index.ts",
        ),
        "@ezshell/sdk": path.resolve(packagesRoot, "sdk/src/index.ts"),
      },
    },
    server: {
      port: 5174,
      strictPort: true,
    },
    optimizeDeps: {
      include: ["@xterm/xterm", "@xterm/addon-fit"],
      exclude: [
        "@ezshell/core",
        "@ezshell/shared",
        "@ezshell/ui-tokens",
        "@ezshell/sdk",
      ],
    },
  });

  await server.listen();
  const address = server.resolvedUrls?.local[0] ?? "http://localhost:5174";
  await waitForVite(address);
  // eslint-disable-next-line no-console
  console.log(`桌面渲染进程：${address}（支持 Vite 热更新）`);

  const electronBin = require.resolve("electron/cli.js");
  /** @type {import('node:child_process').ChildProcess | null} */
  let child = null;
  let restarting = false;

  /**
   * 启动或重启 Electron 主进程。
   *
   * @returns {void}
   */
  const startElectron = () => {
    if (child) {
      restarting = true;
      child.kill();
      child = null;
    }
    child = spawn(process.execPath, [electronBin, electronMain], {
      env: {
        ...process.env,
        VITE_DEV_SERVER_URL: address,
      },
      stdio: "inherit",
    });
    child.on("exit", (code) => {
      if (restarting) {
        restarting = false;
        return;
      }
      void shutdown(code ?? 0);
    });
  };

  startElectron();

  const watchDir = path.join(root, "electron");
  let reloadTimer = /** @type {NodeJS.Timeout | null} */ (null);
  fs.watch(watchDir, { recursive: true }, (_event, filename) => {
    if (!filename || !/\.(cjs|js)$/.test(filename)) {
      return;
    }
    // eslint-disable-next-line no-console
    console.log(`[electron] 检测到主进程变更：${filename}，正在重启…`);
    if (reloadTimer) {
      clearTimeout(reloadTimer);
    }
    reloadTimer = setTimeout(() => {
      startElectron();
    }, 300);
  });

  /**
   * 退出时关闭 Vite 与 Electron。
   *
   * @param {number} [code=0] - 进程退出码
   * @returns {Promise<void>}
   */
  const shutdown = async (code = 0) => {
    if (child) {
      child.kill();
      child = null;
    }
    await server.close();
    process.exit(code);
  };

  process.on("SIGINT", () => {
    void shutdown(0);
  });
  process.on("SIGTERM", () => {
    void shutdown(0);
  });
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
