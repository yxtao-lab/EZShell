/**
 * 生成本地实体 ID（主机、分组、密钥、会话等）。
 *
 * @returns 形如 `ez_` 前缀的唯一字符串
 */
export function createId(): string {
  const webCrypto = (
    globalThis as {
      crypto?: { randomUUID?: () => string };
    }
  ).crypto;

  if (typeof webCrypto?.randomUUID === "function") {
    return `ez_${webCrypto.randomUUID().replace(/-/g, "")}`;
  }

  return `ez_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
