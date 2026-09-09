const sshpk = require("sshpk");
const { createId } = require("./data-store.cjs");

/**
 * 密钥业务：生成、导入、指纹与公私钥读写（私钥走 SecretStore）。
 */
class KeyService {
  /**
   * @param {import('./data-store.cjs').DataStore} dataStore - 元数据仓库
   * @param {import('./secret-store.cjs').SecretStore} secretStore - 安全存储
   */
  constructor(dataStore, secretStore) {
    this.dataStore = dataStore;
    this.secretStore = secretStore;
  }

  /**
   * 列出密钥元数据。
   *
   * @returns {object[]} 密钥列表
   */
  list() {
    return this.dataStore.listKeys();
  }

  /**
   * 本地生成 Ed25519 密钥对。
   *
   * @param {string} name - 显示名称
   * @returns {{ ok: true, key: object } | { ok: false, message: string }}
   */
  generateEd25519(name) {
    const trimmed = String(name ?? "").trim();
    if (!trimmed) {
      return { ok: false, message: "请填写密钥名称" };
    }
    try {
      const privateKeyObj = sshpk.generatePrivateKey("ed25519");
      return this.persistParsedKey(trimmed, privateKeyObj, false);
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "生成密钥失败",
      };
    }
  }

  /**
   * 导入 OpenSSH/PEM 私钥（Ed25519 或 RSA）。
   *
   * @param {object} input - 导入参数
   * @param {string} input.name - 名称
   * @param {string} input.privateKey - 私钥文本
   * @param {string} [input.passphrase] - 私钥口令
   * @returns {{ ok: true, key: object } | { ok: false, message: string }}
   */
  importKey(input) {
    const name = String(input.name ?? "").trim();
    const privateKey = String(input.privateKey ?? "").trim();
    if (!name) {
      return { ok: false, message: "请填写密钥名称" };
    }
    if (!privateKey) {
      return { ok: false, message: "请粘贴私钥内容" };
    }
    try {
      const parsed = sshpk.parsePrivateKey(privateKey, "auto", {
        passphrase: input.passphrase || undefined,
      });
      const type = parsed.type === "ed25519" ? "ed25519" : "rsa";
      if (type !== "ed25519" && type !== "rsa") {
        return { ok: false, message: "仅支持 Ed25519 与 RSA 私钥" };
      }
      const hasPassphrase = Boolean(input.passphrase);
      const result = this.persistParsedKey(name, parsed, hasPassphrase, type);
      if (result.ok && input.passphrase) {
        this.secretStore.set("keyPassphrase", result.key.id, input.passphrase);
      }
      return result;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "私钥解析失败";
      if (/passphrase|encrypted/i.test(message)) {
        return { ok: false, message: "私钥已加密，请填写正确口令后重试" };
      }
      return { ok: false, message: `导入失败：${message}` };
    }
  }

  /**
   * 将解析后的私钥写入元数据与安全存储。
   *
   * @param {string} name - 名称
   * @param {object} privateKeyObj - sshpk 私钥对象
   * @param {boolean} hasPassphrase - 是否带口令
   * @param {"ed25519"|"rsa"} [forcedType] - 强制类型
   * @returns {{ ok: true, key: object } | { ok: false, message: string }}
   */
  persistParsedKey(name, privateKeyObj, hasPassphrase, forcedType) {
    const type =
      forcedType ||
      (privateKeyObj.type === "ed25519" ? "ed25519" : "rsa");
    const publicKey = privateKeyObj.toPublic().toString("ssh");
    const fingerprint = privateKeyObj.fingerprint("sha256").toString();
    const privateKeyText = privateKeyObj.toString("ssh-private");
    const now = new Date().toISOString();
    const id = createId();
    const meta = {
      id,
      name,
      type,
      fingerprint,
      publicKey,
      hasPassphrase,
      createdAt: now,
      updatedAt: now,
    };
    const saved = this.secretStore.set("privateKey", id, privateKeyText);
    if (!saved) {
      return { ok: false, message: "私钥写入安全存储失败" };
    }
    this.dataStore.saveKeyMeta(meta);
    return { ok: true, key: meta };
  }

  /**
   * 删除密钥（元数据 + 私钥 + 口令），并解除主机绑定。
   *
   * @param {string} id - 密钥 ID
   * @returns {boolean} 是否删除成功
   */
  delete(id) {
    const ok = this.dataStore.deleteKey(id);
    if (ok) {
      this.secretStore.delete("privateKey", id);
      this.secretStore.delete("keyPassphrase", id);
    }
    return ok;
  }

  /**
   * 读取公钥文本。
   *
   * @param {string} id - 密钥 ID
   * @returns {string|null} 公钥；不存在返回 null
   */
  getPublicKey(id) {
    return this.dataStore.getKey(id)?.publicKey ?? null;
  }

  /**
   * 读取连接用的私钥与口令。
   *
   * @param {string} id - 密钥 ID
   * @returns {{ privateKey: string, passphrase: string|null } | null}
   */
  getPrivateMaterial(id) {
    const privateKey = this.secretStore.get("privateKey", id);
    if (!privateKey) {
      return null;
    }
    return {
      privateKey,
      passphrase: this.secretStore.get("keyPassphrase", id),
    };
  }
}

module.exports = { KeyService };
