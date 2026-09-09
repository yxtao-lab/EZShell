const { contextBridge, ipcRenderer } = require("electron");

/**
 * 订阅主进程推送事件。
 *
 * @param {string} channel - 通道
 * @param {(payload: any) => void} listener - 回调
 * @returns {() => void} 取消订阅函数
 */
function on(channel, listener) {
  const wrapped = (_event, payload) => listener(payload);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

contextBridge.exposeInMainWorld("ezshell", {
  platform: process.platform,
  appName: "EZShell",

  listHosts: () => ipcRenderer.invoke("storage:listHosts"),
  upsertHost: (input) => ipcRenderer.invoke("storage:upsertHost", input),
  deleteHost: (id) => ipcRenderer.invoke("storage:deleteHost", id),
  listGroups: () => ipcRenderer.invoke("storage:listGroups"),
  upsertGroup: (input) => ipcRenderer.invoke("storage:upsertGroup", input),
  deleteGroup: (id) => ipcRenderer.invoke("storage:deleteGroup", id),

  hasPassword: (hostId) => ipcRenderer.invoke("secrets:hasPassword", hostId),
  deletePassword: (hostId) => ipcRenderer.invoke("secrets:deletePassword", hostId),

  listKeys: () => ipcRenderer.invoke("keys:list"),
  generateKey: (name) => ipcRenderer.invoke("keys:generate", name),
  importKey: (input) => ipcRenderer.invoke("keys:import", input),
  deleteKey: (id) => ipcRenderer.invoke("keys:delete", id),
  getPublicKey: (id) => ipcRenderer.invoke("keys:getPublicKey", id),

  connectSsh: (options) => ipcRenderer.invoke("ssh:connect", options),
  disconnectSsh: (sessionId) => ipcRenderer.invoke("ssh:disconnect", sessionId),
  writeSsh: (sessionId, data) => {
    ipcRenderer.send("ssh:write", sessionId, data);
  },
  resizeSsh: (sessionId, cols, rows) =>
    ipcRenderer.invoke("ssh:resize", sessionId, cols, rows),
  resolveFingerprint: (sessionId, accepted) =>
    ipcRenderer.invoke("ssh:resolveFingerprint", sessionId, accepted),

  sftpList: (sessionId, remotePath) =>
    ipcRenderer.invoke("sftp:list", sessionId, remotePath),
  sftpUp: (sessionId) => ipcRenderer.invoke("sftp:up", sessionId),
  sftpRename: (sessionId, fromPath, toPath) =>
    ipcRenderer.invoke("sftp:rename", sessionId, fromPath, toPath),
  sftpDelete: (sessionId, remotePath, isDirectory) =>
    ipcRenderer.invoke("sftp:delete", sessionId, remotePath, isDirectory),
  sftpDownload: (sessionId, remotePath) =>
    ipcRenderer.invoke("sftp:download", sessionId, remotePath),
  sftpUpload: (sessionId, remoteDir) =>
    ipcRenderer.invoke("sftp:upload", sessionId, remoteDir),

  listSnippets: () => ipcRenderer.invoke("snippets:list"),
  upsertSnippet: (input) => ipcRenderer.invoke("snippets:upsert", input),
  deleteSnippet: (id) => ipcRenderer.invoke("snippets:delete", id),
  sendSnippet: (payload) => ipcRenderer.invoke("snippets:send", payload),

  listForwards: () => ipcRenderer.invoke("forwards:list"),
  upsertForward: (input) => ipcRenderer.invoke("forwards:upsert", input),
  deleteForward: (id) => ipcRenderer.invoke("forwards:delete", id),
  startForward: (ruleId, auth) => ipcRenderer.invoke("forwards:start", ruleId, auth),
  stopForward: (ruleId) => ipcRenderer.invoke("forwards:stop", ruleId),
  listRunningForwards: () => ipcRenderer.invoke("forwards:running"),

  exportBackup: (options) => ipcRenderer.invoke("backup:export", options),
  importBackup: (options) => ipcRenderer.invoke("backup:import", options),
  importOpenSsh: () => ipcRenderer.invoke("import:openssh"),
  importMoba: () => ipcRenderer.invoke("import:moba"),
  getAppVersion: () => ipcRenderer.invoke("app:getVersion"),
  writeClipboard: (text) => ipcRenderer.invoke("clipboard:writeText", text),
  readClipboard: () => ipcRenderer.invoke("clipboard:readText"),
  openExternal: (url) => ipcRenderer.invoke("shell:openExternal", url),

  onSshData: (listener) => on("ssh:data", listener),
  onSshStatus: (listener) => on("ssh:status", listener),
  onSshNeedPassword: (listener) => on("ssh:needPassword", listener),
  onSshFingerprint: (listener) => on("ssh:fingerprint", listener),
  onSshClosed: (listener) => on("ssh:closed", listener),
  onForwardStatus: (listener) => on("forward:status", listener),
});
