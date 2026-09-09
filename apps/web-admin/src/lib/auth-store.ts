import type { TokenPair } from "@ezshell/sdk";

const STORAGE_KEY = "ezshell.admin.tokens";

/**
 * 读取本地保存的令牌对。
 *
 * @returns 令牌；不存在或损坏时返回 null
 */
export function getTokens(): TokenPair | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as TokenPair;
  } catch {
    return null;
  }
}

/**
 * 写入或清除本地令牌。
 *
 * @param tokens - 令牌对；传 null 表示清除
 * @returns void
 */
export function setTokens(tokens: TokenPair | null): void {
  if (!tokens) {
    localStorage.removeItem(STORAGE_KEY);
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
}
