/**
 * 解析 OpenSSH config 文本，提取非通配 Host 块。
 * 忽略 Host 名含 `*` / `?` 的通配项；同一 Host 行多个别名时取首个非通配名。
 *
 * @param content - `~/.ssh/config` 或等价文本
 * @returns 可导入的主机草稿列表（不含 id / 时间戳）
 */
export function parseOpenSshConfig(content: string): Array<{
  name: string;
  host: string;
  port: number;
  username: string;
}> {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const results: Array<{
    name: string;
    host: string;
    port: number;
    username: string;
  }> = [];

  let current: {
    names: string[];
    hostName?: string;
    user?: string;
    port?: number;
  } | null = null;

  /**
   * 将当前块冲刷到结果集。
   *
   * @returns {void}
   */
  function flush(): void {
    if (!current || current.names.length === 0) {
      current = null;
      return;
    }
    const name = current.names[0]!;
    const host = (current.hostName ?? name).trim();
    if (!host) {
      current = null;
      return;
    }
    results.push({
      name,
      host,
      port: current.port && current.port > 0 ? current.port : 22,
      username: (current.user ?? "").trim() || "root",
    });
    current = null;
  }

  for (const rawLine of lines) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) {
      continue;
    }
    const match = /^(Host|HostName|User|Port)\s+(.+)$/i.exec(line);
    if (!match) {
      continue;
    }
    const key = match[1]!.toLowerCase();
    const value = match[2]!.trim();

    if (key === "host") {
      flush();
      const names = value
        .split(/\s+/)
        .map((item) => item.trim())
        .filter((item) => item && !/[?*]/.test(item));
      if (names.length === 0) {
        current = null;
        continue;
      }
      current = { names };
      continue;
    }

    if (!current) {
      continue;
    }
    if (key === "hostname") {
      current.hostName = value;
    } else if (key === "user") {
      current.user = value;
    } else if (key === "port") {
      const port = Number(value);
      if (Number.isFinite(port) && port >= 1 && port <= 65535) {
        current.port = port;
      }
    }
  }

  flush();
  return results;
}
