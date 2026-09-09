import type { HostRecord } from "@ezshell/shared";

/**
 * 按关键字与分组筛选主机列表。
 * 关键字匹配名称、地址、用户名、标签（不区分大小写）。
 *
 * @param hosts - 全部主机
 * @param options.keyword - 搜索关键字；空则不过滤关键字
 * @param options.groupId - 分组 ID；`undefined` 不过滤；`null` 表示未分组；其它为具体分组
 * @returns 过滤后的主机数组（保持原顺序）
 */
export function filterHosts(
  hosts: HostRecord[],
  options: { keyword?: string; groupId?: string | null } = {},
): HostRecord[] {
  const keyword = options.keyword?.trim().toLowerCase() ?? "";
  return hosts.filter((host) => {
    if (options.groupId !== undefined) {
      const current = host.groupId ?? null;
      if (current !== options.groupId) {
        return false;
      }
    }
    if (!keyword) {
      return true;
    }
    const tags = (host.tags ?? []).join(" ").toLowerCase();
    const haystack =
      `${host.name} ${host.host} ${host.username} ${tags}`.toLowerCase();
    return haystack.includes(keyword);
  });
}

/**
 * 将 SSH/网络错误映射为可读中文提示。
 *
 * @param error - 原始错误对象或消息
 * @returns 面向用户的中文说明
 */
export function mapSshErrorMessage(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "未知错误";
  const lower = message.toLowerCase();

  if (
    lower.includes("authentication") ||
    lower.includes("all configured authentication methods failed") ||
    lower.includes("permission denied")
  ) {
    return "认证失败：用户名、密码或密钥不正确";
  }
  if (lower.includes("timed out") || lower.includes("timeout")) {
    return "连接超时：请检查地址、端口与网络";
  }
  if (
    lower.includes("econnrefused") ||
    lower.includes("connection refused")
  ) {
    return "连接被拒绝：目标端口可能未开放或服务未启动";
  }
  if (
    lower.includes("enotfound") ||
    lower.includes("getaddrinfo") ||
    lower.includes("host unreachable") ||
    lower.includes("network is unreachable")
  ) {
    return "主机不可达：请检查主机地址与网络";
  }
  if (lower.includes("handshake") && lower.includes("fail")) {
    return "SSH 握手失败：协议或主机密钥异常";
  }
  if (lower.includes("cancelled") || lower.includes("abort")) {
    return "连接已取消";
  }
  return message || "连接失败";
}
