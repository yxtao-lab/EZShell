<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref } from "vue";
import type { ForwardRule, HostRecord } from "@ezshell/shared";
import { requireDesktopApi } from "../lib/bridge";

const props = defineProps<{
  hosts: HostRecord[];
}>();

const api = requireDesktopApi();
const forwards = ref<ForwardRule[]>([]);
const running = ref<Set<string>>(new Set());
const showForm = ref(false);
const editingId = ref<string | null>(null);
const formError = ref("");
const toast = ref("");
let offStatus: (() => void) | null = null;

const form = reactive({
  name: "",
  hostId: "",
  type: "local" as "local" | "remote",
  bindPort: 18080,
  targetHost: "127.0.0.1",
  targetPort: 80,
});

/**
 * 刷新规则与运行状态。
 *
 * @returns Promise
 */
async function refresh(): Promise<void> {
  forwards.value = await api.listForwards();
  running.value = new Set(await api.listRunningForwards());
}

/**
 * 打开新建表单。
 *
 * @returns {void}
 */
function openCreate(): void {
  editingId.value = null;
  form.name = "";
  form.hostId = props.hosts[0]?.id ?? "";
  form.type = "local";
  form.bindPort = 18080;
  form.targetHost = "127.0.0.1";
  form.targetPort = 80;
  formError.value = "";
  showForm.value = true;
}

/**
 * 打开编辑表单。
 *
 * @param rule - 规则
 * @returns {void}
 */
function openEdit(rule: ForwardRule): void {
  editingId.value = rule.id;
  form.name = rule.name;
  form.hostId = rule.hostId;
  form.type = rule.type === "remote" ? "remote" : "local";
  form.bindPort = rule.bindPort;
  form.targetHost = rule.targetHost;
  form.targetPort = rule.targetPort;
  formError.value = "";
  showForm.value = true;
}

/**
 * 保存规则。
 *
 * @returns Promise
 */
async function save(): Promise<void> {
  formError.value = "";
  const result = await api.upsertForward({
    id: editingId.value ?? undefined,
    name: form.name,
    hostId: form.hostId,
    type: form.type,
    bindPort: Number(form.bindPort),
    targetHost: form.targetHost,
    targetPort: Number(form.targetPort),
  });
  if (!result.ok) {
    formError.value = result.message;
    return;
  }
  showForm.value = false;
  await refresh();
}

/**
 * 删除规则。
 *
 * @param rule - 规则
 * @returns Promise
 */
async function remove(rule: ForwardRule): Promise<void> {
  if (!window.confirm(`确定删除转发「${rule.name}」？`)) {
    return;
  }
  await api.deleteForward(rule.id);
  await refresh();
}

/**
 * 启动或停止转发。
 *
 * @param rule - 规则
 * @returns Promise
 */
async function toggle(rule: ForwardRule): Promise<void> {
  if (running.value.has(rule.id)) {
    await api.stopForward(rule.id);
    toast.value = "已停止";
    await refresh();
    return;
  }
  const result = await api.startForward(rule.id);
  toast.value = result.ok ? "转发已启动" : result.message ?? "启动失败";
  await refresh();
}

/**
 * 主机显示名。
 *
 * @param hostId - 主机 ID
 * @returns 名称
 */
function hostLabel(hostId: string): string {
  const host = props.hosts.find((item) => item.id === hostId);
  return host ? host.name : hostId;
}

onMounted(() => {
  void refresh();
  offStatus = api.onForwardStatus((payload) => {
    const next = new Set(running.value);
    if (payload.running) {
      next.add(payload.ruleId);
    } else {
      next.delete(payload.ruleId);
    }
    running.value = next;
    toast.value = payload.message;
  });
});

onBeforeUnmount(() => {
  offStatus?.();
});
</script>

<template>
  <div class="panel">
    <div class="head">
      <h2>端口转发</h2>
      <button type="button" class="primary" @click="openCreate">+ 新建规则</button>
    </div>
    <p class="hint">Local：本机端口映射到远端目标；Remote：远端端口映射到本机目标。</p>
    <p v-if="toast" class="toast">{{ toast }}</p>

    <div v-if="forwards.length === 0" class="empty">还没有转发规则。</div>
    <div v-else class="list">
      <article v-for="rule in forwards" :key="rule.id" class="card">
        <div>
          <strong>{{ rule.name }}</strong>
          <span class="tag">{{ rule.type === "remote" ? "Remote" : "Local" }}</span>
          <p>
            主机 {{ hostLabel(rule.hostId) }} · 绑定 :{{ rule.bindPort }} →
            {{ rule.targetHost }}:{{ rule.targetPort }}
          </p>
          <small :data-on="running.has(rule.id)">
            {{ running.has(rule.id) ? "运行中" : "已停止" }}
          </small>
        </div>
        <div class="row">
          <button type="button" class="primary" @click="toggle(rule)">
            {{ running.has(rule.id) ? "停止" : "启动" }}
          </button>
          <button type="button" class="ghost" @click="openEdit(rule)">编辑</button>
          <button type="button" class="danger" @click="remove(rule)">删除</button>
        </div>
      </article>
    </div>

    <div v-if="showForm" class="drawer-mask" @click.self="showForm = false">
      <div class="drawer">
        <h3>{{ editingId ? "编辑规则" : "新建规则" }}</h3>
        <label>名称<input v-model="form.name" /></label>
        <label>
          关联主机
          <select v-model="form.hostId">
            <option value="">请选择</option>
            <option v-for="host in hosts" :key="host.id" :value="host.id">
              {{ host.name }}
            </option>
          </select>
        </label>
        <label>
          类型
          <select v-model="form.type">
            <option value="local">Local（本地转发）</option>
            <option value="remote">Remote（远程转发）</option>
          </select>
        </label>
        <label>绑定端口<input v-model.number="form.bindPort" type="number" /></label>
        <label>目标主机<input v-model="form.targetHost" /></label>
        <label>目标端口<input v-model.number="form.targetPort" type="number" /></label>
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
  margin-bottom: 8px;
}

.head h2 {
  margin: 0;
}

.hint,
.empty,
.toast {
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
  display: flex;
  justify-content: space-between;
  gap: 16px;
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

p {
  margin: 8px 0;
  color: var(--ez-color-text-muted);
  font-size: 13px;
}

small[data-on="true"] {
  color: var(--ez-color-success);
}

.row {
  display: flex;
  gap: 8px;
  align-items: flex-start;
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

input,
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

  .card {
    flex-direction: column;
    align-items: stretch;
  }

  .row {
    flex-wrap: wrap;
  }
}
</style>
