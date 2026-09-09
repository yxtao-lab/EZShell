import { createApp } from "vue";
import App from "./App.vue";
import { router } from "./router";
import "@ezshell/ui-tokens/css";
import "./styles.css";

/**
 * 在页面上展示启动失败信息，避免黑屏无反馈。
 *
 * @param {unknown} error - 启动异常
 * @returns {void}
 */
function showBootError(error: unknown): void {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  document.body.innerHTML = `<pre style="color:#fecaca;background:#0f1419;padding:24px;white-space:pre-wrap;font:13px/1.5 monospace;">EZShell 启动失败：\n\n${message}</pre>`;
}

try {
  createApp(App).use(router).mount("#app");
} catch (error) {
  showBootError(error);
}

window.addEventListener("unhandledrejection", (event) => {
  console.error(event.reason);
});
