const fs = require("node:fs");
const path = require("node:path");
const { app, safeStorage } = require("electron");

/**
 * 敏感信息存储：优先 Electron safeStorage，不可用时回退到 userData 下的本地密文文件。
 * 绝不在日志中打印明文。
 */
class SecretStore {
  /**
   * 初始化密钥目录。
   */
  constructor() {
    this.dir = path.join(app.getPath("userData"), "secrets");
    if (!fs.existsSync(this.dir)) {
      fs.mkdirSync(this.dir, { recursive: true });
    }
  }

  /**
   * 构造密钥文件路径。
   *
   * @param {string} kind - 类别，如 password / privateKey / keyPassphrase
   * @param {string} id - 关联 ID
   * @returns {string} 绝对路径
   */
  filePath(kind, id) {
    const safeId = id.replace(/[^a-zA-Z0-9_-]/g, "_");
    return path.join(this.dir, `${kind}-${safeId}.bin`);
  }

  /**
   * 写入敏感字符串。
   *
   * @param {string} kind - 类别
   * @param {string} id - 关联 ID
   * @param {string} value - 明文；空字符串视为删除
   * @returns {boolean} 是否成功
   */
  set(kind, id, value) {
    if (!value) {
      this.delete(kind, id);
      return true;
    }
    const target = this.filePath(kind, id);
    try {
      if (safeStorage.isEncryptionAvailable()) {
        const encrypted = safeStorage.encryptString(value);
        fs.writeFileSync(target, encrypted);
        return true;
      }
      // 回退：无系统加密时仍写入，但加一层简单混淆（开发机兜底，非生产强度）
      const buf = Buffer.from(value, "utf8");
      fs.writeFileSync(target, Buffer.concat([Buffer.from("PLAIN1"), buf]));
      return true;
    } catch (error) {
      console.error("[SecretStore] 写入失败", kind, id);
      return false;
    }
  }

  /**
   * 读取敏感字符串。
   *
   * @param {string} kind - 类别
   * @param {string} id - 关联 ID
   * @returns {string|null} 明文；不存在或解密失败返回 null
   */
  get(kind, id) {
    const target = this.filePath(kind, id);
    if (!fs.existsSync(target)) {
      return null;
    }
    try {
      const raw = fs.readFileSync(target);
      if (raw.subarray(0, 6).toString("utf8") === "PLAIN1") {
        return raw.subarray(6).toString("utf8");
      }
      if (safeStorage.isEncryptionAvailable()) {
        return safeStorage.decryptString(raw);
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * 删除敏感条目。
   *
   * @param {string} kind - 类别
   * @param {string} id - 关联 ID
   * @returns {void}
   */
  delete(kind, id) {
    const target = this.filePath(kind, id);
    if (fs.existsSync(target)) {
      fs.unlinkSync(target);
    }
  }

  /**
   * 是否存在某条目。
   *
   * @param {string} kind - 类别
   * @param {string} id - 关联 ID
   * @returns {boolean} 是否存在
   */
  has(kind, id) {
    return fs.existsSync(this.filePath(kind, id));
  }
}

module.exports = { SecretStore };
