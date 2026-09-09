<script setup lang="ts">
import { onMounted, ref } from "vue";
import type { KeyMetadata } from "@ezshell/shared";
import { requireDesktopApi } from "../lib/bridge";

const emit = defineEmits<{
  changed: [keys: KeyMetadata[]];
}>();

const api = requireDesktopApi();
const keys = ref<KeyMetadata[]>([]);
const mode = ref<"list" | "generate" | "import">("list");
const name = ref("");
const privateKey = ref("");
const passphrase = ref("");
const error = ref("");
const publicKeyPreview = ref("");

/**
 * 刷新密钥列表。
 *
 * @returns Promise
 */
async function refresh(): Promise<void> {
  keys.value = await api.listKeys();
  emit("changed", keys.value);
}

/**
 * 生成 Ed25519 密钥。
 *
 * @returns Promise
 */
async function generate(): Promise<void> {
  error.value = "";
  const result = await api.generateKey(name.value.trim());
  if (!result.ok) {
    error.value = result.message;
    return;
  }
  mode.value = "list";
  name.value = "";
  await refresh();
}

/**
 * 导入私钥。
 *
 * @returns Promise
 */
async function importKey(): Promise<void> {
  error.value = "";
  const result = await api.importKey({
    name: name.value.trim(),
    privateKey: privateKey.value,
    passphrase: passphrase.value || undefined,
  });
  if (!result.ok) {
    error.value = result.message;
    return;
  }
  mode.value = "list";
  name.value = "";
  privateKey.value = "";
  passphrase.value = "";
  await refresh();
}

/**
 * 删除密钥。
 *
 * @param key - 密钥元数据
 * @returns Promise
 */
async function removeKey(key: KeyMetadata): Promise<void> {
  if (!window.confirm(`删除密钥「${key.name}」？相关主机绑定将解除。`)) {
    return;
  }
  await api.deleteKey(key.id);
  await refresh();
}

/**
 * 复制公钥。
 *
 * @param key - 密钥
 * @returns Promise
 */
async function copyPublic(key: KeyMetadata): Promise<void> {
  const text = (await api.getPublicKey(key.id)) ?? key.publicKey;
  await navigator.clipboard.writeText(text);
  publicKeyPreview.value = text;
}

onMounted(() => {
  void refresh();
});

defineExpose({ refresh, keys });
</script>

<template>
  <div class="panel">
    <div class="toolbar">
      <button type="button" class="primary" @click="mode = 'generate'">生成 Ed25519</button>
      <button type="button" @click="mode = 'import'">导入私钥</button>
    </div>

    <div v-if="mode === 'generate'" class="form">
      <h3>生成密钥</h3>
      <label>名称<input v-model="name" placeholder="例如 laptop-ed25519" /></label>
      <p v-if="error" class="error">{{ error }}</p>
      <div class="row">
        <button type="button" class="primary" @click="generate">生成</button>
        <button type="button" @click="mode = 'list'">取消</button>
      </div>
    </div>

    <div v-else-if="mode === 'import'" class="form">
      <h3>导入 OpenSSH 私钥</h3>
      <label>名称<input v-model="name" /></label>
      <label>
        私钥
        <textarea v-model="privateKey" rows="8" placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" />
      </label>
      <label>口令（若有）<input v-model="passphrase" type="password" /></label>
      <p v-if="error" class="error">{{ error }}</p>
      <div class="row">
        <button type="button" class="primary" @click="importKey">导入</button>
        <button type="button" @click="mode = 'list'">取消</button>
      </div>
    </div>

    <ul v-else class="list">
      <li v-if="keys.length === 0" class="empty">还没有密钥，可生成或导入。</li>
      <li v-for="key in keys" :key="key.id">
        <div>
          <strong>{{ key.name }}</strong>
          <div class="sub">{{ key.type.toUpperCase() }} · {{ key.fingerprint }}</div>
        </div>
        <div class="row">
          <button type="button" @click="copyPublic(key)">复制公钥</button>
          <button type="button" class="danger" @click="removeKey(key)">删除</button>
        </div>
      </li>
    </ul>

    <p v-if="publicKeyPreview" class="preview">已复制公钥：{{ publicKeyPreview }}</p>
  </div>
</template>

<style scoped>
.panel {
  display: grid;
  gap: 12px;
  height: 100%;
  padding: 20px 28px;
  overflow-x: hidden;
  overflow-y: auto;
  background: var(--ez-color-bg);
  box-sizing: border-box;
}

.toolbar,
.row {
  display: flex;
  gap: 8px;
}

button,
input,
textarea {
  border: 1px solid var(--ez-color-border);
  background: var(--ez-color-bg);
  color: var(--ez-color-text);
  border-radius: 8px;
  padding: 8px 12px;
}

button {
  cursor: pointer;
  background: var(--ez-color-surface);
}

button.primary {
  background: var(--ez-color-primary);
  border-color: transparent;
  color: var(--ez-color-primary-ink);
}

button.danger {
  color: var(--ez-color-danger);
}

.form,
.list {
  display: grid;
  gap: 10px;
}

.form label {
  display: grid;
  gap: 4px;
  font-size: 13px;
}

.list {
  list-style: none;
  margin: 0;
  padding: 0;
}

li {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--ez-color-border);
  border-radius: 10px;
  background: var(--ez-color-bg-elevated);
}

.sub,
.preview,
.empty,
.error {
  color: var(--ez-color-text-muted);
  font-size: 12px;
}

.error {
  color: var(--ez-color-danger);
}

.preview {
  word-break: break-all;
  font-family: var(--ez-font-mono);
}

@media (max-width: 800px) {
  .panel {
    padding: 14px;
  }

  .toolbar,
  .row {
    flex-wrap: wrap;
  }

  li {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
