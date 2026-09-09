import type { EzshellDesktopApi } from "../types/ezshell";

/**
 * 获取预加载注入的桌面 API。
 *
 * @returns 桌面桥接 API；未注入时返回 null（避免直接抛错导致整页白屏）
 */
export function getDesktopApi(): EzshellDesktopApi | null {
  return window.ezshell ?? null;
}

/**
 * 获取桌面 API；缺失时抛出可读错误。
 *
 * @returns 桌面桥接 API
 * @throws {Error} 未在 Electron 中启动时抛出
 */
export function requireDesktopApi(): EzshellDesktopApi {
  const api = getDesktopApi();
  if (!api) {
    throw new Error("未检测到 EZShell 桌面桥接，请使用 pnpm dev:desktop 启动");
  }
  return api;
}
