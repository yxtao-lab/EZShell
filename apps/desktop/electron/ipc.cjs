const { ipcMain, BrowserWindow, dialog, app, clipboard, shell } = require("electron");
const path = require("node:path");
const { applySnippetVariables } = require("@ezshell/core");

/**
 * 向所有窗口广播事件。
 *
 * @param {string} channel - 通道名
 * @param {object} payload - 载荷
 * @returns {void}
 */
function broadcast(channel, payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload);
  }
}

/**
 * 注册桌面端全部 IPC 处理器。
 *
 * @param {object} deps - 依赖
 * @param {import('./data-store.cjs').DataStore} deps.dataStore
 * @param {import('./secret-store.cjs').SecretStore} deps.secretStore
 * @param {import('./key-service.cjs').KeyService} deps.keyService
 * @param {import('./ssh-manager.cjs').SshManager} deps.sshManager
 * @param {import('./forward-manager.cjs').ForwardManager} deps.forwardManager
 * @param {import('./import-export.cjs').ImportExportService} deps.importExport
 * @returns {void}
 */
function registerIpcHandlers({
  dataStore,
  secretStore,
  keyService,
  sshManager,
  forwardManager,
  importExport,
}) {
  ipcMain.handle("storage:listHosts", () => dataStore.listHosts());
  ipcMain.handle("storage:upsertHost", (_event, input) => dataStore.upsertHost(input));
  ipcMain.handle("storage:deleteHost", (_event, id) => {
    secretStore.delete("password", id);
    for (const rule of dataStore.listForwards().filter((item) => item.hostId === id)) {
      forwardManager.stop(rule.id);
    }
    return dataStore.deleteHost(id);
  });
  ipcMain.handle("storage:listGroups", () => dataStore.listGroups());
  ipcMain.handle("storage:upsertGroup", (_event, input) => dataStore.upsertGroup(input));
  ipcMain.handle("storage:deleteGroup", (_event, id) => dataStore.deleteGroup(id));

  ipcMain.handle("secrets:hasPassword", (_event, hostId) =>
    secretStore.has("password", hostId),
  );
  ipcMain.handle("secrets:deletePassword", (_event, hostId) => {
    secretStore.delete("password", hostId);
    return true;
  });

  ipcMain.handle("keys:list", () => keyService.list());
  ipcMain.handle("keys:generate", (_event, name) => keyService.generateEd25519(name));
  ipcMain.handle("keys:import", (_event, input) => keyService.importKey(input));
  ipcMain.handle("keys:delete", (_event, id) => keyService.delete(id));
  ipcMain.handle("keys:getPublicKey", (_event, id) => keyService.getPublicKey(id));

  ipcMain.handle("ssh:connect", (_event, options) => sshManager.connect(options));
  ipcMain.handle("ssh:disconnect", (_event, sessionId) => {
    sshManager.disconnect(sessionId);
    return true;
  });
  // 终端输入用单向 send，保证按键顺序且避免 invoke 往返延迟打乱中文
  ipcMain.on("ssh:write", (_event, sessionId, data) => {
    sshManager.write(sessionId, data);
  });
  ipcMain.handle("ssh:write", (_event, sessionId, data) =>
    sshManager.write(sessionId, data),
  );
  ipcMain.handle("ssh:resize", (_event, sessionId, cols, rows) =>
    sshManager.resize(sessionId, cols, rows),
  );
  ipcMain.handle("ssh:resolveFingerprint", (_event, sessionId, accepted) =>
    sshManager.resolveFingerprint(sessionId, accepted),
  );

  ipcMain.handle("sftp:list", (_event, sessionId, remotePath) =>
    sshManager.sftpList(sessionId, remotePath),
  );
  ipcMain.handle("sftp:up", (_event, sessionId) => sshManager.sftpUp(sessionId));
  ipcMain.handle("sftp:rename", (_event, sessionId, fromPath, toPath) =>
    sshManager.sftpRename(sessionId, fromPath, toPath),
  );
  ipcMain.handle("sftp:delete", (_event, sessionId, remotePath, isDirectory) =>
    sshManager.sftpDelete(sessionId, remotePath, isDirectory),
  );
  ipcMain.handle("sftp:download", async (_event, sessionId, remotePath) => {
    const name = path.basename(remotePath);
    const result = await dialog.showSaveDialog({
      title: "下载文件",
      defaultPath: name,
    });
    if (result.canceled || !result.filePath) {
      return { ok: false, message: "已取消下载" };
    }
    return sshManager.sftpDownload(sessionId, remotePath, result.filePath);
  });
  ipcMain.handle("sftp:upload", async (_event, sessionId, remoteDir) => {
    const result = await dialog.showOpenDialog({
      title: "上传文件",
      properties: ["openFile", "multiSelections"],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, message: "已取消上传" };
    }
    const dir = remoteDir || "/";
    let uploaded = 0;
    for (const localPath of result.filePaths) {
      const remotePath = path.posix.join(dir, path.basename(localPath));
      const one = await sshManager.sftpUpload(sessionId, localPath, remotePath);
      if (!one.ok) {
        return one;
      }
      uploaded += 1;
    }
    return { ok: true, message: `已上传 ${uploaded} 个文件` };
  });

  ipcMain.handle("snippets:list", () => dataStore.listSnippets());
  ipcMain.handle("snippets:upsert", (_event, input) => dataStore.upsertSnippet(input));
  ipcMain.handle("snippets:delete", (_event, id) => dataStore.deleteSnippet(id));
  ipcMain.handle("snippets:send", (_event, { snippetId, sessionId, hostId }) => {
    const snippet = dataStore.listSnippets().find((item) => item.id === snippetId);
    if (!snippet) {
      return { ok: false, message: "片段不存在" };
    }
    if (!sessionId) {
      return { ok: false, message: "当前没有活动终端会话" };
    }
    const host = dataStore.getHost(hostId);
    if (!host) {
      return { ok: false, message: "找不到会话关联主机" };
    }
    let text = applySnippetVariables(snippet.content, host);
    if (snippet.autoNewline !== false && !text.endsWith("\n")) {
      text += "\n";
    }
    const written = sshManager.write(sessionId, text);
    if (!written) {
      return { ok: false, message: "当前没有活动终端会话" };
    }
    return { ok: true };
  });

  ipcMain.handle("forwards:list", () => dataStore.listForwards());
  ipcMain.handle("forwards:upsert", (_event, input) => dataStore.upsertForward(input));
  ipcMain.handle("forwards:delete", (_event, id) => {
    forwardManager.stop(id);
    return dataStore.deleteForward(id);
  });
  ipcMain.handle("forwards:start", (_event, ruleId, auth) =>
    forwardManager.start(ruleId, auth || {}),
  );
  ipcMain.handle("forwards:stop", (_event, ruleId) => forwardManager.stop(ruleId));
  ipcMain.handle("forwards:running", () => forwardManager.listRunning());

  ipcMain.handle("backup:export", async (_event, options) => {
    const encrypted = Boolean(options?.encrypted);
    const save = await dialog.showSaveDialog({
      title: "导出 EZShell 备份",
      defaultPath: importExport.suggestedBackupName(encrypted),
      filters: encrypted
        ? [{ name: "EZShell 加密备份", extensions: ["ezb"] }]
        : [{ name: "EZShell 备份", extensions: ["json"] }],
    });
    if (save.canceled || !save.filePath) {
      return { ok: false, message: "已取消导出" };
    }
    return importExport.exportBackup({
      filePath: save.filePath,
      encrypted,
      password: options?.password,
      includeSecrets: Boolean(options?.includeSecrets),
    });
  });
  ipcMain.handle("backup:import", async (_event, options) => {
    const open = await dialog.showOpenDialog({
      title: "导入 EZShell 备份",
      properties: ["openFile"],
      filters: [{ name: "EZShell 备份", extensions: ["json", "ezb"] }],
    });
    if (open.canceled || !open.filePaths[0]) {
      return { ok: false, message: "已取消导入" };
    }
    if (options?.mode === "replace") {
      forwardManager.stopAll();
    }
    return importExport.importBackup({
      filePath: open.filePaths[0],
      password: options?.password,
      mode: options?.mode === "replace" ? "replace" : "merge",
    });
  });

  ipcMain.handle("import:openssh", async () => {
    const open = await dialog.showOpenDialog({
      title: "导入 OpenSSH Config",
      properties: ["openFile"],
      filters: [{ name: "SSH Config", extensions: ["*", "config", "conf"] }],
    });
    if (open.canceled || !open.filePaths[0]) {
      return { ok: false, message: "已取消导入" };
    }
    return importExport.importOpenSsh(open.filePaths[0]);
  });
  ipcMain.handle("import:moba", async () => {
    const open = await dialog.showOpenDialog({
      title: "导入 MobaXterm 会话",
      properties: ["openFile"],
      filters: [
        {
          name: "MobaXterm",
          extensions: ["mxtsessions", "mobaconf", "ini", "txt"],
        },
      ],
    });
    if (open.canceled || !open.filePaths[0]) {
      return { ok: false, message: "已取消导入" };
    }
    return importExport.importMoba(open.filePaths[0]);
  });

  ipcMain.handle("app:getVersion", () => app.getVersion());
  ipcMain.handle("clipboard:writeText", (_event, text) => {
    clipboard.writeText(String(text ?? ""));
    return true;
  });
  ipcMain.handle("clipboard:readText", () => clipboard.readText());

  ipcMain.handle("shell:openExternal", async (_event, rawUrl) => {
    const url = String(rawUrl ?? "").trim();
    if (!url) {
      return { ok: false, message: "空链接" };
    }
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return { ok: false, message: "链接格式无效" };
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { ok: false, message: "仅允许打开 http/https 链接" };
    }
    try {
      await shell.openExternal(parsed.toString());
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "打开浏览器失败",
      };
    }
  });
}

/**
 * 创建带广播能力的事件发射器。
 *
 * @returns {(channel: string, payload: object) => void}
 */
function createSshEmitter() {
  return (channel, payload) => broadcast(channel, payload);
}

module.exports = { registerIpcHandlers, createSshEmitter };
