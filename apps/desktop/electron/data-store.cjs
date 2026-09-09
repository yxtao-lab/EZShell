const fs = require("node:fs");
const path = require("node:path");
const { app } = require("electron");
const { randomUUID } = require("node:crypto");

/**
 * 生成本地实体 ID。
 *
 * @returns {string} 唯一 ID
 */
function createId() {
  return `ez_${randomUUID().replace(/-/g, "")}`;
}

/**
 * 本地元数据仓库：主机、分组、密钥元数据、片段、转发规则。
 */
class DataStore {
  /**
   * @param {string} [filePath] - 可选自定义路径；默认 userData/ezshell-data.json
   */
  constructor(filePath) {
    this.filePath =
      filePath || path.join(app.getPath("userData"), "ezshell-data.json");
    this.data = {
      hosts: [],
      groups: [],
      keys: [],
      snippets: [],
      forwards: [],
    };
    this.load();
  }

  /**
   * 从磁盘加载；文件不存在则写入空结构。
   *
   * @returns {void}
   */
  load() {
    try {
      if (!fs.existsSync(this.filePath)) {
        this.persist();
        return;
      }
      const raw = fs.readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      this.data = {
        hosts: Array.isArray(parsed.hosts) ? parsed.hosts : [],
        groups: Array.isArray(parsed.groups) ? parsed.groups : [],
        keys: Array.isArray(parsed.keys) ? parsed.keys : [],
        snippets: Array.isArray(parsed.snippets) ? parsed.snippets : [],
        forwards: Array.isArray(parsed.forwards) ? parsed.forwards : [],
      };
    } catch (error) {
      console.error("[DataStore] 加载失败，将使用空数据", error);
      this.data = {
        hosts: [],
        groups: [],
        keys: [],
        snippets: [],
        forwards: [],
      };
    }
  }

  /**
   * 原子写入磁盘（先写临时文件再替换）。
   *
   * @returns {void}
   */
  persist() {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const tempPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(this.data, null, 2), "utf8");
    fs.renameSync(tempPath, this.filePath);
  }

  /**
   * @returns {object[]} 主机列表副本
   */
  listHosts() {
    return structuredClone(this.data.hosts);
  }

  /**
   * @param {string} id - 主机 ID
   * @returns {object|null} 主机或 null
   */
  getHost(id) {
    const host = this.data.hosts.find((item) => item.id === id);
    return host ? structuredClone(host) : null;
  }

  /**
   * 新建或更新主机。
   *
   * @param {object} input - 主机字段（含或不含 id）
   * @returns {{ ok: true, host: object } | { ok: false, errors: object[] }}
   */
  upsertHost(input) {
    const { validateHostInput } = require("@ezshell/shared");
    const errors = validateHostInput({
      name: input.name,
      host: input.host,
      port: Number(input.port),
      username: input.username,
    });
    if (errors.length > 0) {
      return { ok: false, errors };
    }

    const now = new Date().toISOString();
    if (input.id) {
      const index = this.data.hosts.findIndex((item) => item.id === input.id);
      if (index < 0) {
        return {
          ok: false,
          errors: [{ field: "id", code: "NOT_FOUND", message: "主机不存在" }],
        };
      }
      const prev = this.data.hosts[index];
      const next = {
        ...prev,
        name: String(input.name).trim(),
        host: String(input.host).trim(),
        port: Number(input.port),
        username: String(input.username).trim(),
        authMethod: input.authMethod === "privateKey" ? "privateKey" : "password",
        keyId: input.keyId ?? null,
        groupId: input.groupId ?? null,
        jumpHostId: input.jumpHostId ?? null,
        tags: Array.isArray(input.tags) ? input.tags : prev.tags ?? [],
        remark: input.remark ?? "",
        hostFingerprint:
          input.hostFingerprint !== undefined
            ? input.hostFingerprint
            : prev.hostFingerprint ?? null,
        updatedAt: now,
      };
      this.data.hosts[index] = next;
      this.persist();
      return { ok: true, host: structuredClone(next) };
    }

    const host = {
      id: createId(),
      name: String(input.name).trim(),
      host: String(input.host).trim(),
      port: Number(input.port),
      username: String(input.username).trim(),
      authMethod: input.authMethod === "privateKey" ? "privateKey" : "password",
      keyId: input.keyId ?? null,
      groupId: input.groupId ?? null,
      jumpHostId: null,
      tags: Array.isArray(input.tags) ? input.tags : [],
      remark: input.remark ?? "",
      hostFingerprint: input.hostFingerprint ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.data.hosts.push(host);
    this.persist();
    return { ok: true, host: structuredClone(host) };
  }

  /**
   * 删除主机；同步清理转发规则。
   *
   * @param {string} id - 主机 ID
   * @returns {boolean} 是否删除成功
   */
  deleteHost(id) {
    const before = this.data.hosts.length;
    this.data.hosts = this.data.hosts.filter((item) => item.id !== id);
    if (this.data.hosts.length === before) {
      return false;
    }
    this.data.forwards = this.data.forwards.filter((item) => item.hostId !== id);
    this.persist();
    return true;
  }

  /**
   * 更新已确认的主机指纹。
   *
   * @param {string} id - 主机 ID
   * @param {string} fingerprint - 指纹字符串
   * @returns {object|null} 更新后的主机
   */
  setHostFingerprint(id, fingerprint) {
    const host = this.data.hosts.find((item) => item.id === id);
    if (!host) {
      return null;
    }
    host.hostFingerprint = fingerprint;
    host.updatedAt = new Date().toISOString();
    this.persist();
    return structuredClone(host);
  }

  /**
   * @returns {object[]} 分组列表
   */
  listGroups() {
    return structuredClone(this.data.groups);
  }

  /**
   * 按名称查找分组；不存在则创建。
   *
   * @param {string} name - 分组名
   * @returns {object} 分组
   */
  ensureGroupByName(name) {
    const trimmed = String(name ?? "").trim();
    if (!trimmed) {
      return null;
    }
    const existing = this.data.groups.find((item) => item.name === trimmed);
    if (existing) {
      return structuredClone(existing);
    }
    const result = this.upsertGroup({ name: trimmed });
    return result.ok ? result.group : null;
  }

  /**
   * 新建或重命名分组。
   *
   * @param {{ id?: string, name: string }} input - 分组输入
   * @returns {{ ok: true, group: object } | { ok: false, message: string }}
   */
  upsertGroup(input) {
    const name = String(input.name ?? "").trim();
    if (!name) {
      return { ok: false, message: "请填写分组名称" };
    }
    const now = new Date().toISOString();
    if (input.id) {
      const group = this.data.groups.find((item) => item.id === input.id);
      if (!group) {
        return { ok: false, message: "分组不存在" };
      }
      group.name = name;
      group.updatedAt = now;
      this.persist();
      return { ok: true, group: structuredClone(group) };
    }
    const group = {
      id: createId(),
      name,
      sortOrder: this.data.groups.length,
      createdAt: now,
      updatedAt: now,
    };
    this.data.groups.push(group);
    this.persist();
    return { ok: true, group: structuredClone(group) };
  }

  /**
   * 删除分组；所属主机变为未分组。
   *
   * @param {string} id - 分组 ID
   * @returns {boolean} 是否删除成功
   */
  deleteGroup(id) {
    const before = this.data.groups.length;
    this.data.groups = this.data.groups.filter((item) => item.id !== id);
    if (this.data.groups.length === before) {
      return false;
    }
    for (const host of this.data.hosts) {
      if (host.groupId === id) {
        host.groupId = null;
        host.updatedAt = new Date().toISOString();
      }
    }
    this.persist();
    return true;
  }

  /**
   * @returns {object[]} 密钥元数据列表
   */
  listKeys() {
    return structuredClone(this.data.keys);
  }

  /**
   * @param {string} id - 密钥 ID
   * @returns {object|null} 密钥元数据
   */
  getKey(id) {
    const key = this.data.keys.find((item) => item.id === id);
    return key ? structuredClone(key) : null;
  }

  /**
   * 写入密钥元数据。
   *
   * @param {object} meta - 密钥元数据（需含 id）
   * @returns {object} 保存后的元数据
   */
  saveKeyMeta(meta) {
    const index = this.data.keys.findIndex((item) => item.id === meta.id);
    if (index >= 0) {
      this.data.keys[index] = meta;
    } else {
      this.data.keys.push(meta);
    }
    this.persist();
    return structuredClone(meta);
  }

  /**
   * 删除密钥元数据，并解除主机绑定。
   *
   * @param {string} id - 密钥 ID
   * @returns {boolean} 是否删除成功
   */
  deleteKey(id) {
    const before = this.data.keys.length;
    this.data.keys = this.data.keys.filter((item) => item.id !== id);
    if (this.data.keys.length === before) {
      return false;
    }
    for (const host of this.data.hosts) {
      if (host.keyId === id) {
        host.keyId = null;
        if (host.authMethod === "privateKey") {
          host.authMethod = "password";
        }
        host.updatedAt = new Date().toISOString();
      }
    }
    this.persist();
    return true;
  }

  /**
   * @returns {object[]} 片段列表
   */
  listSnippets() {
    return structuredClone(this.data.snippets);
  }

  /**
   * 新建或更新命令片段。
   *
   * @param {object} input - 片段字段
   * @returns {{ ok: true, snippet: object } | { ok: false, message: string }}
   */
  upsertSnippet(input) {
    const title = String(input.title ?? "").trim();
    const content = String(input.content ?? "");
    if (!title) {
      return { ok: false, message: "请填写片段标题" };
    }
    if (!content.trim()) {
      return { ok: false, message: "请填写片段内容" };
    }
    const now = new Date().toISOString();
    if (input.id) {
      const index = this.data.snippets.findIndex((item) => item.id === input.id);
      if (index < 0) {
        return { ok: false, message: "片段不存在" };
      }
      const next = {
        ...this.data.snippets[index],
        title,
        content,
        category: input.category ? String(input.category).trim() : null,
        autoNewline: input.autoNewline !== false,
        updatedAt: now,
      };
      this.data.snippets[index] = next;
      this.persist();
      return { ok: true, snippet: structuredClone(next) };
    }
    const snippet = {
      id: createId(),
      title,
      content,
      category: input.category ? String(input.category).trim() : null,
      autoNewline: input.autoNewline !== false,
      createdAt: now,
      updatedAt: now,
    };
    this.data.snippets.push(snippet);
    this.persist();
    return { ok: true, snippet: structuredClone(snippet) };
  }

  /**
   * 删除片段。
   *
   * @param {string} id - 片段 ID
   * @returns {boolean} 是否删除成功
   */
  deleteSnippet(id) {
    const before = this.data.snippets.length;
    this.data.snippets = this.data.snippets.filter((item) => item.id !== id);
    if (this.data.snippets.length === before) {
      return false;
    }
    this.persist();
    return true;
  }

  /**
   * @returns {object[]} 转发规则列表
   */
  listForwards() {
    return structuredClone(this.data.forwards);
  }

  /**
   * 新建或更新端口转发规则。
   *
   * @param {object} input - 规则字段
   * @returns {{ ok: true, forward: object } | { ok: false, message: string }}
   */
  upsertForward(input) {
    const name = String(input.name ?? "").trim();
    const hostId = String(input.hostId ?? "").trim();
    const type = input.type === "remote" ? "remote" : "local";
    const bindPort = Number(input.bindPort);
    const targetHost = String(input.targetHost ?? "").trim();
    const targetPort = Number(input.targetPort);
    if (!name) {
      return { ok: false, message: "请填写规则名称" };
    }
    if (!hostId || !this.getHost(hostId)) {
      return { ok: false, message: "请选择关联主机" };
    }
    if (!Number.isFinite(bindPort) || bindPort < 1 || bindPort > 65535) {
      return { ok: false, message: "绑定端口无效" };
    }
    if (!targetHost) {
      return { ok: false, message: "请填写目标主机" };
    }
    if (!Number.isFinite(targetPort) || targetPort < 1 || targetPort > 65535) {
      return { ok: false, message: "目标端口无效" };
    }
    const now = new Date().toISOString();
    if (input.id) {
      const index = this.data.forwards.findIndex((item) => item.id === input.id);
      if (index < 0) {
        return { ok: false, message: "转发规则不存在" };
      }
      const next = {
        ...this.data.forwards[index],
        name,
        hostId,
        type,
        bindPort,
        targetHost,
        targetPort,
        enabled: Boolean(input.enabled),
        updatedAt: now,
      };
      this.data.forwards[index] = next;
      this.persist();
      return { ok: true, forward: structuredClone(next) };
    }
    const forward = {
      id: createId(),
      name,
      hostId,
      type,
      bindPort,
      targetHost,
      targetPort,
      enabled: false,
      createdAt: now,
      updatedAt: now,
    };
    this.data.forwards.push(forward);
    this.persist();
    return { ok: true, forward: structuredClone(forward) };
  }

  /**
   * 删除转发规则。
   *
   * @param {string} id - 规则 ID
   * @returns {boolean} 是否删除成功
   */
  deleteForward(id) {
    const before = this.data.forwards.length;
    this.data.forwards = this.data.forwards.filter((item) => item.id !== id);
    if (this.data.forwards.length === before) {
      return false;
    }
    this.persist();
    return true;
  }

  /**
   * 设置转发规则 enabled 标记（不负责真实隧道）。
   *
   * @param {string} id - 规则 ID
   * @param {boolean} enabled - 是否启用
   * @returns {object|null} 更新后的规则
   */
  setForwardEnabled(id, enabled) {
    const forward = this.data.forwards.find((item) => item.id === id);
    if (!forward) {
      return null;
    }
    forward.enabled = Boolean(enabled);
    forward.updatedAt = new Date().toISOString();
    this.persist();
    return structuredClone(forward);
  }

  /**
   * 覆盖导入：替换主机/分组/片段/转发（密钥元数据保留由调用方处理）。
   *
   * @param {{ hosts?: object[], groups?: object[], snippets?: object[], forwards?: object[] }} payload
   * @returns {void}
   */
  replaceConfig(payload) {
    this.data.hosts = Array.isArray(payload.hosts) ? payload.hosts : [];
    this.data.groups = Array.isArray(payload.groups) ? payload.groups : [];
    this.data.snippets = Array.isArray(payload.snippets) ? payload.snippets : [];
    this.data.forwards = Array.isArray(payload.forwards) ? payload.forwards : [];
    this.persist();
  }

  /**
   * 导出当前配置快照（不含密钥私钥与密码）。
   *
   * @returns {object} 快照
   */
  exportSnapshot() {
    return {
      hosts: structuredClone(this.data.hosts),
      groups: structuredClone(this.data.groups),
      snippets: structuredClone(this.data.snippets),
      forwards: structuredClone(this.data.forwards),
      keys: structuredClone(this.data.keys),
    };
  }
}

module.exports = { DataStore, createId };
