/** Moba 导入产生的主机草稿 */
export interface MobaHostDraft {
  name: string;
  host: string;
  port: number;
  username: string;
  groupName: string | null;
  remark: string;
  hostFingerprint: string | null;
}

/**
 * 解码 Moba 导出文本：优先 UTF-8，非法序列时回退 Latin1。
 *
 * @param buffer - 原始字节
 * @returns 文本内容
 */
export function decodeMobaText(buffer: Uint8Array): string {
  const utf8 = new TextDecoder("utf-8", { fatal: true });
  try {
    return utf8.decode(buffer);
  } catch {
    return new TextDecoder("latin1").decode(buffer);
  }
}

/**
 * 解析 MobaXterm `.mxtsessions` / `.mobaconf` / ini 导出。
 * 仅导入协议码 `#109#` 的 SSH 会话；同 host+port+user 由调用方去重。
 *
 * @param content - 已解码文本
 * @returns 主机草稿列表
 */
export function parseMobaSessions(content: string): MobaHostDraft[] {
  const text = content.replace(/\r\n/g, "\n");
  const sectionRegex = /^\[Bookmarks(?:_(\d+))?\]\s*$/im;
  const lines = text.split("\n");
  const drafts: MobaHostDraft[] = [];
  let groupName: string | null = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (sectionRegex.test(line.trim())) {
      groupName = null;
      continue;
    }

    const subRep = /^SubRep=(.*)$/i.exec(line.trim());
    if (subRep) {
      const raw = subRep[1]!.trim();
      groupName = raw ? raw.replace(/\\/g, "/") : null;
      continue;
    }

    if (/^ImgNum=/i.test(line.trim())) {
      continue;
    }

    const eq = line.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const sessionName = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (!sessionName || !value.includes("#109#")) {
      continue;
    }

    const parsed = parseMobaSshValue(sessionName, value, groupName);
    if (parsed) {
      drafts.push(parsed);
    }
  }

  return drafts;
}

/**
 * 解析单行 `#109#` SSH 会话值。
 *
 * @param sessionName - 等号左侧会话名
 * @param value - 等号右侧整段
 * @param groupName - 当前 Bookmarks 的 SubRep
 * @returns 主机草稿；无法解析时返回 null
 */
function parseMobaSshValue(
  sessionName: string,
  value: string,
  groupName: string | null,
): MobaHostDraft | null {
  const marker = value.indexOf("#109#");
  if (marker < 0) {
    return null;
  }
  const body = value.slice(marker + "#109#".length);
  // 终端字体段以 `#MobaFont` / `#Mono` 等开始，截断以免干扰字段
  const cut = body.search(/#(?:MobaFont|Mono|0#)/);
  const payload = cut >= 0 ? body.slice(0, cut) : body;
  const fields = payload.split("%");
  // 常见：0%host%port%user%...
  const host = (fields[1] ?? "").trim();
  const portRaw = Number(fields[2] ?? "22");
  const username = (fields[3] ?? "").trim();
  if (!host) {
    return null;
  }
  const port =
    Number.isFinite(portRaw) && portRaw >= 1 && portRaw <= 65535 ? portRaw : 22;

  const fingerprint = extractFingerprint(value);

  return {
    name: sessionName,
    host,
    port,
    username: username || "root",
    groupName,
    remark:
      "从 MobaXterm 导入：原密码为专有加密无法还原，请自行填写密码或改用密钥认证。",
    hostFingerprint: fingerprint,
  };
}

/**
 * 尽力从行内提取 SHA256 主机指纹。
 *
 * @param value - 原始会话行
 * @returns 规范化指纹或 null
 */
function extractFingerprint(value: string): string | null {
  const match = /SHA256:([A-Za-z0-9+/=]+)/.exec(value);
  if (!match) {
    return null;
  }
  return `SHA256:${match[1]!.replace(/=+$/, "")}`;
}
