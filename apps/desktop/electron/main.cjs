const { app, BrowserWindow, Menu, shell } = require("electron");
const path = require("node:path");
const { DataStore } = require("./data-store.cjs");
const { SecretStore } = require("./secret-store.cjs");
const { KeyService } = require("./key-service.cjs");
const { SshManager } = require("./ssh-manager.cjs");
const { ForwardManager } = require("./forward-manager.cjs");
const { ImportExportService } = require("./import-export.cjs");
const { registerIpcHandlers, createSshEmitter } = require("./ipc.cjs");

const isDev = !app.isPackaged;
const DEV_URL = process.env.VITE_DEV_SERVER_URL || "http://127.0.0.1:5174/";

/** @type {BrowserWindow | null} */
let mainWindow = null;

/**
 * 安装应用菜单。
 * Windows/Linux 隐藏原生菜单栏（贴近 Termius）；macOS 保留精简中文菜单。
 *
 * @returns {void}
 */
function setupAppMenu() {
  if (process.platform !== "darwin") {
    Menu.setApplicationMenu(null);
    return;
  }

  const template = [
    {
      label: app.name,
      submenu: [
        { role: "about", label: "关于 EZShell" },
        { type: "separator" },
        { role: "services", label: "服务" },
        { type: "separator" },
        { role: "hide", label: "隐藏 EZShell" },
        { role: "hideOthers", label: "隐藏其他" },
        { role: "unhide", label: "显示全部" },
        { type: "separator" },
        { role: "quit", label: "退出 EZShell" },
      ],
    },
    {
      label: "编辑",
      submenu: [
        { role: "undo", label: "撤销" },
        { role: "redo", label: "重做" },
        { type: "separator" },
        { role: "cut", label: "剪切" },
        { role: "copy", label: "复制" },
        { role: "paste", label: "粘贴" },
        { role: "selectAll", label: "全选" },
      ],
    },
    {
      label: "查看",
      submenu: [
        { role: "reload", label: "重新加载" },
        { role: "toggleDevTools", label: "开发者工具" },
        { type: "separator" },
        { role: "resetZoom", label: "实际大小" },
        { role: "zoomIn", label: "放大" },
        { role: "zoomOut", label: "缩小" },
        { type: "separator" },
        { role: "togglefullscreen", label: "进入全屏" },
      ],
    },
    {
      label: "窗口",
      submenu: [
        { role: "minimize", label: "最小化" },
        { role: "zoom", label: "缩放" },
        { type: "separator" },
        { role: "front", label: "全部置于顶层" },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/**
 * 创建主窗口。
 *
 * @returns {BrowserWindow} 主窗口实例
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 720,
    minHeight: 520,
    title: "EZShell",
    backgroundColor: "#252a42",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (isDev) {
    void mainWindow.loadURL(DEV_URL);
    // 默认不自动打开 DevTools，避免 Chromium Autofill CDP 噪音刷屏；
    // 需要时设 EZSHELL_OPEN_DEVTOOLS=1，或按 F12 切换。
    if (process.env.EZSHELL_OPEN_DEVTOOLS === "1") {
      mainWindow.webContents.openDevTools({ mode: "detach" });
    }
    mainWindow.webContents.on("before-input-event", (event, input) => {
      if (input.type === "keyDown" && input.key === "F12") {
        mainWindow?.webContents.toggleDevTools();
        event.preventDefault();
      }
    });
    mainWindow.webContents.on("console-message", (_e, level, message) => {
      if (level >= 2) {
        console.error(`[renderer] ${message}`);
      }
    });
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  mainWindow.webContents.on("did-finish-load", () => {
    if (!isDev) {
      return;
    }
    void mainWindow?.webContents
      .executeJavaScript(
        `({ href: location.href, hasBridge: Boolean(window.ezshell), appHtml: (document.querySelector('#app')?.innerHTML || '').slice(0, 120) })`,
      )
      .then((info) => {
        console.log("[EZShell] 渲染层就绪", info);
        if (!info?.hasBridge) {
          console.error(
            "[EZShell] 未注入桌面桥接，请确认当前加载的是 Electron 窗口且 preload 生效",
          );
        }
        if (!info?.appHtml) {
          console.error(
            "[EZShell] #app 为空。若 URL 不是 127.0.0.1:5174，可能撞上其它项目的 Vite 端口",
          );
        }
      })
      .catch((error) => {
        console.error("[EZShell] 渲染诊断失败", error);
      });
  });

  mainWindow.webContents.on("did-fail-load", (_event, code, desc, url) => {
    console.error("[EZShell] 页面加载失败", { code, desc, url });
    if (isDev) {
      setTimeout(() => {
        void mainWindow?.loadURL(DEV_URL);
      }, 800);
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  return mainWindow;
}

/**
 * 应用就绪后初始化存储、SSH 与窗口。
 *
 * @returns {void}
 */
function bootstrap() {
  setupAppMenu();
  const dataStore = new DataStore();
  const secretStore = new SecretStore();
  const keyService = new KeyService(dataStore, secretStore);
  const emit = createSshEmitter();
  const sshManager = new SshManager({
    dataStore,
    secretStore,
    keyService,
    emit,
  });
  const forwardManager = new ForwardManager({
    dataStore,
    secretStore,
    keyService,
    emit,
  });
  const importExport = new ImportExportService({
    dataStore,
    secretStore,
    keyService,
  });
  registerIpcHandlers({
    dataStore,
    secretStore,
    keyService,
    sshManager,
    forwardManager,
    importExport,
  });
  createWindow();
}

app.whenReady().then(() => {
  bootstrap();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
