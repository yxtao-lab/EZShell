const { Client } = require("ssh2");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { StringDecoder } = require("node:string_decoder");
const { mapSshErrorMessage } = require("@ezshell/core");
const { ensureSftp, joinRemotePath } = require("./forward-manager.cjs");

/**
 * SSH 会话管理：连接、终端流、状态与指纹校验。
 */
class SshManager {
  /**
   * @param {object} deps - 依赖
   * @param {import('./data-store.cjs').DataStore} deps.dataStore - 数据仓库
   * @param {import('./secret-store.cjs').SecretStore} deps.secretStore - 安全存储
   * @param {import('./key-service.cjs').KeyService} deps.keyService - 密钥服务
   * @param {(channel: string, payload: object) => void} deps.emit - 向渲染进程推送事件
   */
  constructor({ dataStore, secretStore, keyService, emit }) {
    this.dataStore = dataStore;
    this.secretStore = secretStore;
    this.keyService = keyService;
    this.emit = emit;
    /** @type {Map<string, { client: import('ssh2').Client, stream?: import('ssh2').ClientChannel, hostId: string, status: string, decoder?: import('node:string_decoder').StringDecoder }>} */
    this.sessions = new Map();
  }

  /**
   * 发起或重试 SSH 连接。
   *
   * @param {object} options - 连接选项
   * @param {string} options.sessionId - 会话 ID（由渲染进程生成）
   * @param {string} options.hostId - 主机 ID
   * @param {string} [options.password] - 本次提供的密码
   * @param {boolean} [options.rememberPassword] - 是否记住密码
   * @param {boolean} [options.acceptFingerprint] - 是否接受当前指纹
   * @param {string} [options.pendingFingerprint] - 待接受指纹
   * @returns {Promise<{ ok: boolean, code?: string, message?: string }>}
   */
  async connect(options) {
    const {
      sessionId,
      hostId,
      password,
      rememberPassword,
      acceptFingerprint,
      pendingFingerprint,
    } = options;

    const host = this.dataStore.getHost(hostId);
    if (!host) {
      return { ok: false, code: "NOT_FOUND", message: "主机不存在" };
    }

    this.disconnect(sessionId, false);

    if (acceptFingerprint && pendingFingerprint) {
      this.dataStore.setHostFingerprint(hostId, pendingFingerprint);
      host.hostFingerprint = pendingFingerprint;
    }

    let authPassword = password ?? null;
    if (host.authMethod !== "privateKey") {
      if (!authPassword) {
        authPassword = this.secretStore.get("password", hostId);
      }
      if (!authPassword) {
        this.setStatus(sessionId, hostId, "failed", "需要输入密码");
        return { ok: false, code: "NEED_PASSWORD", message: "请输入 SSH 密码" };
      }
    }

    let privateKey = null;
    let passphrase = null;
    if (host.authMethod === "privateKey") {
      if (!host.keyId) {
        return { ok: false, code: "NO_KEY", message: "请先为该主机绑定密钥" };
      }
      const material = this.keyService.getPrivateMaterial(host.keyId);
      if (!material) {
        return { ok: false, code: "NO_KEY", message: "找不到绑定的私钥" };
      }
      privateKey = material.privateKey;
      passphrase = material.passphrase ?? undefined;
    }

    this.setStatus(sessionId, hostId, "connecting", "正在连接…");

    return new Promise((resolve) => {
      const client = new Client();
      let settled = false;
      let fingerprintGate = /** @type {null | { fingerprint: string, resolve: (ok: boolean) => void }} */ (
        null
      );

      const finish = (result) => {
        if (settled) {
          return;
        }
        settled = true;
        resolve(result);
      };

      this.sessions.set(sessionId, {
        client,
        hostId,
        status: "connecting",
        decoder: new StringDecoder("utf8"),
      });

      client
        .on("ready", () => {
          if (rememberPassword && authPassword) {
            this.secretStore.set("password", hostId, authPassword);
          }
          client.shell(
            {
              term: "xterm-256color",
              cols: 120,
              rows: 30,
            },
            (err, stream) => {
              if (err) {
                const message = mapSshErrorMessage(err);
                this.setStatus(sessionId, hostId, "failed", message);
                this.safeEnd(client);
                this.sessions.delete(sessionId);
                finish({ ok: false, code: "SHELL_FAILED", message });
                return;
              }

              const session = this.sessions.get(sessionId);
              if (session) {
                session.stream = stream;
                session.status = "connected";
              }
              this.setStatus(sessionId, hostId, "connected", "已连接");

              stream.on("data", (chunk) => {
                const current = this.sessions.get(sessionId);
                const text = current?.decoder
                  ? current.decoder.write(chunk)
                  : Buffer.from(chunk).toString("utf8");
                if (!text) {
                  return;
                }
                this.emit("ssh:data", {
                  sessionId,
                  data: text,
                });
              });
              stream.stderr?.on("data", (chunk) => {
                const current = this.sessions.get(sessionId);
                const text = current?.decoder
                  ? current.decoder.write(chunk)
                  : Buffer.from(chunk).toString("utf8");
                if (!text) {
                  return;
                }
                this.emit("ssh:data", {
                  sessionId,
                  data: text,
                });
              });
              stream.on("close", () => {
                const current = this.sessions.get(sessionId);
                const tail = current?.decoder?.end?.() ?? "";
                if (tail) {
                  this.emit("ssh:data", { sessionId, data: tail });
                }
                this.setStatus(sessionId, hostId, "disconnected", "会话已关闭");
                this.safeEnd(client);
                this.sessions.delete(sessionId);
                this.emit("ssh:closed", { sessionId, hostId });
              });

              finish({ ok: true });
            },
          );
        })
        .on("error", (error) => {
          const message = mapSshErrorMessage(error);
          const authFailed =
            /authentication|permission denied|all configured authentication methods failed/i.test(
              String(error?.message ?? ""),
            );

          this.setStatus(sessionId, hostId, "failed", message);
          this.sessions.delete(sessionId);

          if (authFailed && host.authMethod !== "privateKey") {
            this.emit("ssh:needPassword", {
              sessionId,
              hostId,
              reason: "authFailed",
              message,
            });
            finish({ ok: false, code: "AUTH_FAILED", message });
            return;
          }

          finish({ ok: false, code: "CONNECT_FAILED", message });
        })
        .connect({
          host: host.host,
          port: host.port,
          username: host.username,
          password: privateKey ? undefined : authPassword ?? undefined,
          privateKey: privateKey ?? undefined,
          passphrase,
          readyTimeout: 15000,
          tryKeyboard: true,
          hostHash: "sha256",
          hostVerifier: (hashedKey, callback) => {
            const fingerprint = this.normalizeFingerprint(hashedKey);
            const known = host.hostFingerprint
              ? this.normalizeFingerprint(host.hostFingerprint)
              : null;

            if (known && known === fingerprint) {
              callback(true);
              return;
            }

            const changed = Boolean(known && known !== fingerprint);
            fingerprintGate = {
              fingerprint,
              resolve: (ok) => callback(ok),
            };
            const existing = this.sessions.get(sessionId) || {
              client,
              hostId,
              status: "connecting",
            };
            existing.fingerprintGate = fingerprintGate;
            this.sessions.set(sessionId, existing);
            this.emit("ssh:fingerprint", {
              sessionId,
              hostId,
              fingerprint,
              changed,
              message: changed
                ? "主机密钥指纹与本地记录不一致，可能存在安全风险"
                : "首次连接，请确认主机密钥指纹",
            });
          },
        });
    });
  }

  /**
   * 用户确认或拒绝主机指纹。
   *
   * @param {string} sessionId - 会话 ID
   * @param {boolean} accepted - 是否接受
   * @returns {{ ok: boolean, message?: string }}
   */
  resolveFingerprint(sessionId, accepted) {
    const session = this.sessions.get(sessionId);
    const gate = session?.fingerprintGate;
    if (!gate) {
      return { ok: false, message: "没有待确认的指纹" };
    }
    if (accepted) {
      this.dataStore.setHostFingerprint(session.hostId, gate.fingerprint);
    }
    gate.resolve(Boolean(accepted));
    delete session.fingerprintGate;
    if (!accepted) {
      this.setStatus(sessionId, session.hostId, "disconnected", "已拒绝主机指纹");
      this.disconnect(sessionId, false);
    }
    return { ok: true };
  }

  /**
   * 向终端写入数据。
   *
   * @param {string} sessionId - 会话 ID
   * @param {string} data - 输入数据
   * @returns {boolean} 是否写入成功
   */
  write(sessionId, data) {
    const stream = this.sessions.get(sessionId)?.stream;
    if (!stream) {
      return false;
    }
    // 显式按 UTF-8 写出，避免中文等多字节字符在 IPC/流边界被拆坏
    stream.write(typeof data === "string" ? Buffer.from(data, "utf8") : data);
    return true;
  }

  /**
   * 调整远端 PTY 尺寸。
   *
   * @param {string} sessionId - 会话 ID
   * @param {number} cols - 列数
   * @param {number} rows - 行数
   * @returns {boolean} 是否成功
   */
  resize(sessionId, cols, rows) {
    const stream = this.sessions.get(sessionId)?.stream;
    if (!stream) {
      return false;
    }
    stream.setWindow(rows, cols, 0, 0);
    return true;
  }

  /**
   * 断开会话。
   *
   * @param {string} sessionId - 会话 ID
   * @param {boolean} [emitStatus=true] - 是否推送状态
   * @returns {void}
   */
  disconnect(sessionId, emitStatus = true) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }
    try {
      session.sftp?.end?.();
    } catch {
      // ignore
    }
    try {
      session.stream?.close();
    } catch {
      // ignore
    }
    this.safeEnd(session.client);
    this.sessions.delete(sessionId);
    if (emitStatus) {
      this.setStatus(sessionId, session.hostId, "disconnected", "已断开");
    }
  }

  /**
   * 列出远端目录。
   *
   * @param {string} sessionId - 会话 ID
   * @param {string} [remotePath] - 目录；缺省为当前工作目录
   * @returns {Promise<{ ok: boolean, cwd?: string, entries?: object[], message?: string }>}
   */
  async sftpList(sessionId, remotePath) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { ok: false, message: "会话不存在或未连接" };
    }
    try {
      const sftp = await ensureSftp(session);
      const cwd = joinRemotePath(session.sftpCwd || "/", remotePath || session.sftpCwd || "/");
      const entries = await new Promise((resolve, reject) => {
        sftp.readdir(cwd, (err, list) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(
            list
              .map((item) => ({
                name: item.filename,
                longname: item.longname,
                isDirectory: (item.attrs?.mode & 0o170000) === 0o040000,
                size: item.attrs?.size ?? 0,
                modifyTime: item.attrs?.mtime ? item.attrs.mtime * 1000 : 0,
              }))
              .sort((a, b) => {
                if (a.isDirectory !== b.isDirectory) {
                  return a.isDirectory ? -1 : 1;
                }
                return a.name.localeCompare(b.name);
              }),
          );
        });
      });
      session.sftpCwd = cwd;
      return { ok: true, cwd, entries };
    } catch (error) {
      return { ok: false, message: mapSshErrorMessage(error) || String(error.message || error) };
    }
  }

  /**
   * 进入上级目录并列出。
   *
   * @param {string} sessionId - 会话 ID
   * @returns {Promise<{ ok: boolean, cwd?: string, entries?: object[], message?: string }>}
   */
  sftpUp(sessionId) {
    const session = this.sessions.get(sessionId);
    const cwd = session?.sftpCwd || "/";
    const parent = cwd === "/" ? "/" : path.posix.dirname(cwd);
    return this.sftpList(sessionId, parent);
  }

  /**
   * 重命名远端文件或目录。
   *
   * @param {string} sessionId - 会话 ID
   * @param {string} fromPath - 原路径
   * @param {string} toPath - 新路径
   * @returns {Promise<{ ok: boolean, message?: string }>}
   */
  async sftpRename(sessionId, fromPath, toPath) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { ok: false, message: "会话不存在或未连接" };
    }
    try {
      const sftp = await ensureSftp(session);
      await new Promise((resolve, reject) => {
        sftp.rename(fromPath, toPath, (err) => (err ? reject(err) : resolve()));
      });
      return { ok: true };
    } catch (error) {
      return { ok: false, message: mapSshErrorMessage(error) || "重命名失败" };
    }
  }

  /**
   * 删除远端文件或空目录。
   *
   * @param {string} sessionId - 会话 ID
   * @param {string} remotePath - 路径
   * @param {boolean} [isDirectory] - 是否目录
   * @returns {Promise<{ ok: boolean, message?: string }>}
   */
  async sftpDelete(sessionId, remotePath, isDirectory = false) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { ok: false, message: "会话不存在或未连接" };
    }
    try {
      const sftp = await ensureSftp(session);
      await new Promise((resolve, reject) => {
        const cb = (err) => (err ? reject(err) : resolve());
        if (isDirectory) {
          sftp.rmdir(remotePath, cb);
        } else {
          sftp.unlink(remotePath, cb);
        }
      });
      return { ok: true };
    } catch (error) {
      return { ok: false, message: mapSshErrorMessage(error) || "删除失败" };
    }
  }

  /**
   * 下载远端文件到本地路径。
   *
   * @param {string} sessionId - 会话 ID
   * @param {string} remotePath - 远端文件
   * @param {string} localPath - 本地保存路径
   * @returns {Promise<{ ok: boolean, message?: string }>}
   */
  async sftpDownload(sessionId, remotePath, localPath) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { ok: false, message: "会话不存在或未连接" };
    }
    try {
      const sftp = await ensureSftp(session);
      await new Promise((resolve, reject) => {
        sftp.fastGet(remotePath, localPath, (err) => (err ? reject(err) : resolve()));
      });
      return { ok: true };
    } catch (error) {
      return { ok: false, message: mapSshErrorMessage(error) || "下载失败" };
    }
  }

  /**
   * 上传本地文件到远端路径。
   *
   * @param {string} sessionId - 会话 ID
   * @param {string} localPath - 本地文件
   * @param {string} remotePath - 远端目标路径
   * @returns {Promise<{ ok: boolean, message?: string }>}
   */
  async sftpUpload(sessionId, localPath, remotePath) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { ok: false, message: "会话不存在或未连接" };
    }
    if (!fs.existsSync(localPath)) {
      return { ok: false, message: "本地文件不存在" };
    }
    try {
      const sftp = await ensureSftp(session);
      await new Promise((resolve, reject) => {
        sftp.fastPut(localPath, remotePath, (err) => (err ? reject(err) : resolve()));
      });
      return { ok: true };
    } catch (error) {
      return { ok: false, message: mapSshErrorMessage(error) || "上传失败" };
    }
  }

  /**
   * 规范化指纹为 `SHA256:...` 形式。
   *
   * @param {string|Buffer} value - 原始哈希或指纹
   * @returns {string} 规范化指纹
   */
  normalizeFingerprint(value) {
    if (Buffer.isBuffer(value)) {
      const b64 = createHash("sha256").update(value).digest("base64").replace(/=+$/, "");
      return `SHA256:${b64}`;
    }
    const text = String(value).trim();
    if (text.startsWith("SHA256:")) {
      return text;
    }
    // ssh2 hostHash=sha256 时常见为 hex
    if (/^[0-9a-f]+$/i.test(text) && text.length === 64) {
      const b64 = Buffer.from(text, "hex").toString("base64").replace(/=+$/, "");
      return `SHA256:${b64}`;
    }
    return text.startsWith("SHA256:") ? text : `SHA256:${text.replace(/=+$/, "")}`;
  }

  /**
   * 更新并广播会话状态。
   *
   * @param {string} sessionId - 会话 ID
   * @param {string} hostId - 主机 ID
   * @param {string} status - 状态枚举
   * @param {string} message - 中文说明
   * @returns {void}
   */
  setStatus(sessionId, hostId, status, message) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = status;
    }
    this.emit("ssh:status", { sessionId, hostId, status, message });
  }

  /**
   * 安全结束 SSH 客户端。
   *
   * @param {import('ssh2').Client} client - 客户端
   * @returns {void}
   */
  safeEnd(client) {
    try {
      client.end();
    } catch {
      // ignore
    }
  }
}

module.exports = { SshManager };
