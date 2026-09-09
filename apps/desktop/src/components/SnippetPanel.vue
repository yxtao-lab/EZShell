<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import type { SnippetRecord } from "@ezshell/shared";
import { requireDesktopApi } from "../lib/bridge";

const props = defineProps<{
  activeSessionId: string | null;
  activeHostId: string | null;
}>();

const api = requireDesktopApi();
const snippets = ref<SnippetRecord[]>([]);
const categoryFilter = ref("all");
const showForm = ref(false);
const editingId = ref<string | null>(null);
const formError = ref("");
const toast = ref("");
const form = reactive({
  title: "",
  content: "",
  category: "",
  autoNewline: true,
});

const categories = computed(() => {
  const set = new Set<string>();
  for (const item of snippets.value) {
    if (item.category) {
      set.add(item.category);
    }
  }
  return [...set].sort();
});

const filtered = computed(() => {
  if (categoryFilter.value === "all") {
    return snippets.value;
  }
  if (categoryFilter.value === "none") {
    return snippets.value.filter((item) => !item.category);
  }
  return snippets.value.filter((item) => item.category === categoryFilter.value);
});

/**
 * 刷新片段列表。
 *
 * @returns Promise
 */
async function refresh(): Promise<void> {
  snippets.value = await api.listSnippets();
}

/**
 * 打开新建表单。
 *
 * @returns {void}
 */
function openCreate(): void {
  editingId.value = null;
  form.title = "";
  form.content = "";
  form.category = "";
  form.autoNewline = true;
  formError.value = "";
  showForm.value = true;
}

/**
 * 打开编辑表单。
 *
 * @param snippet - 片段
 * @returns {void}
 */
function openEdit(snippet: SnippetRecord): void {
  editingId.value = snippet.id;
  form.title = snippet.title;
  form.content = snippet.content;
  form.category = snippet.category ?? "";
  form.autoNewline = snippet.autoNewline !== false;
  formError.value = "";
  showForm.value = true;
}

/**
 * 保存片段。
 *
 * @returns Promise
 */
async function save(): Promise<void> {
  formError.value = "";
  const result = await api.upsertSnippet({
    id: editingId.value ?? undefined,
    title: form.title,
    content: form.content,
    category: form.category || null,
    autoNewline: form.autoNewline,
  });
  if (!result.ok) {
    formError.value = result.message;
    return;
  }
  showForm.value = false;
  await refresh();
}

/**
 * 删除片段。
 *
 * @param snippet - 片段
 * @returns Promise
 */
async function remove(snippet: SnippetRecord): Promise<void> {
  if (!window.confirm(`确定删除片段「${snippet.title}」？`)) {
    return;
  }
  await api.deleteSnippet(snippet.id);
  await refresh();
}

/**
 * 发送到活动终端。
 *
 * @param snippet - 片段
 * @returns Promise
 */
async function send(snippet: SnippetRecord): Promise<void> {
  if (!props.activeSessionId || !props.activeHostId) {
    toast.value = "当前没有活动终端会话";
    return;
  }
  const result = await api.sendSnippet({
    snippetId: snippet.id,
    sessionId: props.activeSessionId,
    hostId: props.activeHostId,
  });
  toast.value = result.ok ? "已发送到活动终端" : result.message ?? "发送失败";
}

onMounted(() => {
  void refresh();
});
</script>

<template>
  <div class="panel">
    <div class="head">
      <h2>命令片段</h2>
      <div class="actions">
        <select v-model="categoryFilter">
          <option value="all">全部分类</option>
          <option value="none">未分类</option>
          <option v-for="cat in categories" :key="cat" :value="cat">{{ cat }}</option>
        </select>
        <button type="button" class="primary" @click="openCreate">+ 新建片段</button>
      </div>
    </div>
    <p class="hint">
      支持变量 <code>{host}</code> <code>{user}</code> <code>{name}</code> <code>{port}</code>，发送到当前活动终端。
    </p>
    <p v-if="toast" class="toast">{{ toast }}</p>

    <div v-if="filtered.length === 0" class="empty">还没有片段，先新建一条常用命令。</div>
    <div v-else class="list">
      <article v-for="snippet in filtered" :key="snippet.id" class="card">
        <div>
          <strong>{{ snippet.title }}</strong>
          <span v-if="snippet.category" class="tag">{{ snippet.category }}</span>
          <pre>{{ snippet.content }}</pre>
        </div>
        <div class="row">
          <button type="button" class="primary" @click="send(snippet)">发送</button>
          <button type="button" class="ghost" @click="openEdit(snippet)">编辑</button>
          <button type="button" class="danger" @click="remove(snippet)">删除</button>
        </div>
      </article>
    </div>

    <div v-if="showForm" class="drawer-mask" @click.self="showForm = false">
      <div class="drawer">
        <h3>{{ editingId ? "编辑片段" : "新建片段" }}</h3>
        <label>标题<input v-model="form.title" /></label>
        <label>分类<input v-model="form.category" placeholder="可选" /></label>
        <label>内容<textarea v-model="form.content" rows="8" /></label>
        <label class="check">
          <input v-model="form.autoNewline" type="checkbox" />
          发送时自动补换行
        </label>
        <p v-if="formError" class="error">{{ formError }}</p>
        <div class="row">
          <button type="button" class="primary" @click="save">保存</button>
          <button type="button" class="ghost" @click="showForm = false">取消</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.panel {
  height: 100%;
  padding: 20px 28px;
  overflow-x: hidden;
  overflow-y: auto;
  background: var(--ez-color-bg);
}

.head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}

.head h2 {
  margin: 0;
}

.actions {
  display: flex;
  gap: 8px;
}

.hint,
.toast,
.empty {
  color: var(--ez-color-text-muted);
  font-size: 13px;
}

.toast {
  color: var(--ez-color-primary);
}

.list {
  display: grid;
  gap: 12px;
  margin-top: 14px;
}

.card {
  padding: 14px 16px;
  border-radius: var(--ez-radius-md);
  background: var(--ez-color-bg-elevated);
  border: 1px solid var(--ez-color-border);
}

.tag {
  margin-left: 8px;
  font-size: 11px;
  color: var(--ez-color-primary);
}

pre {
  margin: 8px 0 12px;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: var(--ez-font-mono);
  font-size: 12px;
  color: var(--ez-color-text-muted);
}

.row {
  display: flex;
  gap: 8px;
}

.drawer-mask {
  position: fixed;
  inset: 0;
  background: rgba(8, 10, 22, 0.45);
  display: grid;
  place-items: center;
  z-index: 40;
}

.drawer {
  width: min(480px, 92vw);
  display: grid;
  gap: 10px;
  padding: 18px;
  border-radius: 12px;
  background: var(--ez-color-bg-elevated);
  border: 1px solid var(--ez-color-border);
}

label {
  display: grid;
  gap: 4px;
  font-size: 13px;
}

label.check {
  display: flex;
  align-items: center;
  gap: 8px;
}

input,
textarea,
select {
  border: 1px solid var(--ez-color-border);
  background: var(--ez-color-bg);
  color: var(--ez-color-text);
  border-radius: 8px;
  padding: 8px 10px;
}

button.primary,
button.ghost,
button.danger {
  border: 1px solid var(--ez-color-border);
  background: var(--ez-color-bg);
  color: var(--ez-color-text);
  border-radius: 8px;
  padding: 6px 12px;
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

.error {
  color: var(--ez-color-danger);
  margin: 0;
}

@media (max-width: 800px) {
  .panel {
    padding: 14px 14px 20px;
  }

  .head {
    flex-wrap: wrap;
    gap: 8px;
  }

  .actions {
    flex-wrap: wrap;
  }

  .row {
    flex-wrap: wrap;
  }
}
</style>
