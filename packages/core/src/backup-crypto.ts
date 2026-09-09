import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from "node:crypto";
import { BACKUP_FORMAT_VERSION, createBackupEnvelope, isEzshellBackup } from "./backup";

/** 备份载荷（明文结构） */
export interface BackupPayload {
  hosts: unknown[];
  groups: unknown[];
  snippets: unknown[];
  forwards: unknown[];
  /** 可选：主机密码映射 hostId -> password */
  passwords?: Record<string, string>;
  /** 可选：密钥材料（仅本地导出） */
  keys?: Array<{
    meta: unknown;
    privateKey: string;
    passphrase?: string | null;
  }>;
}

const PBKDF2_ITERATIONS = 120_000;
const SALT_LEN = 16;
const IV_LEN = 12;
const KEY_LEN = 32;

/**
 * 构造可写入磁盘的明文备份对象。
 *
 * @param payload - 业务载荷
 * @returns 含信封的完整 JSON 对象
 */
export function buildPlainBackup(payload: BackupPayload): Record<string, unknown> {
  return {
    ...createBackupEnvelope(false),
    payload,
  };
}

/**
 * 使用口令加密备份载荷，产出 `.ezb` JSON 结构。
 *
 * @param payload - 业务载荷
 * @param password - 用户口令
 * @returns 加密备份对象
 * @throws {Error} 口令为空时抛出
 */
export function encryptBackup(
  payload: BackupPayload,
  password: string,
): Record<string, unknown> {
  if (!password) {
    throw new Error("请设置备份口令");
  }
  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const key = pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, KEY_LEN, "sha256");
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plain = Buffer.from(JSON.stringify(payload), "utf8");
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ...createBackupEnvelope(true),
    kdf: "pbkdf2-sha256",
    iterations: PBKDF2_ITERATIONS,
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: encrypted.toString("base64"),
  };
}

/**
 * 解析并校验备份文件，必要时用口令解密。
 *
 * @param raw - 解析后的 JSON 对象
 * @param password - 加密备份口令；明文时可省略
 * @returns 解密后的载荷
 * @throws {Error} 格式错误或口令错误时抛出（message 为中文）
 */
export function openBackup(
  raw: unknown,
  password?: string,
): BackupPayload {
  if (!isEzshellBackup(raw)) {
    throw new Error("不是有效的 EZShell 备份文件");
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.version === "number" && obj.version > BACKUP_FORMAT_VERSION) {
    throw new Error("备份版本过高，请升级客户端后再导入");
  }

  if (!obj.encrypted) {
    const payload = obj.payload;
    if (!payload || typeof payload !== "object") {
      throw new Error("备份内容损坏：缺少 payload");
    }
    return normalizePayload(payload as Record<string, unknown>);
  }

  if (!password) {
    throw new Error("该备份已加密，请输入口令");
  }

  try {
    const salt = Buffer.from(String(obj.salt ?? ""), "base64");
    const iv = Buffer.from(String(obj.iv ?? ""), "base64");
    const tag = Buffer.from(String(obj.tag ?? ""), "base64");
    const ciphertext = Buffer.from(String(obj.ciphertext ?? ""), "base64");
    const iterations = Number(obj.iterations ?? PBKDF2_ITERATIONS);
    const key = pbkdf2Sync(password, salt, iterations, KEY_LEN, "sha256");
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const payload = JSON.parse(plain.toString("utf8")) as Record<string, unknown>;
    return normalizePayload(payload);
  } catch (error) {
    if (error instanceof Error && error.message.includes("口令")) {
      throw error;
    }
    throw new Error("备份口令错误或文件已损坏");
  }
}

/**
 * 规范化载荷字段，缺省为空数组。
 *
 * @param payload - 原始对象
 * @returns 规范化 BackupPayload
 */
function normalizePayload(payload: Record<string, unknown>): BackupPayload {
  return {
    hosts: Array.isArray(payload.hosts) ? payload.hosts : [],
    groups: Array.isArray(payload.groups) ? payload.groups : [],
    snippets: Array.isArray(payload.snippets) ? payload.snippets : [],
    forwards: Array.isArray(payload.forwards) ? payload.forwards : [],
    passwords:
      payload.passwords && typeof payload.passwords === "object"
        ? (payload.passwords as Record<string, string>)
        : undefined,
    keys: Array.isArray(payload.keys) ? (payload.keys as BackupPayload["keys"]) : undefined,
  };
}
