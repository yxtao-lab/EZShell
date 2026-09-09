import type { HostRecord } from "@ezshell/shared";

/**
 * 将片段中的变量占位符替换为当前会话主机信息。
 * 支持：`{host}` `{user}` `{name}` `{port}`。
 *
 * @param template - 片段原文
 * @param host - 当前活动会话关联主机；缺少字段时用空字符串替换
 * @returns 替换后的命令文本
 */
export function applySnippetVariables(
  template: string,
  host: Pick<HostRecord, "host" | "username" | "name" | "port">,
): string {
  return template
    .replaceAll("{host}", host.host ?? "")
    .replaceAll("{user}", host.username ?? "")
    .replaceAll("{name}", host.name ?? "")
    .replaceAll("{port}", String(host.port ?? ""));
}

/**
 * 判断两台主机是否为同一连接目标（导入去重用）。
 * 规则：主机地址 + 端口 + 用户名（忽略大小写后比较地址与用户）。
 *
 * @param a - 主机 A
 * @param b - 主机 B
 * @returns 是否视为同一主机
 */
export function isSameHostTarget(
  a: Pick<HostRecord, "host" | "port" | "username">,
  b: Pick<HostRecord, "host" | "port" | "username">,
): boolean {
  return (
    a.host.trim().toLowerCase() === b.host.trim().toLowerCase() &&
    a.port === b.port &&
    a.username.trim().toLowerCase() === b.username.trim().toLowerCase()
  );
}
