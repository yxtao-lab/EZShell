const net = require("node:net");
const { Client } = require("ssh2");
const { mapSshErrorMessage } = require("@ezshell/core");

/**
 * 端口转发运行时：为每条规则维护独立 SSH 连接与本地/远端监听。
 */
class ForwardManager {
  /**
   * @param {object} deps - 依赖
   * @param {import('./data-store.cjs').DataStore} deps.dataStore
   * @param {import('./secret-store.cjs').SecretStore} deps.secretStore
   * @param {import('./key-service.cjs').KeyService} deps.keyService
   * @param {(channel: string, payload: object) => void} deps.emit
   */
  constructor({ dataStore, secretStore, keyService, emit }) {
    this.dataStore = dataStore;
    this.secretStore = secretStore;
    this.keyService = keyService;
    this.emit = emit;
    /** @type {Map<string, { client: import('ssh2').Client, server?: import('node:net').Server, ruleId: string }>} */
    this.active = new Map();
  }

  /**
   * 启动一条转发规则。
   *
   * @param {string} ruleId - 规则 ID
   * @param {{ password?: string, rememberPassword?: boolean }} [auth] - 可选密码
   * @returns {Promise<{ ok: boolean, message?: string, code?: string }>}
   */
  async start(ruleId, auth = {}) {
    if (this.active.has(ruleId)) {
      return { ok: true, message: "转发已在运行" };
    }
    const rule = this.dataStore.listForwards().find((item) => item.id === ruleId);
    if (!rule) {
      return { ok: false, message: "转发规则不存在" };
    }
    const host = this.dataStore.getHost(rule.hostId);
    if (!host) {
      return { ok: false, message: "关联主机不存在" };
    }

    const connectResult = await this.connectClient(host, auth);
    if (!connectResult.ok) {
      return connectResult;
    }
    const client = connectResult.client;

    try {
      if (rule.type === "remote") {
        await this.startRemote(client, rule);
      } else {
        await this.startLocal(client, rule);
      }
      this.dataStore.setForwardEnabled(ruleId, true);
      this.emit("forward:status", { ruleId, running: true, message: "转发已启动" });
      return { ok: true };
    } catch (error) {
      this.safeEnd(client);
      const message = this.mapForwardError(error);
      this.emit("forward:status", { ruleId, running: false, message });
      return { ok: false, message };
    }
  }

  /**
   * 停止转发并释放资源。
   *
   * @param {string} ruleId - 规则 ID
   * @returns {{ ok: boolean }}
   */
  stop(ruleId) {
    const entry = this.active.get(ruleId);
    if (!entry) {
      this.dataStore.setForwardEnabled(ruleId, false);
      return { ok: true };
    }
    try {
      entry.server?.close();
    } catch {
      // ignore
    }
    if (entry.remoteBound) {
      try {
        entry.client.unforwardIn("127.0.0.1", entry.bindPort);
      } catch {
        // ignore
      }
    }
    this.safeEnd(entry.client);
    this.active.delete(ruleId);
    this.dataStore.setForwardEnabled(ruleId, false);
    this.emit("forward:status", { ruleId, running: false, message: "转发已停止" });
    return { ok: true };
  }

  /**
   * 查询运行中的规则 ID 列表。
   *
   * @returns {string[]}
   */
  listRunning() {
    return [...this.active.keys()];
  }

  /**
   * 停止全部转发。
   *
   * @returns {void}
   */
  stopAll() {
    for (const id of [...this.active.keys()]) {
      this.stop(id);
    }
  }

  /**
   * 建立用于转发的 SSH 客户端。
   *
   * @param {object} host - 主机
   * @param {{ password?: string, rememberPassword?: boolean }} auth
   * @returns {Promise<{ ok: true, client: import('ssh2').Client } | { ok: false, code?: string, message: string }>}
   */
  connectClient(host, auth) {
    return new Promise((resolve) => {
      let authPassword = auth.password ?? null;
      if (host.authMethod !== "privateKey") {
        if (!authPassword) {
          authPassword = this.secretStore.get("password", host.id);
        }
        if (!authPassword) {
          resolve({ ok: false, code: "NEED_PASSWORD", message: "请先为该主机保存密码或在启动时输入" });
          return;
        }
      }

      let privateKey = null;
      let passphrase = undefined;
      if (host.authMethod === "privateKey") {
        if (!host.keyId) {
          resolve({ ok: false, message: "请先为该主机绑定密钥" });
          return;
        }
        const material = this.keyService.getPrivateMaterial(host.keyId);
        if (!material) {
          resolve({ ok: false, message: "找不到绑定的私钥" });
          return;
        }
        privateKey = material.privateKey;
        passphrase = material.passphrase ?? undefined;
      }

      const client = new Client();
      client
        .on("ready", () => {
          if (auth.rememberPassword && authPassword) {
            this.secretStore.set("password", host.id, authPassword);
          }
          resolve({ ok: true, client });
        })
        .on("error", (error) => {
          resolve({ ok: false, message: mapSshErrorMessage(error) });
        })
        .connect({
          host: host.host,
          port: host.port,
          username: host.username,
          password: privateKey ? undefined : authPassword ?? undefined,
          privateKey: privateKey ?? undefined,
          passphrase,
          readyTimeout: 15000,
          hostHash: "sha256",
          hostVerifier: (hashedKey, callback) => {
            const known = host.hostFingerprint;
            if (!known) {
              // 转发场景：已有终端确认过指纹更佳；无记录时仍允许（首次）
              callback(true);
              return;
            }
            callback(true);
          },
        });
    });
  }

  /**
   * 启动本地转发：本机 bindPort → 远端 targetHost:targetPort。
   *
   * @param {import('ssh2').Client} client
   * @param {object} rule
   * @returns {Promise<void>}
   */
  startLocal(client, rule) {
    return new Promise((resolve, reject) => {
      const server = net.createServer((socket) => {
        client.forwardOut(
          "127.0.0.1",
          0,
          rule.targetHost,
          rule.targetPort,
          (err, stream) => {
            if (err) {
              socket.destroy();
              return;
            }
            socket.pipe(stream);
            stream.pipe(socket);
            socket.on("error", () => stream.close?.());
            stream.on("close", () => socket.destroy());
          },
        );
      });
      server.on("error", (error) => reject(error));
      server.listen(rule.bindPort, "127.0.0.1", () => {
        this.active.set(rule.id, { client, server, ruleId: rule.id, bindPort: rule.bindPort });
        resolve();
      });
    });
  }

  /**
   * 启动远程转发：远端 bindPort → 本机 targetHost:targetPort。
   *
   * @param {import('ssh2').Client} client
   * @param {object} rule
   * @returns {Promise<void>}
   */
  startRemote(client, rule) {
    return new Promise((resolve, reject) => {
      client.forwardIn("127.0.0.1", rule.bindPort, (err) => {
        if (err) {
          reject(err);
          return;
        }
        const onTcp = (info, accept, rejectConn) => {
          if (info.destPort !== rule.bindPort) {
            rejectConn();
            return;
          }
          const stream = accept();
          const socket = net.connect(rule.targetPort, rule.targetHost, () => {
            stream.pipe(socket);
            socket.pipe(stream);
          });
          socket.on("error", () => stream.close?.());
          stream.on("close", () => socket.destroy());
        };
        client.on("tcp connection", onTcp);
        this.active.set(rule.id, {
          client,
          ruleId: rule.id,
          bindPort: rule.bindPort,
          remoteBound: true,
          onTcp,
        });
        resolve();
      });
    });
  }

  /**
   * 将转发错误转为中文提示。
   *
   * @param {unknown} error
   * @returns {string}
   */
  mapForwardError(error) {
    const message = mapSshErrorMessage(error);
    const raw = String(error?.message ?? error ?? "");
    if (/EADDRINUSE|address already in use/i.test(raw)) {
      return "本机端口已被占用，请更换绑定端口";
    }
    if (/administratively prohibited|cannot listen|permission/i.test(raw)) {
      return "远程转发被拒绝：请检查服务端 GatewayPorts / AllowTcpForwarding 配置";
    }
    return message || "端口转发启动失败";
  }

  /**
   * @param {import('ssh2').Client} client
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

/**
 * 将会话上的 SFTP 通道懒打开。
 *
 * @param {object} session - ssh-manager 会话对象
 * @returns {Promise<object>} sftp 实例
 */
function ensureSftp(session) {
  if (session.sftp) {
    return Promise.resolve(session.sftp);
  }
  if (session.status !== "connected") {
    return Promise.reject(new Error("当前会话未连接，无法使用 SFTP"));
  }
  return new Promise((resolve, reject) => {
    session.client.sftp((err, sftp) => {
      if (err) {
        reject(new Error(mapSshErrorMessage(err) || "打开 SFTP 失败"));
        return;
      }
      session.sftp = sftp;
      session.sftpCwd = session.sftpCwd || "/";
      resolve(sftp);
    });
  });
}

/**
 * 规范化远端路径。
 *
 * @param {string} base - 当前目录
 * @param {string} next - 相对或绝对路径
 * @returns {string}
 */
function joinRemotePath(base, next) {
  if (!next || next === ".") {
    return base || "/";
  }
  if (next.startsWith("/")) {
    return path.posix.normalize(next);
  }
  return path.posix.normalize(path.posix.join(base || "/", next));
}

module.exports = {
  ForwardManager,
  ensureSftp,
  joinRemotePath,
};
