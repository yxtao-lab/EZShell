const fs = require("node:fs");
const path = require("node:path");
const {
  parseOpenSshConfig,
  parseMobaSessions,
  decodeMobaText,
  isSameHostTarget,
  BACKUP_JSON_FILENAME,
  BACKUP_ENCRYPTED_FILENAME,
} = require("@ezshell/core");

/**
 * 导入导出与备份服务（主进程）。
 */
class ImportExportService {
  /**
   * @param {object} deps
   * @param {import('./data-store.cjs').DataStore} deps.dataStore
   * @param {import('./secret-store.cjs').SecretStore} deps.secretStore
   * @param {import('./key-service.cjs').KeyService} deps.keyService
   */
  constructor({ dataStore, secretStore, keyService }) {
    this.dataStore = dataStore;
    this.secretStore = secretStore;
    this.keyService = keyService;
  }

  /**
   * 延迟加载仅 Node 可用的备份加解密模块。
   *
   * @returns {typeof import('@ezshell/core/backup-crypto')}
   */
  backupCrypto() {
    return require("@ezshell/core/backup-crypto");
  }

  /**
   * 导出备份到指定路径。
   *
   * @param {object} options
   * @param {string} options.filePath - 目标文件
   * @param {boolean} [options.encrypted] - 是否加密
   * @param {string} [options.password] - 口令
   * @param {boolean} [options.includeSecrets] - 是否包含密码与私钥
   * @returns {Promise<{ ok: boolean, message?: string, filePath?: string }>}
   */
  async exportBackup(options) {
    try {
      const snapshot = this.dataStore.exportSnapshot();
      /** @type {import('@ezshell/core/backup-crypto').BackupPayload} */
      const payload = {
        hosts: snapshot.hosts,
        groups: snapshot.groups,
        snippets: snapshot.snippets,
        forwards: snapshot.forwards,
      };

      if (options.includeSecrets) {
        const passwords = {};
        for (const host of snapshot.hosts) {
          const pwd = this.secretStore.get("password", host.id);
          if (pwd) {
            passwords[host.id] = pwd;
          }
        }
        payload.passwords = passwords;
        payload.keys = [];
        for (const meta of snapshot.keys) {
          const material = this.keyService.getPrivateMaterial(meta.id);
          if (material) {
            payload.keys.push({
              meta,
              privateKey: material.privateKey,
              passphrase: material.passphrase ?? null,
            });
          }
        }
      }

      const { buildPlainBackup, encryptBackup } = this.backupCrypto();
      const doc = options.encrypted
        ? encryptBackup(payload, options.password || "")
        : buildPlainBackup(payload);

      fs.writeFileSync(options.filePath, JSON.stringify(doc, null, 2), "utf8");
      return { ok: true, filePath: options.filePath };
    } catch (error) {
      return { ok: false, message: String(error?.message || error) };
    }
  }

  /**
   * 导入 EZShell 备份。
   *
   * @param {object} options
   * @param {string} options.filePath
   * @param {string} [options.password]
   * @param {'merge'|'replace'} [options.mode]
   * @returns {Promise<{ ok: boolean, message?: string, imported?: object }>}
   */
  async importBackup(options) {
    try {
      const raw = JSON.parse(fs.readFileSync(options.filePath, "utf8"));
      const { openBackup } = this.backupCrypto();
      const payload = openBackup(raw, options.password);
      const mode = options.mode === "replace" ? "replace" : "merge";

      if (mode === "replace") {
        // 先停用侧不在此服务；调用方应先 stop 转发
        this.dataStore.replaceConfig({
          hosts: [],
          groups: [],
          snippets: [],
          forwards: [],
        });
      }

      const groupIdMap = new Map();
      for (const group of payload.groups) {
        const g = /** @type {any} */ (group);
        const result = this.dataStore.upsertGroup({ name: g.name });
        if (result.ok && g.id) {
          groupIdMap.set(g.id, result.group.id);
        }
      }

      let hostCount = 0;
      for (const host of payload.hosts) {
        const h = /** @type {any} */ (host);
        const existing = this.dataStore
          .listHosts()
          .find((item) =>
            isSameHostTarget(item, {
              host: h.host,
              port: Number(h.port),
              username: h.username,
            }),
          );
        if (existing && mode === "merge") {
          continue;
        }
        const result = this.dataStore.upsertHost({
          name: h.name,
          host: h.host,
          port: h.port,
          username: h.username,
          authMethod: h.authMethod === "privateKey" ? "privateKey" : "password",
          groupId: h.groupId ? groupIdMap.get(h.groupId) ?? null : null,
          remark: h.remark ?? "",
          tags: h.tags ?? [],
          hostFingerprint: h.hostFingerprint ?? null,
        });
        if (result.ok) {
          hostCount += 1;
          const oldId = h.id;
          if (payload.passwords?.[oldId]) {
            this.secretStore.set("password", result.host.id, payload.passwords[oldId]);
          }
        }
      }

      let snippetCount = 0;
      for (const snippet of payload.snippets) {
        const s = /** @type {any} */ (snippet);
        const result = this.dataStore.upsertSnippet({
          title: s.title,
          content: s.content,
          category: s.category,
          autoNewline: s.autoNewline !== false,
        });
        if (result.ok) {
          snippetCount += 1;
        }
      }

      let forwardCount = 0;
      // 覆盖模式下转发需重新映射 hostId，合并时暂跳过无映射的规则
      for (const forward of payload.forwards) {
        const f = /** @type {any} */ (forward);
        const hosts = this.dataStore.listHosts();
        const matchedHost =
          hosts.find((item) => item.id === f.hostId) ||
          hosts.find((item) => item.name === f.hostName);
        if (!matchedHost) {
          continue;
        }
        const result = this.dataStore.upsertForward({
          name: f.name,
          hostId: matchedHost.id,
          type: f.type === "remote" ? "remote" : "local",
          bindPort: f.bindPort,
          targetHost: f.targetHost,
          targetPort: f.targetPort,
          enabled: false,
        });
        if (result.ok) {
          forwardCount += 1;
        }
      }

      if (Array.isArray(payload.keys)) {
        for (const item of payload.keys) {
          const meta = /** @type {any} */ (item.meta);
          await this.keyService.importKey({
            name: meta?.name || "imported-key",
            privateKey: item.privateKey,
            passphrase: item.passphrase || undefined,
          });
        }
      }

      return {
        ok: true,
        imported: { hosts: hostCount, snippets: snippetCount, forwards: forwardCount },
        message: `已导入主机 ${hostCount}、片段 ${snippetCount}、转发 ${forwardCount}`,
      };
    } catch (error) {
      return { ok: false, message: String(error?.message || error) };
    }
  }

  /**
   * 导入 OpenSSH config。
   *
   * @param {string} filePath
   * @returns {{ ok: boolean, message?: string, imported?: number }}
   */
  importOpenSsh(filePath) {
    try {
      const content = fs.readFileSync(filePath, "utf8");
      const drafts = parseOpenSshConfig(content);
      let imported = 0;
      const existing = this.dataStore.listHosts();
      for (const draft of drafts) {
        if (
          existing.some((item) =>
            isSameHostTarget(item, {
              host: draft.host,
              port: draft.port,
              username: draft.username,
            }),
          )
        ) {
          continue;
        }
        const result = this.dataStore.upsertHost({
          name: draft.name,
          host: draft.host,
          port: draft.port,
          username: draft.username,
          authMethod: "password",
        });
        if (result.ok) {
          imported += 1;
          existing.push(result.host);
        }
      }
      return { ok: true, imported, message: `已导入 ${imported} 台主机` };
    } catch (error) {
      return { ok: false, message: String(error?.message || error) };
    }
  }

  /**
   * 导入 MobaXterm 会话文件。
   *
   * @param {string} filePath
   * @returns {{ ok: boolean, message?: string, imported?: number }}
   */
  importMoba(filePath) {
    try {
      const buffer = fs.readFileSync(filePath);
      const content = decodeMobaText(buffer);
      const drafts = parseMobaSessions(content);
      let imported = 0;
      const existing = this.dataStore.listHosts();
      for (const draft of drafts) {
        if (
          existing.some((item) =>
            isSameHostTarget(item, {
              host: draft.host,
              port: draft.port,
              username: draft.username,
            }),
          )
        ) {
          continue;
        }
        let groupId = null;
        if (draft.groupName) {
          const leaf = draft.groupName.split("/").filter(Boolean).pop();
          const group = this.dataStore.ensureGroupByName(leaf || draft.groupName);
          groupId = group?.id ?? null;
        }
        const result = this.dataStore.upsertHost({
          name: draft.name,
          host: draft.host,
          port: draft.port,
          username: draft.username,
          authMethod: "password",
          groupId,
          remark: draft.remark,
          hostFingerprint: draft.hostFingerprint,
        });
        if (result.ok) {
          imported += 1;
          existing.push(result.host);
        }
      }
      return {
        ok: true,
        imported,
        message: `已导入 ${imported} 台 SSH 主机（已跳过非 #109# 会话）`,
      };
    } catch (error) {
      return { ok: false, message: String(error?.message || error) };
    }
  }

  /**
   * 建议的备份文件名。
   *
   * @param {boolean} encrypted
   * @returns {string}
   */
  suggestedBackupName(encrypted) {
    return encrypted ? BACKUP_ENCRYPTED_FILENAME : BACKUP_JSON_FILENAME;
  }
}

module.exports = { ImportExportService };
