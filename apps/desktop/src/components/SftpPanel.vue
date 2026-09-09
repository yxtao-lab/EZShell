<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import type { SftpEntry } from "../types/ezshell";
import { requireDesktopApi } from "../lib/bridge";

const props = defineProps<{
  sessionId: string | null;
  connected: boolean;
}>();

const api = requireDesktopApi();
const cwd = ref("/");
const entries = ref<SftpEntry[]>([]);
const message = ref("");
const loading = ref(false);

/**
 * 刷新当前目录列表。
 *
 * @param remotePath - 可选目标路径
 * @returns Promise
 */
async function refresh(remotePath?: string): Promise<void> {
  if (!props.sessionId) {
    message.value = "没有活动会话";
    return;
  }
  if (!props.connected) {
    message.value = "会话未连接，无法使用 SFTP";
    entries.value = [];
    return;
  }
  loading.value = true;
  message.value = "";
  try {
    const result = await api.sftpList(props.sessionId, remotePath);
    if (!result.ok) {
      message.value = result.message ?? "列出目录失败";
      return;
    }
    cwd.value = result.cwd ?? "/";
    entries.value = result.entries ?? [];
  } finally {
    loading.value = false;
  }
}

/**
 * 进入上级目录。
 *
 * @returns Promise
 */
async function goUp(): Promise<void> {
  if (!props.sessionId) {
    return;
  }
  loading.value = true;
  try {
    const result = await api.sftpUp(props.sessionId);
    if (!result.ok) {
      message.value = result.message ?? "无法进入上级目录";
      return;
    }
    cwd.value = result.cwd ?? "/";
    entries.value = result.entries ?? [];
  } finally {
    loading.value = false;
  }
}

/**
 * 打开目录或忽略文件双击下载。
 *
 * @param entry - 条目
 * @returns Promise
 */
async function openEntry(entry: SftpEntry): Promise<void> {
  if (!props.sessionId) {
    return;
  }
  const next = cwd.value === "/" ? `/${entry.name}` : `${cwd.value}/${entry.name}`;
  if (entry.isDirectory) {
    await refresh(next);
    return;
  }
  const result = await api.sftpDownload(props.sessionId, next);
  message.value = result.ok ? "下载完成" : result.message ?? "下载失败";
}

/**
 * 上传文件到当前目录。
 *
 * @returns Promise
 */
async function upload(): Promise<void> {
  if (!props.sessionId) {
    return;
  }
  const result = await api.sftpUpload(props.sessionId, cwd.value);
  message.value = result.message ?? (result.ok ? "上传完成" : "上传失败");
  if (result.ok) {
    await refresh(cwd.value);
  }
}

/**
 * 重命名选中项。
 *
 * @param entry - 条目
 * @returns Promise
 */
async function rename(entry: SftpEntry): Promise<void> {
  if (!props.sessionId) {
    return;
  }
  const nextName = window.prompt("新名称", entry.name);
  if (!nextName?.trim() || nextName.trim() === entry.name) {
    return;
  }
  const from =
    cwd.value === "/" ? `/${entry.name}` : `${cwd.value}/${entry.name}`;
  const to =
    cwd.value === "/" ? `/${nextName.trim()}` : `${cwd.value}/${nextName.trim()}`;
  const result = await api.sftpRename(props.sessionId, from, to);
  message.value = result.ok ? "已重命名" : result.message ?? "重命名失败";
  if (result.ok) {
    await refresh(cwd.value);
  }
}

/**
 * 删除选中项。
 *
 * @param entry - 条目
 * @returns Promise
 */
async function remove(entry: SftpEntry): Promise<void> {
  if (!props.sessionId) {
    return;
  }
  if (!window.confirm(`确定删除「${entry.name}」？`)) {
    return;
  }
  const remote =
    cwd.value === "/" ? `/${entry.name}` : `${cwd.value}/${entry.name}`;
  const result = await api.sftpDelete(props.sessionId, remote, entry.isDirectory);
  message.value = result.ok ? "已删除" : result.message ?? "删除失败";
  if (result.ok) {
    await refresh(cwd.value);
  }
}

/**
 * 格式化文件大小。
 *
 * @param size - 字节数
 * @returns 可读字符串
 */
function formatSize(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

watch(
  () => [props.sessionId, props.connected],
  () => {
    void refresh();
  },
);

onMounted(() => {
  void refresh();
});
</script>

<template>
  <div class="sftp">
    <div class="toolbar">
      <button type="button" class="ghost" :disabled="!connected" @click="goUp">上级</button>
      <button type="button" class="ghost" :disabled="!connected" @click="refresh(cwd)">刷新</button>
      <button type="button" class="primary" :disabled="!connected" @click="upload">上传</button>
      <code class="path">{{ cwd }}</code>
    </div>
    <p v-if="message" class="msg">{{ message }}</p>
    <p v-if="!connected" class="msg warn">请先连接 SSH 会话后再使用 SFTP。</p>
    <div v-else-if="loading" class="msg">加载中…</div>
    <table v-else>
      <thead>
        <tr>
          <th>名称</th>
          <th>大小</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="entry in entries" :key="entry.name">
          <td>
            <button type="button" class="link" @dblclick="openEntry(entry)">
              {{ entry.isDirectory ? "📁" : "📄" }}
              {{ entry.name }}
            </button>
          </td>
          <td>{{ entry.isDirectory ? "—" : formatSize(entry.size) }}</td>
          <td class="ops">
            <button
              v-if="!entry.isDirectory"
              type="button"
              class="ghost"
              @click="openEntry(entry)"
            >
              下载
            </button>
            <button type="button" class="ghost" @click="rename(entry)">重命名</button>
            <button type="button" class="danger" @click="remove(entry)">删除</button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.sftp {
  height: 100%;
  display: grid;
  grid-template-rows: auto auto 1fr;
  min-height: 0;
  background: var(--ez-color-bg);
  padding: 10px 12px;
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
}

.path {
  flex: 1;
  min-width: 120px;
  padding: 6px 10px;
  border-radius: 8px;
  background: var(--ez-color-bg-elevated);
  color: var(--ez-color-text-muted);
  font-size: 12px;
}

.msg {
  margin: 0 0 8px;
  font-size: 12px;
  color: var(--ez-color-text-muted);
}

.msg.warn {
  color: var(--ez-color-warning);
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  overflow: auto;
}

th,
td {
  text-align: left;
  padding: 8px 10px;
  border-bottom: 1px solid var(--ez-color-border);
}

.ops {
  display: flex;
  gap: 6px;
}

button.primary,
button.ghost,
button.danger,
button.link {
  border: 1px solid var(--ez-color-border);
  background: var(--ez-color-bg-elevated);
  color: var(--ez-color-text);
  border-radius: 8px;
  padding: 6px 10px;
  cursor: pointer;
}

button.primary {
  border-color: var(--ez-color-primary);
  background: var(--ez-color-primary-muted);
  color: var(--ez-color-primary);
}

button.danger {
  color: var(--ez-color-danger);
}

button.link {
  border: none;
  background: transparent;
  padding: 0;
  text-align: left;
}

button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

@media (max-width: 800px) {
  .sftp {
    padding: 8px;
  }

  .path {
    flex: 1 1 100%;
    order: 10;
  }

  th:nth-child(2),
  td:nth-child(2) {
    display: none;
  }

  .ops {
    flex-wrap: wrap;
  }
}

@media (max-width: 640px) {
  table,
  thead,
  tbody,
  th,
  td,
  tr {
    display: block;
  }

  thead {
    display: none;
  }

  tr {
    padding: 10px 0;
    border-bottom: 1px solid var(--ez-color-border);
  }

  td {
    border-bottom: none;
    padding: 4px 0;
  }

  td:first-child {
    font-weight: 600;
  }
}
</style>
