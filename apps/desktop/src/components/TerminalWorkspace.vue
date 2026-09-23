<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { NButton, NSpin } from "naive-ui";
import "@xterm/xterm/css/xterm.css";
import type { TerminalSessionView } from "../types/ezshell";
import { requireDesktopApi } from "../lib/bridge";
import SftpPanel from "./SftpPanel.vue";

const props = defineProps<{
  sessions: TerminalSessionView[];
  activeSessionId: string | null;
  /** 为 true 时由外层顶栏管理会话标签 */
  hideTabs?: boolean;
  /** 外层是否正在展示本工作区（避免 display:none 时 fit 压扁画布） */
  visible?: boolean;
}>();

const emit = defineEmits<{
  "update:activeSessionId": [id: string | null];
  close: [sessionId: string];
  reconnectPassword: [sessionId: string];
  reconnect: [sessionId: string];
}>();

const api = requireDesktopApi();
const workspaceRef = ref<HTMLElement | null>(null);
const stackRef = ref<HTMLElement | null>(null);
const containerRefs = ref<Record<string, HTMLElement | null>>({});
const terminals = new Map<
  string,
  { term: Terminal; fit: FitAddon; opened: boolean }
>();
const paneMode = ref<"terminal" | "sftp">("terminal");
const copyHint = ref("");
/** 已向终端写入过「正在连接」提示的会话，避免重复刷屏 */
const connectingAnnounced = new Set<string>();
/** 终端不可见时暂存输出，避免 OpenCode 等 TUI 后台狂刷卡死界面 */
const pendingOutput = new Map<string, string>();
const PENDING_OUTPUT_LIMIT = 256_000;
let removeData: (() => void) | null = null;
let resizeObserver: ResizeObserver | null = null;
let fitTimer: ReturnType<typeof setTimeout> | null = null;
let copyHintTimer: ReturnType<typeof setTimeout> | null = null;
let mouseGuardTimer: ReturnType<typeof setInterval> | null = null;
/** 中文等 IME 正在合成 */
let imeComposing = false;
/** 合成结束后禁止 xterm onData 转发的截止时间 */
let imeSuppressInputUntil = 0;
/** 本次合成开始时 textarea 已有内容长度 */
let imeCompositionBaseline = 0;
/** 最近一次由我们提交的上屏内容（用于去重） */
let lastImeCommitText = "";
let lastImeCommitAt = 0;

/** 需在本地抑制的 xterm 鼠标相关 DEC 私有模式 */
const MOUSE_MODE_IDS = new Set([
  "1000",
  "1001",
  "1002",
  "1003",
  "1004",
  "1005",
  "1006",
  "1015",
  "1016",
]);

/**
 * 当前是否处于备用屏（vim / OpenCode / less 等 TUI）。
 * 备用屏没有本地 scrollback，滚轮必须交给远端应用。
 *
 * @param term - xterm 实例
 * @returns 是否为备用屏
 */
function isAlternateScreen(term: Terminal): boolean {
  try {
    return term.buffer.active.type === "alternate";
  } catch {
    return false;
  }
}

/**
 * 启动/停止本地鼠标模式抑制。
 * 仅在连接/切回终端时复位一次；不再定时 term.write，以免打断中文输入法。
 * 备用屏（OpenCode 等）不抑制，否则滚轮无法滚动远端界面。
 *
 * @param enabled - 是否启用（false 时清理可能残留的定时器）
 * @returns {void}
 */
function setMouseGuard(enabled: boolean): void {
  if (mouseGuardTimer) {
    clearInterval(mouseGuardTimer);
    mouseGuardTimer = null;
  }
  if (!enabled || imeComposing) {
    return;
  }
  if (!shouldRenderOutput() || !props.activeSessionId) {
    return;
  }
  const session = props.sessions.find((item) => item.id === props.activeSessionId);
  if (session?.status === "connected") {
    disableLocalMouse(session.id);
  }
}

const activeSession = computed(() =>
  props.sessions.find((item) => item.id === props.activeSessionId) ?? null,
);

const showConnectingOverlay = computed(() => {
  const status = activeSession.value?.status;
  return status === "connecting" || status === "idle";
});

const showStatusOverlay = computed(() => {
  const status = activeSession.value?.status;
  return (
    status === "connecting" ||
    status === "idle" ||
    status === "failed" ||
    status === "disconnected"
  );
});

const canReconnect = computed(() => {
  const session = activeSession.value;
  if (!session) {
    return false;
  }
  return session.status === "failed" || session.status === "disconnected";
});

/**
 * 绑定会话终端容器 DOM 引用。
 *
 * @param sessionId - 会话 ID
 * @param el - 容器元素或 null
 * @returns {void}
 */
function setContainerRef(sessionId: string, el: unknown): void {
  containerRefs.value[sessionId] = (el as HTMLElement | null) ?? null;
}

/**
 * 工作区是否具备可测量尺寸（可见且宽高足够）。
 *
 * @returns 是否可安全 fit
 */
function canMeasure(): boolean {
  if (props.visible === false) {
    return false;
  }
  if (paneMode.value !== "terminal") {
    return false;
  }
  const stack = stackRef.value;
  if (!stack) {
    return false;
  }
  return stack.clientWidth >= 40 && stack.clientHeight >= 40;
}

/**
 * 安全调整指定会话终端尺寸。
 *
 * @param sessionId - 会话 ID
 * @returns {void}
 */
function fitSession(sessionId: string): void {
  if (!canMeasure()) {
    return;
  }
  const el = containerRefs.value[sessionId];
  const pair = terminals.get(sessionId);
  if (!el || !pair?.opened) {
    return;
  }
  if (el.clientWidth < 40 || el.clientHeight < 40) {
    return;
  }
  try {
    pair.fit.fit();
    const { cols, rows } = pair.term;
    if (cols > 1 && rows > 1) {
      void api.resizeSsh(sessionId, cols, rows);
      pair.term.refresh(0, Math.max(0, rows - 1));
    }
  } catch {
    // fit 在过渡帧可能抛错，忽略后由下次 resize 恢复
  }
}

/**
 * 防抖后重新测量活动终端。
 *
 * @returns {void}
 */
function scheduleFit(): void {
  if (fitTimer) {
    clearTimeout(fitTimer);
  }
  fitTimer = setTimeout(() => {
    fitTimer = null;
    if (!props.activeSessionId) {
      return;
    }
    requestAnimationFrame(() => {
      fitSession(props.activeSessionId!);
    });
  }, 32);
}

/**
 * 当前是否应把 SSH 输出写入 xterm（可见且在终端页）。
 *
 * @returns 是否可渲染输出
 */
function shouldRenderOutput(): boolean {
  return props.visible !== false && paneMode.value === "terminal";
}

/**
 * 缓冲不可见时的终端输出（截断超长内容）。
 *
 * @param sessionId - 会话 ID
 * @param data - 新增输出
 * @returns {void}
 */
function bufferOutput(sessionId: string, data: string): void {
  const merged = `${pendingOutput.get(sessionId) ?? ""}${data}`;
  pendingOutput.set(
    sessionId,
    merged.length > PENDING_OUTPUT_LIMIT
      ? merged.slice(-PENDING_OUTPUT_LIMIT)
      : merged,
  );
}

/** 进入备用屏的常见 DECSET（与鼠标开启常在同一输出包内） */
const ENTER_ALT_SCREEN_RE =
  /\x1b\[\?(?:[\d;]*;)?(?:1049|1047|47)(?:;[\d]*)?h/;

/**
 * 按会话过滤远端输出：普通屏剥离鼠标跟踪开启序列，备用屏原样放行。
 *
 * @param sessionId - 会话 ID
 * @param data - SSH 原始输出
 * @returns 过滤后的输出
 */
function filterIncomingData(sessionId: string, data: string): string {
  const pair = terminals.get(sessionId);
  if (pair?.opened && isAlternateScreen(pair.term)) {
    return data;
  }
  // 同包进入备用屏时勿剥鼠标序列，否则 OpenCode 等 TUI 无法滚轮
  if (ENTER_ALT_SCREEN_RE.test(data)) {
    return data;
  }
  return stripMouseEnableSequences(data);
}

/**
 * 从远端输出中剥离「开启鼠标跟踪」的 DECSET，避免 xterm 进入鼠标协议。
 * 不修改关闭序列（…l），也不向 SSH stdin 注入任何内容。
 *
 * @param data - SSH 原始输出
 * @returns 过滤后的输出
 */
function stripMouseEnableSequences(data: string): string {
  return data.replace(/\x1b\[\?([\d;]+)([hl])/g, (match, params: string, flag: string) => {
    if (flag !== "h") {
      return match;
    }
    const kept = params.split(";").filter((mode) => !MOUSE_MODE_IDS.has(mode));
    if (kept.length === 0) {
      return "";
    }
    if (kept.length === params.split(";").length) {
      return match;
    }
    return `\x1b[?${kept.join(";")}h`;
  });
}

/**
 * 判断 onData 是否为鼠标上报（误入鼠标模式时不应转发给 SSH）。
 *
 * @param data - xterm onData 载荷
 * @returns 是否为鼠标上报
 */
function isMouseReportInput(data: string): boolean {
  return (
    data.startsWith("\x1b[M") ||
    data.startsWith("\x1b[<") ||
    /^\x1b\[\d+;\d+;[Mm]$/.test(data)
  );
}

/**
 * 在本地 xterm 关闭鼠标跟踪模式（只写终端解析器，不写远端 stdin）。
 * IME 合成期间、以及备用屏（远端 TUI）跳过，避免无法滚动。
 *
 * @param sessionId - 会话 ID
 * @returns {void}
 */
function disableLocalMouse(sessionId: string): void {
  if (imeComposing) {
    return;
  }
  const pair = terminals.get(sessionId);
  if (!pair?.opened) {
    return;
  }
  if (isAlternateScreen(pair.term)) {
    return;
  }
  pair.term.write(
    "\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?1015l\x1b[?1001l",
  );
}

/**
 * 判断当前是否处于输入法合成（中文等）。
 *
 * @param event - 键盘事件
 * @returns 是否在合成
 */
function isImeKeyEvent(event: KeyboardEvent): boolean {
  return (
    imeComposing ||
    event.isComposing ||
    event.keyCode === 229 ||
    event.key === "Process"
  );
}

/**
 * 是否应将 xterm onData 写入 SSH。
 * 输入法合成期及刚上屏后的抑制窗口内全部丢弃（改由 compositionend 只发一次）。
 * 备用屏下的鼠标上报放行，供 OpenCode 等 TUI 滚动/点击。
 *
 * @param sessionId - 会话 ID
 * @param data - xterm onData 载荷
 * @returns 是否写入远端
 */
function shouldForwardTerminalInput(sessionId: string, data: string): boolean {
  if (isMouseReportInput(data)) {
    const pair = terminals.get(sessionId);
    return Boolean(pair?.opened && isAlternateScreen(pair.term));
  }
  if (imeComposing || Date.now() < imeSuppressInputUntil) {
    return false;
  }
  return true;
}

/**
 * 向会话写入输入法上屏文本（带短时去重，避免 compositionend 连触发）。
 *
 * @param sessionId - 会话 ID
 * @param text - 上屏文本
 * @returns {void}
 */
function commitImeText(sessionId: string, text: string): void {
  const value = text;
  if (!value) {
    return;
  }
  const now = Date.now();
  if (value === lastImeCommitText && now - lastImeCommitAt < 400) {
    return;
  }
  lastImeCommitText = value;
  lastImeCommitAt = now;
  api.writeSsh(sessionId, value);
}

/**
 * 接管 Windows 中文输入法上屏：禁止 xterm 多路径重复提交，仅在 compositionend 发送一次。
 *
 * @param sessionId - 会话 ID
 * @param term - xterm 实例
 * @param hostEl - 终端宿主
 * @returns {void}
 */
function patchImeInput(
  sessionId: string,
  term: Terminal,
  hostEl: HTMLElement,
): void {
  const textarea = hostEl.querySelector(
    ".xterm-helper-textarea",
  ) as HTMLTextAreaElement | null;
  if (!textarea) {
    return;
  }

  textarea.setAttribute("spellcheck", "false");
  textarea.setAttribute("autocorrect", "off");
  textarea.setAttribute("autocomplete", "off");
  textarea.setAttribute("autocapitalize", "off");

  // 切断 xterm CompositionHelper 的自动提交，避免与我们的提交叠加
  const core = (
    term as unknown as {
      _core?: {
        _compositionHelper?: {
          compositionend?: () => void;
          _compositionView?: HTMLElement;
          _isComposing?: boolean;
          _isSendingComposition?: boolean;
        };
        _inputEvent?: (ev: InputEvent) => boolean;
      };
    }
  )._core;

  const helper = core?._compositionHelper;
  if (helper) {
    helper.compositionend = () => {
      helper._compositionView?.classList.remove("active");
      helper._isComposing = false;
      helper._isSendingComposition = false;
    };
  }

  if (core && typeof core._inputEvent === "function") {
    const originalInputEvent = core._inputEvent.bind(core);
    core._inputEvent = (ev: InputEvent): boolean => {
      if (
        imeComposing ||
        ev.isComposing ||
        Date.now() < imeSuppressInputUntil ||
        ev.inputType === "insertCompositionText" ||
        ev.inputType === "deleteCompositionText" ||
        ev.inputType === "insertFromComposition"
      ) {
        return false;
      }
      return originalInputEvent(ev);
    };
  }

  textarea.addEventListener("compositionstart", () => {
    imeComposing = true;
    imeCompositionBaseline = textarea.value.length;
    imeSuppressInputUntil = 0;
  });

  textarea.addEventListener("compositionend", (event: CompositionEvent) => {
    const dataFromEvent = event.data ?? "";
    const baseline = imeCompositionBaseline;
    imeComposing = false;
    // 抑制窗口内丢弃 xterm 残留 onData（拼音/重复汉字）
    imeSuppressInputUntil = Date.now() + 320;

    window.setTimeout(() => {
      let text = dataFromEvent;
      if (!text) {
        text = textarea.value.slice(baseline);
      }
      if (!text && textarea.value) {
        text = textarea.value;
      }
      commitImeText(sessionId, text);
      try {
        textarea.value = "";
      } catch {
        // ignore
      }
    }, 0);
  });
}

/**
 * 将缓冲输出刷入终端。
 *
 * @param sessionId - 会话 ID
 * @returns {void}
 */
function flushBufferedOutput(sessionId: string): void {
  const pending = pendingOutput.get(sessionId);
  if (!pending) {
    return;
  }
  pendingOutput.delete(sessionId);
  const pair = terminals.get(sessionId);
  if (pair?.opened) {
    if (imeComposing) {
      pendingOutput.set(sessionId, pending);
      return;
    }
    pair.term.write(pending);
  }
}

/**
 * 打开终端内识别到的 http(s) 链接（需按住 Ctrl / ⌘）。
 *
 * @param event - 鼠标事件
 * @param uri - 链接地址
 * @returns {void}
 */
function openTerminalLink(event: MouseEvent, uri: string): void {
  if (!(event.ctrlKey || event.metaKey)) {
    return;
  }
  void api.openExternal(uri).then((result) => {
    if (!result.ok) {
      console.error("[EZShell] 打开链接失败", result.message);
    }
  });
}

/**
 * 写入系统剪贴板并给出轻提示。
 *
 * @param text - 文本
 * @returns Promise
 */
async function copyText(text: string): Promise<void> {
  const value = text.trimEnd();
  if (!value) {
    return;
  }
  try {
    await api.writeClipboard(value);
    copyHint.value = "已复制到剪贴板";
    if (copyHintTimer) {
      clearTimeout(copyHintTimer);
    }
    copyHintTimer = setTimeout(() => {
      copyHint.value = "";
    }, 1600);
  } catch (error) {
    console.error("[EZShell] 复制失败", error);
  }
}

/**
 * 从本机剪贴板粘贴纯文本到指定会话（不处理图片）。
 *
 * @param sessionId - 会话 ID
 * @returns Promise
 */
async function pasteText(sessionId: string): Promise<void> {
  try {
    const text = await api.readClipboard();
    if (!text) {
      return;
    }
    api.writeSsh(sessionId, text);
  } catch (error) {
    console.error("[EZShell] 粘贴失败", error);
  }
}

/**
 * 为终端绑定复制粘贴快捷键。
 * IME（keyCode 229）时返回 false，跳过 xterm 有缺陷的 textarea-diff 路径。
 *
 * @param sessionId - 会话 ID
 * @param term - xterm 实例
 * @param hostEl - 终端宿主元素
 * @returns {void}
 */
function bindClipboard(
  sessionId: string,
  term: Terminal,
  hostEl: HTMLElement,
): void {
  patchImeInput(sessionId, term, hostEl);

  term.attachCustomKeyEventHandler((event) => {
    if (event.type !== "keydown") {
      return true;
    }
    if (isImeKeyEvent(event)) {
      return false;
    }

    const key = event.key.toLowerCase();
    const withMod = event.ctrlKey || event.metaKey;

    if (
      (withMod && event.shiftKey && key === "c") ||
      (event.ctrlKey && event.key === "Insert")
    ) {
      const selection = term.getSelection();
      if (selection) {
        void copyText(selection);
      }
      return false;
    }

    if (
      (withMod && event.shiftKey && key === "v") ||
      (event.shiftKey && event.key === "Insert")
    ) {
      void pasteText(sessionId);
      return false;
    }

    if (event.metaKey && !event.ctrlKey && key === "c") {
      const selection = term.getSelection();
      if (selection) {
        void copyText(selection);
        return false;
      }
    }

    return true;
  });

  hostEl.addEventListener("mouseup", (event) => {
    if (!shouldRenderOutput() || imeComposing || !event.shiftKey) {
      return;
    }
    const selection = term.getSelection();
    if (selection && selection.length > 0) {
      void copyText(selection);
    }
  });

  hostEl.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    if (!shouldRenderOutput() || imeComposing) {
      return;
    }
    const selection = term.getSelection();
    if (selection) {
      void copyText(selection);
      return;
    }
    void pasteText(sessionId);
  });
}

/**
 * 确保会话终端实例存在并已挂载到对应容器。
 *
 * @param sessionId - 会话 ID
 * @returns 终端对；容器未就绪时返回 null
 */
function ensureTerminal(
  sessionId: string,
): { term: Terminal; fit: FitAddon } | null {
  const el = containerRefs.value[sessionId];
  if (!el) {
    return null;
  }

  let pair = terminals.get(sessionId);
  if (!pair) {
    const term = new Terminal({
      cursorBlink: true,
      convertEol: true,
      rightClickSelectsWord: true,
      scrollback: 5000,
      // OpenCode 等 TUI 开启鼠标协议时，按住 Shift 拖选仍可选中
      fontFamily:
        'Consolas, "Cascadia Mono", "Sarasa Mono SC", "Courier New", monospace',
      fontSize: 14,
      lineHeight: 1.2,
      theme: {
        background: "#1c2138",
        foreground: "#eef0f7",
        cursor: "#2dd4bf",
        selectionBackground: "rgba(45, 212, 191, 0.28)",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon(openTerminalLink));
    term.onData((data) => {
      if (!shouldForwardTerminalInput(sessionId, data)) {
        return;
      }
      api.writeSsh(sessionId, data);
    });
    term.buffer.onBufferChange(() => {
      // 退出备用屏后恢复本地选区/滚轮；进入备用屏则交还给远端 TUI
      if (!isAlternateScreen(term)) {
        disableLocalMouse(sessionId);
      }
    });
    pair = { term, fit, opened: false };
    terminals.set(sessionId, pair);
  }

  if (!pair.opened) {
    pair.term.open(el);
    pair.opened = true;
    bindClipboard(sessionId, pair.term, el);
    const session = props.sessions.find((item) => item.id === sessionId);
    if (
      session?.status === "connecting" &&
      !connectingAnnounced.has(sessionId)
    ) {
      connectingAnnounced.add(sessionId);
      pair.term.writeln("\x1b[36m● 正在连接远端主机…\x1b[0m");
    }
  }

  if (sessionId === props.activeSessionId) {
    fitSession(sessionId);
    if (paneMode.value === "terminal" && props.visible !== false) {
      pair.term.focus();
    }
  }
  return pair;
}

/**
 * 同步所有会话挂载与活动会话聚焦。
 *
 * @returns Promise
 */
async function syncTerminals(): Promise<void> {
  await nextTick();
  for (const session of props.sessions) {
    ensureTerminal(session.id);
  }
  scheduleFit();
  if (
    props.activeSessionId &&
    paneMode.value === "terminal" &&
    props.visible !== false
  ) {
    terminals.get(props.activeSessionId)?.term.focus();
  }
}

/**
 * 当前活动会话是否已连接。
 *
 * @returns 是否已连接
 */
function isActiveConnected(): boolean {
  const session = props.sessions.find((item) => item.id === props.activeSessionId);
  return session?.status === "connected";
}

/**
 * 将连接状态转为中文标题。
 *
 * @param status - 会话状态
 * @returns 展示文案
 */
function statusLabel(status: string): string {
  switch (status) {
    case "connecting":
    case "idle":
      return "正在连接";
    case "failed":
      return "连接失败";
    case "disconnected":
      return "已断开";
    case "connected":
      return "已连接";
    default:
      return "会话状态";
  }
}

watch(
  () => activeSession.value?.status,
  (status, previous) => {
    if (
      status === "connecting" &&
      (previous === "failed" || previous === "disconnected") &&
      props.activeSessionId
    ) {
      const pair = terminals.get(props.activeSessionId);
      if (pair?.opened) {
        try {
          pair.term.reset();
        } catch {
          // ignore
        }
        pair.term.writeln("\x1b[36m● 正在重新连接…\x1b[0m");
        connectingAnnounced.add(props.activeSessionId);
      }
    }
    if (status === "connected" && props.activeSessionId) {
      disableLocalMouse(props.activeSessionId);
      void nextTick(() => {
        scheduleFit();
        setTimeout(() => scheduleFit(), 50);
        setTimeout(() => scheduleFit(), 200);
      });
    }
  },
);

watch(
  () =>
    props.sessions.map((item) => `${item.id}:${item.status}`).join("|"),
  () => {
    for (const session of props.sessions) {
      if (session.status === "connecting") {
        if (connectingAnnounced.has(session.id)) {
          continue;
        }
        connectingAnnounced.add(session.id);
        const pair = terminals.get(session.id);
        if (pair?.opened) {
          pair.term.writeln("\x1b[36m● 正在连接远端主机…\x1b[0m");
        }
      } else {
        connectingAnnounced.delete(session.id);
      }
    }
  },
);

watch(
  () => [props.activeSessionId, props.sessions.map((item) => item.id).join(",")],
  () => {
    const alive = new Set(props.sessions.map((item) => item.id));
    for (const [id, pair] of terminals) {
      if (!alive.has(id)) {
        pair.term.dispose();
        terminals.delete(id);
        pendingOutput.delete(id);
        connectingAnnounced.delete(id);
        delete containerRefs.value[id];
      }
    }
    void syncTerminals();
  },
);

watch(
  () => props.activeSessionId,
  () => {
    paneMode.value = "terminal";
  },
);

watch(paneMode, (mode) => {
  if (mode === "terminal" && props.visible !== false) {
    for (const session of props.sessions) {
      flushBufferedOutput(session.id);
    }
    void syncTerminals();
  }
});

watch(
  () => props.visible,
  (visible) => {
    if (visible === false) {
      setMouseGuard(false);
      for (const [, pair] of terminals) {
        try {
          pair.term.clearSelection();
          pair.term.blur();
        } catch {
          // ignore
        }
      }
      return;
    }
    for (const session of props.sessions) {
      flushBufferedOutput(session.id);
      if (session.status === "connected") {
        disableLocalMouse(session.id);
      }
    }
    setMouseGuard(true);
    void syncTerminals();
  },
);

onMounted(() => {
  removeData = api.onSshData(({ sessionId, data }) => {
    const safeData = filterIncomingData(sessionId, data);
    if (!safeData) {
      return;
    }
    if (!shouldRenderOutput()) {
      bufferOutput(sessionId, safeData);
      return;
    }
    flushBufferedOutput(sessionId);
    const pair = terminals.get(sessionId);
    if (pair?.opened) {
      pair.term.write(safeData);
      return;
    }
    void syncTerminals().then(() => {
      terminals.get(sessionId)?.term.write(safeData);
    });
  });

  window.addEventListener("resize", scheduleFit);
  void syncTerminals();
  if (props.visible !== false) {
    setMouseGuard(true);
  }

  if (stackRef.value && typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(() => {
      if (props.visible === false) {
        return;
      }
      scheduleFit();
    });
    resizeObserver.observe(stackRef.value);
  }
});

onBeforeUnmount(() => {
  removeData?.();
  window.removeEventListener("resize", scheduleFit);
  resizeObserver?.disconnect();
  setMouseGuard(false);
  if (fitTimer) {
    clearTimeout(fitTimer);
  }
  if (copyHintTimer) {
    clearTimeout(copyHintTimer);
  }
  pendingOutput.clear();
  for (const [, pair] of terminals) {
    pair.term.dispose();
  }
  terminals.clear();
});
</script>

<template>
  <div
    ref="workspaceRef"
    class="workspace"
    :class="{ 'no-tabs': hideTabs }"
  >
    <div v-if="!hideTabs" class="tabs">
      <button
        v-for="session in sessions"
        :key="session.id"
        type="button"
        class="tab"
        :class="{ active: session.id === activeSessionId }"
        @click="emit('update:activeSessionId', session.id)"
      >
        <span class="dot" :data-status="session.status" />
        <span class="title">{{ session.title }}</span>
        <span class="close" title="关闭" @click.stop="emit('close', session.id)">×</span>
      </button>
      <span v-if="sessions.length === 0" class="hint">会话区（多标签终端）</span>
    </div>

    <div
      v-if="activeSessionId && activeSession && activeSession.status !== 'connected'"
      class="banner"
      :data-status="activeSession.status"
    >
      <span>{{ activeSession.message || statusLabel(activeSession.status) }}</span>
      <NButton
        v-if="activeSession.authFailed"
        size="tiny"
        type="primary"
        ghost
        @click="emit('reconnectPassword', activeSessionId!)"
      >
        输入密码并重连
      </NButton>
      <NButton
        v-else-if="canReconnect"
        size="tiny"
        type="primary"
        ghost
        @click="emit('reconnect', activeSessionId!)"
      >
        重新连接
      </NButton>
    </div>

    <div v-if="activeSessionId" class="subtabs">
      <button
        type="button"
        :class="{ active: paneMode === 'terminal' }"
        @click="paneMode = 'terminal'"
      >
        终端
      </button>
      <button
        type="button"
        :class="{ active: paneMode === 'sftp' }"
        @click="paneMode = 'sftp'"
      >
        SFTP
      </button>
      <span v-if="paneMode === 'terminal'" class="copy-tip">
        链接：Ctrl+单击 · 粘贴：Ctrl+Shift+V / 右键 · 复制：Ctrl+Shift+C · TUI 内按住 Shift 可选中
      </span>
      <span v-if="copyHint" class="copy-toast">{{ copyHint }}</span>
    </div>

    <div ref="stackRef" class="term-stack">
      <div v-if="sessions.length === 0" class="placeholder">
        连接主机后，终端会话将显示在此处。快捷键：Ctrl+W 关闭当前会话。
      </div>
      <div v-show="paneMode === 'terminal'" class="term-layer">
        <div
          v-for="session in sessions"
          :key="session.id"
          class="term-pane"
          :class="{ active: session.id === activeSessionId }"
          :ref="(el) => setContainerRef(session.id, el)"
        />
      </div>
      <SftpPanel
        v-if="paneMode === 'sftp' && activeSessionId"
        :session-id="activeSessionId"
        :connected="isActiveConnected()"
      />

      <div
        v-if="paneMode === 'terminal' && activeSession && showStatusOverlay"
        class="status-overlay"
        :data-status="activeSession.status"
      >
        <NSpin v-if="showConnectingOverlay" size="large" />
        <p class="status-title">
          {{ statusLabel(activeSession.status) }}
        </p>
        <p class="status-desc">
          {{ activeSession.message || "请稍候…" }}
        </p>
        <NButton
          v-if="activeSession.authFailed"
          type="primary"
          @click="emit('reconnectPassword', activeSessionId!)"
        >
          输入密码并重连
        </NButton>
        <NButton
          v-else-if="canReconnect"
          type="primary"
          @click="emit('reconnect', activeSessionId!)"
        >
          重新连接
        </NButton>
      </div>
    </div>
  </div>
</template>

<style scoped>
.workspace {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  background: var(--ez-terminal-bg);
}

.tabs {
  flex: 0 0 auto;
  display: flex;
  gap: 4px;
  padding: 6px 8px;
  overflow-x: auto;
  border-bottom: 1px solid var(--ez-color-border);
}

.tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--ez-color-border);
  background: var(--ez-color-bg-elevated);
  color: var(--ez-color-text);
  border-radius: 8px;
  padding: 4px 8px;
  cursor: pointer;
}

.tab.active {
  border-color: var(--ez-color-primary);
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

.title {
  font-size: 12px;
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.close {
  opacity: 0.7;
}

.hint,
.placeholder {
  color: var(--ez-color-text-muted);
  font-size: 13px;
  padding: 8px;
}

.banner {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  padding: 8px 14px;
  font-size: 13px;
  background: rgba(251, 191, 36, 0.12);
  color: #fde68a;
  border-bottom: 1px solid var(--ez-color-border);
}

.banner[data-status="failed"] {
  background: rgba(248, 113, 113, 0.14);
  color: #fecaca;
}

.banner[data-status="disconnected"] {
  background: rgba(154, 163, 189, 0.1);
  color: var(--ez-color-text-muted);
}

.banner[data-status="connecting"],
.banner[data-status="idle"] {
  background: rgba(45, 212, 191, 0.12);
  color: var(--ez-color-primary);
}

.subtabs {
  flex: 0 0 auto;
  display: flex;
  gap: 4px;
  align-items: center;
  padding: 6px 10px;
  border-bottom: 1px solid var(--ez-color-border);
  background: var(--ez-color-bg-deep);
}

.subtabs button {
  border: none;
  background: transparent;
  color: var(--ez-color-text-muted);
  padding: 6px 12px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
}

.subtabs button.active {
  background: var(--ez-color-primary-muted);
  color: var(--ez-color-primary);
}

.copy-tip {
  margin-left: 8px;
  font-size: 11px;
  color: var(--ez-color-text-muted);
  opacity: 0.85;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  flex: 1 1 auto;
}

.copy-toast {
  margin-left: auto;
  flex: 0 0 auto;
  font-size: 12px;
  color: var(--ez-color-primary);
  font-weight: 600;
}

.term-stack {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}

.term-layer {
  position: absolute;
  inset: 0;
}

.term-pane {
  position: absolute;
  inset: 0;
  padding: 4px 8px;
  visibility: hidden;
  pointer-events: none;
}

.term-pane.active {
  visibility: visible;
  pointer-events: auto;
}

.term-pane :deep(.xterm) {
  height: 100%;
  width: 100%;
  padding: 0;
}

.term-pane :deep(.xterm .xterm-link) {
  text-decoration: underline;
  text-underline-offset: 2px;
  color: var(--ez-color-primary);
  cursor: pointer;
}

.term-pane :deep(.xterm-viewport) {
  overflow-y: auto !important;
}

.term-pane :deep(.xterm-screen) {
  height: 100%;
}

.placeholder {
  height: 100%;
  display: grid;
  place-items: center;
}

.status-overlay {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 12px;
  background: rgba(28, 33, 56, 0.88);
  backdrop-filter: blur(2px);
  pointer-events: auto;
}

.status-overlay[data-status="failed"] {
  background: rgba(40, 20, 28, 0.9);
}

.status-title {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  color: var(--ez-color-text);
}

.status-desc {
  margin: 0;
  max-width: 420px;
  text-align: center;
  color: var(--ez-color-text-muted);
  font-size: 13px;
  line-height: 1.5;
}

.status-overlay[data-status="connecting"] .status-title,
.status-overlay[data-status="idle"] .status-title {
  color: var(--ez-color-primary);
}

@media (max-width: 900px) {
  .copy-tip {
    display: none;
  }

  .subtabs {
    flex-wrap: wrap;
  }

  .status-desc {
    max-width: min(420px, 90vw);
    padding: 0 12px;
  }
}

@media (max-width: 640px) {
  .term-pane {
    padding: 2px 4px;
  }

  .banner {
    padding: 8px 10px;
    font-size: 12px;
  }
}
</style>
