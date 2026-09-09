/** EZShell 明文备份文件名建议 */
export const BACKUP_JSON_FILENAME = "ezshell-backup.json";

/** EZShell 加密备份文件名建议 */
export const BACKUP_ENCRYPTED_FILENAME = "ezshell-backup.ezb";

/** 当前备份格式版本号 */
export const BACKUP_FORMAT_VERSION = 1;

/**
 * 构造备份信封元数据。
 *
 * @param encrypted - 是否为口令加密包
 * @returns 写入文件顶层的标识字段
 */
export function createBackupEnvelope(encrypted: boolean): {
  app: "EZShell";
  version: number;
  exportedAt: string;
  encrypted: boolean;
} {
  return {
    app: "EZShell",
    version: BACKUP_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    encrypted,
  };
}

/**
 * 校验备份顶层标识是否属于 EZShell。
 *
 * @param raw - 解析后的对象
 * @returns 是否通过基础校验
 */
export function isEzshellBackup(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") {
    return false;
  }
  const obj = raw as Record<string, unknown>;
  return obj.app === "EZShell" && typeof obj.version === "number";
}
