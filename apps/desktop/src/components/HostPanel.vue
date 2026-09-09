<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import type { HostGroup, HostRecord, KeyMetadata } from "@ezshell/shared";
import { filterHosts } from "@ezshell/core";
import {
  NButton,
  NEmpty,
  NForm,
  NFormItem,
  NInput,
  NInputNumber,
  NModal,
  NSelect,
  NSpace,
  NText,
  useDialog,
  useMessage,
} from "naive-ui";
import { requireDesktopApi } from "../lib/bridge";

const props = defineProps<{
  keys: KeyMetadata[];
}>();

const emit = defineEmits<{
  connect: [host: HostRecord];
  refreshed: [hosts: HostRecord[]];
}>();

const api = requireDesktopApi();
const dialog = useDialog();
const messageApi = useMessage();
const hosts = ref<HostRecord[]>([]);
const groups = ref<HostGroup[]>([]);
const keyword = ref("");
const groupFilter = ref<string | "all" | "none">("all");
const formError = ref("");
const editingId = ref<string | null>(null);
const showForm = ref(false);
const form = reactive({
  name: "",
  host: "",
  port: 22,
  username: "",
  authMethod: "password" as "password" | "privateKey",
  keyId: "" as string,
  groupId: "" as string,
  remark: "",
  tagsText: "",
});

const filtered = computed(() =>
  filterHosts(hosts.value, {
    keyword: keyword.value,
    groupId:
      groupFilter.value === "all"
        ? undefined
        : groupFilter.value === "none"
          ? null
          : groupFilter.value,
  }),
);

const groupFilterOptions = computed(() => [
  { label: "全部分组", value: "all" },
  { label: "未分组", value: "none" },
  ...groups.value.map((group) => ({ label: group.name, value: group.id })),
]);

const authOptions = [
  { label: "密码", value: "password" },
  { label: "私钥", value: "privateKey" },
];

const keyOptions = computed(() => [
  { label: "请选择", value: "" },
  ...props.keys.map((key) => ({ label: key.name, value: key.id })),
]);

const groupOptions = computed(() => [
  { label: "未分组", value: "" },
  ...groups.value.map((group) => ({ label: group.name, value: group.id })),
]);

/**
 * 从主进程刷新主机与分组。
 *
 * @returns Promise
 */
async function refresh(): Promise<void> {
  hosts.value = await api.listHosts();
  groups.value = await api.listGroups();
  emit("refreshed", hosts.value);
}

/**
 * 打开新建表单。
 *
 * @returns {void}
 */
function openCreate(): void {
  editingId.value = null;
  form.name = "";
  form.host = "";
  form.port = 22;
  form.username = "";
  form.authMethod = "password";
  form.keyId = "";
  form.groupId = "";
  form.remark = "";
  form.tagsText = "";
  formError.value = "";
  showForm.value = true;
}

/**
 * 打开编辑表单。
 *
 * @param host - 主机
 * @returns {void}
 */
function openEdit(host: HostRecord): void {
  editingId.value = host.id;
  form.name = host.name;
  form.host = host.host;
  form.port = host.port;
  form.username = host.username;
  form.authMethod = host.authMethod === "privateKey" ? "privateKey" : "password";
  form.keyId = host.keyId ?? "";
  form.groupId = host.groupId ?? "";
  form.remark = host.remark ?? "";
  form.tagsText = (host.tags ?? []).join(", ");
  formError.value = "";
  showForm.value = true;
}

/**
 * 保存主机。
 *
 * @returns Promise
 */
async function saveHost(): Promise<void> {
  formError.value = "";
  const result = await api.upsertHost({
    id: editingId.value ?? undefined,
    name: form.name,
    host: form.host,
    port: Number(form.port),
    username: form.username,
    authMethod: form.authMethod,
    keyId: form.authMethod === "privateKey" ? form.keyId || null : null,
    groupId: form.groupId || null,
    remark: form.remark,
    tags: form.tagsText
      .split(/[,，]/)
      .map((item) => item.trim())
      .filter(Boolean),
  });
  if (!result.ok) {
    formError.value = result.errors.map((item) => item.message).join("；");
    return;
  }
  showForm.value = false;
  messageApi.success(editingId.value ? "主机已更新" : "主机已创建");
  await refresh();
}

/**
 * 删除主机。
 *
 * @param host - 主机
 * @returns {void}
 */
function removeHost(host: HostRecord): void {
  dialog.warning({
    title: "删除主机",
    content: `确定删除主机「${host.name}」？`,
    positiveText: "删除",
    negativeText: "取消",
    onPositiveClick: async () => {
      await api.deleteHost(host.id);
      messageApi.success("已删除");
      await refresh();
    },
  });
}

/**
 * 快速创建分组。
 *
 * @returns Promise
 */
async function createGroup(): Promise<void> {
  const name = window.prompt("分组名称");
  if (!name?.trim()) {
    return;
  }
  const result = await api.upsertGroup({ name: name.trim() });
  if (!result.ok) {
    messageApi.error(result.message);
    return;
  }
  messageApi.success("分组已创建");
  await refresh();
}

/**
 * 尝试按搜索框内容直连。
 *
 * @returns {void}
 */
function tryQuickConnect(): void {
  if (!keyword.value.trim()) {
    return;
  }
  const matched = filtered.value[0];
  if (matched) {
    emit("connect", matched);
  }
}

onMounted(() => {
  void refresh();
});

defineExpose({ refresh, openCreate });
</script>

<template>
  <div class="panel">
    <div class="hero-search">
      <div class="search-box">
        <NInput
          v-model:value="keyword"
          clearable
          size="large"
          placeholder="查找主机，或输入 ssh user@hostname…"
          @keydown.enter="tryQuickConnect"
        >
          <template #prefix>
            <span class="hint-icon" aria-hidden="true">⌕</span>
          </template>
        </NInput>
        <NButton type="primary" size="large" @click="tryQuickConnect">连接</NButton>
      </div>
      <NSpace align="center" :wrap="true">
        <NButton type="primary" @click="openCreate">+ 新建主机</NButton>
        <NButton secondary @click="createGroup">新建分组</NButton>
        <NSelect
          v-model:value="groupFilter"
          class="group-filter"
          :options="groupFilterOptions"
          :consistent-menu-width="false"
        />
      </NSpace>
    </div>

    <div class="section-head">
      <h2>主机</h2>
      <NText depth="3">{{ filtered.length }}</NText>
    </div>

    <NEmpty
      v-if="filtered.length === 0"
      description="还没有主机。可新建，或到「设置」导入 OpenSSH / MobaXterm。"
      style="min-height: 260px"
    >
      <template #extra>
        <NButton type="primary" @click="openCreate">+ 新建主机</NButton>
      </template>
    </NEmpty>

    <div v-else class="grid">
      <article
        v-for="host in filtered"
        :key="host.id"
        class="card"
        @dblclick="emit('connect', host)"
      >
        <div class="card-icon" aria-hidden="true">⧉</div>
        <div class="card-body">
          <strong>{{ host.name }}</strong>
          <span class="addr">{{ host.host }}（{{ host.username }}）</span>
          <small>ssh · {{ host.username }} · :{{ host.port }}</small>
        </div>
        <div class="card-actions">
          <NButton type="primary" size="small" @click="emit('connect', host)">
            连接
          </NButton>
          <NButton secondary size="small" @click="openEdit(host)">编辑</NButton>
          <NButton quaternary type="error" size="small" @click="removeHost(host)">
            删除
          </NButton>
        </div>
      </article>
    </div>

    <NModal
      v-model:show="showForm"
      preset="card"
      :title="editingId ? '编辑主机' : '新建主机'"
      style="width: min(480px, 92vw)"
      :bordered="false"
      :segmented="{ content: true, footer: 'soft' }"
    >
      <NForm label-placement="top" size="medium">
        <NFormItem label="名称">
          <NInput v-model:value="form.name" placeholder="显示名称" />
        </NFormItem>
        <NFormItem label="地址">
          <NInput v-model:value="form.host" placeholder="IP 或域名" />
        </NFormItem>
        <NFormItem label="端口">
          <NInputNumber
            v-model:value="form.port"
            :min="1"
            :max="65535"
            class="full"
          />
        </NFormItem>
        <NFormItem label="用户名">
          <NInput v-model:value="form.username" />
        </NFormItem>
        <NFormItem label="认证方式">
          <NSelect v-model:value="form.authMethod" :options="authOptions" />
        </NFormItem>
        <NFormItem v-if="form.authMethod === 'privateKey'" label="绑定密钥">
          <NSelect v-model:value="form.keyId" :options="keyOptions" />
        </NFormItem>
        <NFormItem label="分组">
          <NSelect v-model:value="form.groupId" :options="groupOptions" />
        </NFormItem>
        <NFormItem label="标签（逗号分隔）">
          <NInput v-model:value="form.tagsText" placeholder="prod, db" />
        </NFormItem>
        <NFormItem label="备注">
          <NInput v-model:value="form.remark" />
        </NFormItem>
        <NText v-if="formError" type="error">{{ formError }}</NText>
      </NForm>
      <template #footer>
        <NSpace justify="end">
          <NButton secondary @click="showForm = false">取消</NButton>
          <NButton type="primary" @click="saveHost">保存</NButton>
        </NSpace>
      </template>
    </NModal>
  </div>
</template>

<style scoped>
.panel {
  height: 100%;
  padding: 20px 28px 28px;
  overflow-x: hidden;
  overflow-y: auto;
  background:
    radial-gradient(
      ellipse at top,
      var(--ez-color-primary-muted),
      transparent 48%
    ),
    var(--ez-color-bg);
}

.hero-search {
  display: grid;
  gap: 14px;
  margin-bottom: 22px;
}

.search-box {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 10px;
  align-items: center;
}

.hint-icon {
  color: var(--ez-color-text-muted);
}

.group-filter {
  width: 160px;
}

.section-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 14px;
}

.section-head h2 {
  margin: 0;
  font-size: 18px;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 12px;
}

.card {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 12px;
  padding: 14px;
  border-radius: var(--ez-radius-lg);
  background: var(--ez-color-bg-elevated);
  border: 1px solid var(--ez-color-border);
  transition: border-color 0.15s ease, transform 0.15s ease;
}

.card:hover {
  border-color: var(--ez-color-primary);
  transform: translateY(-1px);
}

.card-icon {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  background: var(--ez-color-primary-muted);
  color: var(--ez-color-primary);
  font-size: 18px;
}

.card-body {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.card-body strong {
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.addr,
.card-body small {
  color: var(--ez-color-text-muted);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-actions {
  grid-column: 1 / -1;
  display: flex;
  gap: 6px;
  opacity: 0;
  transition: opacity 0.15s ease;
}

.card:hover .card-actions {
  opacity: 1;
}

.full {
  width: 100%;
}

@media (max-width: 1100px) {
  .panel {
    padding: 16px 18px 20px;
  }

  .grid {
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  }
}

@media (max-width: 800px) {
  .panel {
    padding: 12px 12px 16px;
  }

  .search-box {
    grid-template-columns: 1fr;
  }

  .group-filter {
    width: 100%;
    min-width: 0;
  }

  .grid {
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 10px;
  }

  .card-actions {
    opacity: 1;
  }
}

@media (max-width: 640px) {
  .hero-search {
    gap: 10px;
    margin-bottom: 14px;
  }

  .section-head h2 {
    font-size: 16px;
  }

  .grid {
    grid-template-columns: 1fr;
  }

  .card {
    padding: 12px;
  }
}
</style>
