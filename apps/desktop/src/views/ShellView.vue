<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { NDropdown } from "naive-ui";
import type { DropdownOption } from "naive-ui";
import { brandName } from "@ezshell/ui-tokens";
import { createId } from "@ezshell/core";
import type { HostRecord, KeyMetadata } from "@ezshell/shared";
import HostPanel from "../components/HostPanel.vue";
import KeyPanel from "../components/KeyPanel.vue";
import SnippetPanel from "../components/SnippetPanel.vue";
import ForwardPanel from "../components/ForwardPanel.vue";
import SettingsPanel from "../components/SettingsPanel.vue";
import TerminalWorkspace from "../components/TerminalWorkspace.vue";
import PasswordDialog from "../components/PasswordDialog.vue";
import FingerprintDialog from "../components/FingerprintDialog.vue";
import type { TerminalSessionView } from "../types/ezshell";
import { requireDesktopApi } from "../lib/bridge";

const navItems = [
  { key: "hosts", label: "主机", icon: "H" },
  { key: "keys", label: "密钥", icon: "K" },
  { key: "forwards", label: "端口转发", icon: "F" },
  { key: "snippets", label: "片段", icon: "S" },
  { key: "settings", label: "设置", icon: "·" },
] as const;

type NavKey = (typeof navItems)[number]["key"];
type MainMode = "library" | "session";

const api = requireDesktopApi();
const activeNav = ref<NavKey>("hosts");
const mainMode = ref<MainMode>("library");
const keys = ref<KeyMetadata[]>([]);
const hosts = ref<HostRecord[]>([]);
const sessions = ref<TerminalSessionView[]>([]);
const activeSessionId = ref<string | null>(null);
const hostPanelRef = ref<{ refresh: () => Promise<void> } | null>(null);
const keyPanelRef = ref<{ refresh?: () => Promise<void> } | null>(null);

const passwordOpen = ref(false);
const passwordTitle = ref("输入密码");
const passwordMessage = ref("");
const passwordHostLabel = ref("");
const passwordSessionId = ref<string | null>(null);
const passwordHostId = ref<string | null>(null);

const fingerprintOpen = ref(false);
const fingerprintValue = ref("");
const fingerprintMessage = ref("");
const fingerprintChanged = ref(false);
const fingerprintSessionId = ref<string | null>(null);

const tabMenuShow = ref(false);
const tabMenuX = ref(0);
const tabMenuY = ref(0);
const tabMenuSessionId = ref<string | null>(null);

const unsubscribers: Array<() => void> = [];

const platform = computed(() => api.platform);
const showLibrary = computed(
  () => mainMode.value === "library" || !activeSessionId.value,
);
const activeHostId = computed(() => {
  const session = sessions.value.find((item) => item.id === activeSessionId.value);
  return session?.hostId ?? null;
});

/**
 * 切换侧栏模块，并回到资料库视图。
 *
 * @param key - 导航键
 * @returns {void}
 */
function selectNav(key: NavKey): void {
  activeNav.value = key;
  mainMode.value = "library";
}

/**
 * 回到主机库（保留已打开会话标签）。
 *
 * @returns {void}
 */
function openLibrary(): void {
  activeNav.value = "hosts";
  mainMode.value = "library";
}

/**
 * 聚焦某个终端会话。
 *
 * @param sessionId - 会话 ID
 * @returns {void}
 */
function focusSession(sessionId: string): void {
  if (!sessionId) {
    return;
  }
  activeSessionId.value = sessionId;
  mainMode.value = "session";
}

/**
 * 页签主体点击：切回对应会话终端。
 *
 * @param event - 鼠标事件
 * @param sessionId - 会话 ID
 * @returns {void}
 */
function onSessionTabClick(event: Event, sessionId: string): void {
  event.preventDefault();
  event.stopPropagation();
  focusSession(sessionId);
}

/**
 * 打开到指定主机的 SSH 会话。
 *
 * @param host - 主机
 * @param password - 可选密码
 * @param rememberPassword - 是否记住
 * @returns Promise
 */
async function connectHost(
  host: HostRecord,
  password?: string,
  rememberPassword?: boolean,
): Promise<void> {
  const sessionId = createId();
  const session: TerminalSessionView = {
    id: sessionId,
    hostId: host.id,
    title: host.name || `${host.host}`,
    status: "connecting",
    message: "正在连接…",
    authFailed: false,
  };
  sessions.value = [...sessions.value, session];
  activeSessionId.value = sessionId;
  mainMode.value = "session";

  const result = await api.connectSsh({
    sessionId,
    hostId: host.id,
    password,
    rememberPassword,
  });

  if (!result.ok && result.code === "NEED_PASSWORD") {
    openPasswordDialog(sessionId, host.id, "输入密码", result.message ?? "请输入 SSH 密码");
  }
}

/**
 * 打开密码对话框。
 *
 * @param sessionId - 会话 ID
 * @param hostId - 主机 ID
 * @param title - 标题
 * @param message - 说明
 * @returns {void}
 */
function openPasswordDialog(
  sessionId: string,
  hostId: string,
  title: string,
  message: string,
): void {
  passwordSessionId.value = sessionId;
  passwordHostId.value = hostId;
  passwordTitle.value = title;
  passwordMessage.value = message;
  const host = hosts.value.find((item) => item.id === hostId);
  passwordHostLabel.value = host
    ? `${host.username}@${host.host}:${host.port}`
    : "";
  passwordOpen.value = true;
}

/**
 * 取消密码输入并中止连接。
 *
 * @returns Promise
 */
async function cancelPassword(): Promise<void> {
  passwordOpen.value = false;
  if (passwordSessionId.value) {
    await api.disconnectSsh(passwordSessionId.value);
    updateSession(passwordSessionId.value, {
      status: "disconnected",
      message: "已取消输入密码",
      authFailed: false,
    });
  }
}

/**
 * 提交密码并重连同一会话。
 *
 * @param payload - 密码与记住选项
 * @returns Promise
 */
async function submitPassword(payload: {
  password: string;
  remember: boolean;
}): Promise<void> {
  const sessionId = passwordSessionId.value;
  const hostId = passwordHostId.value;
  if (!sessionId || !hostId) {
    return;
  }
  passwordOpen.value = false;
  updateSession(sessionId, {
    status: "connecting",
    message: "正在使用密码连接…",
    authFailed: false,
  });
  mainMode.value = "session";
  const result = await api.connectSsh({
    sessionId,
    hostId,
    password: payload.password,
    rememberPassword: payload.remember,
  });
  if (!result.ok && result.code === "NEED_PASSWORD") {
    openPasswordDialog(sessionId, hostId, "输入密码", result.message ?? "请输入密码");
  }
}

/**
 * 从工具栏对活动会话触发「输入密码并重连」。
 *
 * @param sessionId - 会话 ID
 * @returns {void}
 */
function reconnectWithPassword(sessionId: string): void {
  const session = sessions.value.find((item) => item.id === sessionId);
  if (!session) {
    return;
  }
  openPasswordDialog(
    sessionId,
    session.hostId,
    "输入密码并重连",
    "认证失败，请重新输入密码后重试",
  );
}

/**
 * 对失败或已断开的会话重新发起 SSH 连接（复用同一会话页签）。
 *
 * @param sessionId - 会话 ID
 * @returns Promise
 */
async function reconnectSession(sessionId: string): Promise<void> {
  const session = sessions.value.find((item) => item.id === sessionId);
  if (!session) {
    return;
  }
  if (session.authFailed) {
    reconnectWithPassword(sessionId);
    return;
  }
  if (session.status === "connecting") {
    return;
  }

  activeSessionId.value = sessionId;
  mainMode.value = "session";
  updateSession(sessionId, {
    status: "connecting",
    message: "正在重新连接…",
    authFailed: false,
  });

  try {
    const result = await api.connectSsh({
      sessionId,
      hostId: session.hostId,
    });
    if (!result.ok && result.code === "NEED_PASSWORD") {
      openPasswordDialog(
        sessionId,
        session.hostId,
        "输入密码",
        result.message ?? "请输入 SSH 密码",
      );
    } else if (!result.ok && result.code !== "NEED_PASSWORD") {
      // 状态一般由 onSshStatus 推送；兜底写入失败文案
      updateSession(sessionId, {
        status: "failed",
        message: result.message ?? "重连失败",
      });
    }
  } catch (error) {
    updateSession(sessionId, {
      status: "failed",
      message: error instanceof Error ? error.message : "重连失败",
    });
  }
}

/**
 * 接受主机指纹并继续握手。
 *
 * @returns Promise
 */
async function acceptFingerprint(): Promise<void> {
  const sessionId = fingerprintSessionId.value;
  if (!sessionId) {
    return;
  }
  fingerprintOpen.value = false;
  await api.resolveFingerprint(sessionId, true);
}

/**
 * 拒绝主机指纹。
 *
 * @returns Promise
 */
async function rejectFingerprint(): Promise<void> {
  const sessionId = fingerprintSessionId.value;
  if (!sessionId) {
    return;
  }
  fingerprintOpen.value = false;
  await api.resolveFingerprint(sessionId, false);
}

/**
 * 关闭会话标签。
 *
 * @param sessionId - 会话 ID
 * @returns Promise
 */
async function closeSession(sessionId: string): Promise<void> {
  try {
    await api.disconnectSsh(sessionId);
  } catch (error) {
    console.error("[EZShell] 断开会话失败", error);
  }
  sessions.value = sessions.value.filter((item) => item.id !== sessionId);
  if (activeSessionId.value === sessionId) {
    const next = sessions.value.at(-1);
    activeSessionId.value = next?.id ?? null;
    mainMode.value = next ? "session" : "library";
  }
}

/**
 * 页签关闭按钮（阻止冒泡到聚焦）。
 *
 * @param event - 鼠标事件
 * @param sessionId - 会话 ID
 * @returns {void}
 */
function onCloseTab(event: Event, sessionId: string): void {
  event.preventDefault();
  event.stopPropagation();
  void closeSession(sessionId);
}

/**
 * 关闭除指定会话外的其他页签。
 *
 * @param sessionId - 保留的会话 ID
 * @returns Promise
 */
async function closeOtherSessions(sessionId: string): Promise<void> {
  const others = sessions.value.filter((item) => item.id !== sessionId);
  for (const item of others) {
    try {
      await api.disconnectSsh(item.id);
    } catch (error) {
      console.error("[EZShell] 断开会话失败", error);
    }
  }
  sessions.value = sessions.value.filter((item) => item.id === sessionId);
  activeSessionId.value = sessionId;
  mainMode.value = "session";
}

/**
 * 关闭全部会话页签。
 *
 * @returns Promise
 */
async function closeAllSessions(): Promise<void> {
  const ids = sessions.value.map((item) => item.id);
  for (const id of ids) {
    try {
      await api.disconnectSsh(id);
    } catch (error) {
      console.error("[EZShell] 断开会话失败", error);
    }
  }
  sessions.value = [];
  activeSessionId.value = null;
  mainMode.value = "library";
}

/**
 * 页签右键菜单选项（随目标会话状态变化）。
 */
const tabMenuOptions = computed<DropdownOption[]>(() => {
  const session = sessions.value.find((item) => item.id === tabMenuSessionId.value);
  const connecting = session?.status === "connecting";
  const authFailed = Boolean(session?.authFailed);
  return [
    {
      label: authFailed ? "输入密码并重连" : "重新连接",
      key: "reconnect",
      disabled: connecting,
    },
    {
      type: "divider",
      key: "d1",
    },
    {
      label: "关闭",
      key: "close",
    },
    {
      label: "关闭其他",
      key: "closeOthers",
      disabled: sessions.value.length <= 1,
    },
    {
      label: "关闭全部",
      key: "closeAll",
    },
  ];
});

/**
 * 打开页签右键菜单。
 *
 * @param event - 鼠标事件
 * @param sessionId - 会话 ID
 * @returns {void}
 */
function onTabContextMenu(event: MouseEvent, sessionId: string): void {
  event.preventDefault();
  event.stopPropagation();
  tabMenuSessionId.value = sessionId;
  tabMenuX.value = event.clientX;
  tabMenuY.value = event.clientY;
  tabMenuShow.value = true;
}

/**
 * 处理页签右键菜单选择。
 *
 * @param key - 菜单项 key
 * @returns {void}
 */
function onTabMenuSelect(key: string | number): void {
  const sessionId = tabMenuSessionId.value;
  tabMenuShow.value = false;
  if (!sessionId) {
    return;
  }
  switch (String(key)) {
    case "reconnect":
      void reconnectSession(sessionId);
      break;
    case "close":
      void closeSession(sessionId);
      break;
    case "closeOthers":
      void closeOtherSessions(sessionId);
      break;
    case "closeAll":
      void closeAllSessions();
      break;
    default:
      break;
  }
}

/**
 * 更新会话视图状态。
 *
 * @param sessionId - 会话 ID
 * @param patch - 局部字段
 * @returns {void}
 */
function updateSession(
  sessionId: string,
  patch: Partial<TerminalSessionView>,
): void {
  sessions.value = sessions.value.map((item) =>
    item.id === sessionId ? { ...item, ...patch } : item,
  );
}

/**
 * 导入完成后刷新主机/密钥面板，并切回主机库。
 *
 * @returns Promise
 */
async function onImported(): Promise<void> {
  await hostPanelRef.value?.refresh();
  if (keyPanelRef.value?.refresh) {
    await keyPanelRef.value.refresh();
  } else {
    keys.value = await api.listKeys();
  }
  hosts.value = await api.listHosts();
  activeNav.value = "hosts";
  mainMode.value = "library";
}

/**
 * 全局快捷键。
 *
 * @param event - 键盘事件
 * @returns {void}
 */
function onKeydown(event: KeyboardEvent): void {
  if (event.ctrlKey && event.key.toLowerCase() === "w" && activeSessionId.value) {
    event.preventDefault();
    void closeSession(activeSessionId.value);
  }
  if (event.ctrlKey && event.key.toLowerCase() === "t") {
    event.preventDefault();
    openLibrary();
  }
}

onMounted(() => {
  void api.listHosts().then((list) => {
    hosts.value = list;
  });
  unsubscribers.push(
    api.onSshStatus((payload) => {
      updateSession(payload.sessionId, {
        status: payload.status,
        message: payload.message,
        ...(payload.status === "connected" || payload.status === "connecting"
          ? { authFailed: false }
          : {}),
      });
    }),
    api.onSshNeedPassword((payload) => {
      updateSession(payload.sessionId, {
        status: "failed",
        message: payload.message,
        authFailed: true,
      });
      openPasswordDialog(
        payload.sessionId,
        payload.hostId,
        payload.reason === "authFailed" ? "认证失败，请重新输入密码" : "输入密码",
        payload.message,
      );
    }),
    api.onSshFingerprint((payload) => {
      fingerprintSessionId.value = payload.sessionId;
      fingerprintValue.value = payload.fingerprint;
      fingerprintMessage.value = payload.message;
      fingerprintChanged.value = payload.changed;
      fingerprintOpen.value = true;
    }),
    api.onSshClosed((payload) => {
      updateSession(payload.sessionId, {
        status: "disconnected",
        message: "连接已关闭",
      });
    }),
  );
  window.addEventListener("keydown", onKeydown);
});

onBeforeUnmount(() => {
  for (const off of unsubscribers) {
    off();
  }
  window.removeEventListener("keydown", onKeydown);
});
</script>

<template>
  <div class="shell">
    <aside class="rail">
      <div class="brand">
        <span class="mark">EZ</span>
        <span class="name">{{ brandName }}</span>
      </div>
      <nav>
        <button
          v-for="item in navItems"
          :key="item.key"
          type="button"
          :title="item.label"
          :aria-label="item.label"
          :class="{ active: activeNav === item.key && mainMode === 'library' }"
          @click="selectNav(item.key)"
        >
          <span class="icon" aria-hidden="true">{{ item.icon }}</span>
          <span class="label">{{ item.label }}</span>
        </button>
      </nav>
      <div class="meta">{{ platform }}</div>
    </aside>

    <section class="stage">
      <header v-if="sessions.length > 0" class="topbar">
        <div class="tabs">
          <button
            v-for="session in sessions"
            :key="session.id"
            type="button"
            class="tab session"
            :class="{ active: !showLibrary && session.id === activeSessionId }"
            @click="onSessionTabClick($event, session.id)"
            @contextmenu="onTabContextMenu($event, session.id)"
          >
            <span class="dot" :data-status="session.status" />
            <span class="title">{{ session.title }}</span>
            <span
              class="close"
              title="关闭"
              role="button"
              @mousedown.prevent.stop="onCloseTab($event, session.id)"
              @click.prevent.stop="onCloseTab($event, session.id)"
            >×</span>
          </button>
        </div>
        <NDropdown
          placement="bottom-start"
          trigger="manual"
          :x="tabMenuX"
          :y="tabMenuY"
          :show="tabMenuShow"
          :options="tabMenuOptions"
          @select="onTabMenuSelect"
          @clickoutside="tabMenuShow = false"
        />
      </header>

      <div class="body">
        <div
          v-show="showLibrary"
          class="library"
          :class="{ 'is-active': showLibrary }"
        >
          <HostPanel
            ref="hostPanelRef"
            v-show="activeNav === 'hosts'"
            :keys="keys"
            @connect="connectHost"
            @refreshed="(list) => (hosts = list)"
          />
          <KeyPanel
            ref="keyPanelRef"
            v-show="activeNav === 'keys'"
            @changed="(list) => (keys = list)"
          />
          <ForwardPanel
            v-show="activeNav === 'forwards'"
            :hosts="hosts"
          />
          <SnippetPanel
            v-show="activeNav === 'snippets'"
            :active-session-id="activeSessionId"
            :active-host-id="activeHostId"
          />
          <SettingsPanel
            v-if="activeNav === 'settings'"
            @imported="onImported"
          />
        </div>

        <TerminalWorkspace
          v-show="!showLibrary"
          class="terminal-stage"
          :class="{ 'is-active': !showLibrary }"
          hide-tabs
          :visible="!showLibrary"
          v-model:active-session-id="activeSessionId"
          :sessions="sessions"
          @close="closeSession"
          @reconnect-password="reconnectWithPassword"
          @reconnect="reconnectSession"
        />
      </div>
    </section>

    <PasswordDialog
      :open="passwordOpen"
      :title="passwordTitle"
      :message="passwordMessage"
      :host-label="passwordHostLabel"
      @cancel="cancelPassword"
      @submit="submitPassword"
    />

    <FingerprintDialog
      :open="fingerprintOpen"
      :fingerprint="fingerprintValue"
      :message="fingerprintMessage"
      :changed="fingerprintChanged"
      @accept="acceptFingerprint"
      @reject="rejectFingerprint"
    />
  </div>
</template>

<style scoped>
.shell {
  display: grid;
  grid-template-columns: minmax(72px, 188px) minmax(0, 1fr);
  height: 100%;
  width: 100%;
  min-width: 0;
  background: var(--ez-color-bg);
  transition: grid-template-columns 0.18s ease;
}

.rail {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 10px;
  background: var(--ez-color-bg-sidebar);
  border-right: 1px solid var(--ez-color-border);
  z-index: 5;
  position: relative;
  min-width: 0;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px 12px;
  border-bottom: 1px solid var(--ez-color-border);
  min-width: 0;
}

.mark {
  flex: 0 0 auto;
  width: 32px;
  height: 32px;
  border-radius: 9px;
  display: grid;
  place-items: center;
  background: linear-gradient(
    145deg,
    var(--ez-color-primary),
    var(--ez-color-primary-hover)
  );
  color: var(--ez-color-primary-ink);
  font-weight: 800;
  font-size: 12px;
}

.name {
  font-size: 15px;
  color: var(--ez-color-primary);
  font-weight: 700;
  letter-spacing: 0.02em;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

nav {
  display: grid;
  gap: 4px;
}

nav button {
  display: flex;
  align-items: center;
  gap: 10px;
  border: none;
  background: transparent;
  color: var(--ez-color-text-muted);
  padding: 10px 10px;
  border-radius: var(--ez-radius-md);
  cursor: pointer;
  font-size: 13px;
  text-align: left;
  width: 100%;
  min-width: 0;
}

nav button .icon {
  flex: 0 0 auto;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  font-size: 12px;
  font-weight: 700;
  background: rgba(154, 163, 189, 0.1);
}

nav button .label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

nav button.active .icon {
  background: var(--ez-color-primary-muted);
  color: var(--ez-color-primary);
}

nav button.active,
nav button:hover {
  background: var(--ez-color-primary-muted);
  color: var(--ez-color-text);
}

nav button.active {
  color: var(--ez-color-primary);
}

.meta {
  margin-top: auto;
  text-align: left;
  font-size: 11px;
  color: var(--ez-color-text-muted);
  padding: 8px 10px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.stage {
  display: grid;
  grid-template-rows: 1fr;
  min-width: 0;
  min-height: 0;
  background: var(--ez-color-bg);
}

.stage:has(.topbar) {
  grid-template-rows: 44px 1fr;
}

.topbar {
  display: flex;
  align-items: stretch;
  border-bottom: 1px solid var(--ez-color-border);
  background: var(--ez-color-bg-deep);
  position: relative;
  z-index: 20;
}

.tabs {
  display: flex;
  align-items: stretch;
  gap: 2px;
  padding: 0 8px;
  overflow-x: auto;
  width: 100%;
}

.tab {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: none;
  background: transparent;
  color: var(--ez-color-text-muted);
  padding: 0 14px;
  cursor: pointer;
  font-size: 13px;
  border-bottom: 2px solid transparent;
  white-space: nowrap;
  height: 100%;
  flex: 0 0 auto;
}

.tab.session .title {
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tab:hover {
  color: var(--ez-color-text);
  background: rgba(154, 163, 189, 0.08);
}

.tab.active {
  color: var(--ez-color-primary);
  border-bottom-color: var(--ez-color-primary);
  background: var(--ez-color-primary-muted);
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--ez-color-text-muted);
}

.dot[data-status="connecting"] {
  background: var(--ez-color-warning);
}

.dot[data-status="connected"] {
  background: var(--ez-color-success);
}

.dot[data-status="failed"] {
  background: var(--ez-color-danger);
}

.close {
  opacity: 0.55;
  font-size: 16px;
  line-height: 1;
  padding: 2px 4px;
  border-radius: 4px;
}

.close:hover {
  opacity: 1;
  color: var(--ez-color-danger);
  background: rgba(248, 113, 113, 0.15);
}

.body {
  min-height: 0;
  min-width: 0;
  position: relative;
  z-index: 1;
}

.library,
.terminal-stage {
  position: absolute;
  inset: 0;
  overflow: hidden;
  z-index: 0;
  pointer-events: none;
}

.library.is-active,
.terminal-stage.is-active {
  z-index: 2;
  pointer-events: auto;
}

.placeholder-card {
  padding: 28px 32px;
  max-width: 520px;
}

.placeholder-card h2 {
  margin: 0 0 8px;
}

.placeholder-card p,
.muted {
  color: var(--ez-color-text-muted);
}

@media (max-width: 1100px) {
  .shell {
    grid-template-columns: 72px minmax(0, 1fr);
  }

  .rail {
    padding: 10px 8px;
  }

  .brand {
    justify-content: center;
    padding: 6px 0 12px;
  }

  .name,
  nav button .label,
  .meta {
    display: none;
  }

  nav button {
    justify-content: center;
    padding: 10px 6px;
  }
}

@media (max-width: 800px) {
  .stage:has(.topbar) {
    grid-template-rows: 40px 1fr;
  }

  .tab {
    padding: 0 10px;
    font-size: 12px;
    gap: 6px;
  }

  .tab.session .title {
    max-width: 96px;
  }
}

@media (max-width: 640px) {
  .shell {
    grid-template-columns: 56px minmax(0, 1fr);
  }

  .rail {
    padding: 8px 4px;
  }

  .mark {
    width: 28px;
    height: 28px;
    font-size: 11px;
  }

  nav button .icon {
    width: 26px;
    height: 26px;
  }

  .tab.session .title {
    max-width: 72px;
  }

  .placeholder-card {
    padding: 16px;
  }
}
</style>
