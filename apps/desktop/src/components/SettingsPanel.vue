<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import {
  NAlert,
  NButton,
  NCard,
  NCheckbox,
  NFormItem,
  NInput,
  NScrollbar,
  NSelect,
  NSpace,
  NText,
  useDialog,
  useMessage,
} from "naive-ui";
import { brandName } from "@ezshell/ui-tokens";
import { requireDesktopApi } from "../lib/bridge";

const emit = defineEmits<{
  imported: [];
}>();

const api = requireDesktopApi();
const dialog = useDialog();
const messageApi = useMessage();
const version = ref("0.3.0");
const encryptExport = ref(false);
const includeSecrets = ref(false);
const exportPassword = ref("");
const importPassword = ref("");
const importMode = ref<"merge" | "replace">("merge");

const importModeOptions = [
  { label: "合并（跳过同目标主机）", value: "merge" },
  { label: "覆盖", value: "replace" },
];

/**
 * 读取应用版本。
 *
 * @returns Promise
 */
async function loadVersion(): Promise<void> {
  try {
    version.value = await api.getAppVersion();
  } catch {
    version.value = "0.3.0";
  }
}

/**
 * 导出备份。
 *
 * @returns Promise
 */
async function doExport(): Promise<void> {
  if (encryptExport.value && !exportPassword.value) {
    messageApi.warning("加密导出请填写口令");
    return;
  }
  const result = await api.exportBackup({
    encrypted: encryptExport.value,
    password: exportPassword.value || undefined,
    includeSecrets: includeSecrets.value,
  });
  if (result.ok) {
    messageApi.success(`已导出：${result.filePath}`);
  } else {
    messageApi.error(result.message ?? "导出失败");
  }
}

/**
 * 导入备份。
 *
 * @returns Promise
 */
async function doImportBackup(): Promise<void> {
  const run = async (): Promise<void> => {
    const result = await api.importBackup({
      password: importPassword.value || undefined,
      mode: importMode.value,
    });
    if (result.ok) {
      messageApi.success(result.message ?? "导入完成");
      emit("imported");
    } else {
      messageApi.error(result.message ?? "导入失败");
    }
  };

  if (importMode.value === "replace") {
    dialog.warning({
      title: "覆盖导入",
      content: "覆盖导入将替换现有主机/分组/片段/转发，确定继续？",
      positiveText: "继续覆盖",
      negativeText: "取消",
      onPositiveClick: () => {
        void run();
      },
    });
    return;
  }
  await run();
}

/**
 * 导入 OpenSSH config。
 *
 * @returns Promise
 */
async function doImportOpenSsh(): Promise<void> {
  const result = await api.importOpenSsh();
  if (result.ok) {
    messageApi.success(result.message ?? "导入完成");
    emit("imported");
  } else {
    messageApi.error(result.message ?? "导入失败");
  }
}

/**
 * 导入 MobaXterm 会话。
 *
 * @returns Promise
 */
async function doImportMoba(): Promise<void> {
  const result = await api.importMoba();
  if (result.ok) {
    messageApi.success(result.message ?? "导入完成");
    emit("imported");
  } else {
    messageApi.error(result.message ?? "导入失败");
  }
}

const aboutLines = computed(() => [
  `产品名：${brandName}`,
  "支持：Windows / macOS / Linux",
  `版本：${version.value}`,
]);

onMounted(() => {
  void loadVersion();
});
</script>

<template>
  <div class="panel">
    <NScrollbar class="scroll" trigger="none">
      <div class="inner">
        <header class="page-head">
          <h2>导入导出</h2>
          <NText depth="3">
            集中管理配置迁移。导入失败不会破坏已有数据（覆盖模式除外，需二次确认）。
          </NText>
        </header>

        <NSpace vertical :size="16">
          <NCard title="EZShell 备份" size="small" :bordered="true">
            <NSpace vertical :size="12">
              <NCheckbox v-model:checked="encryptExport">
                导出为加密 `.ezb`
              </NCheckbox>
              <NFormItem v-if="encryptExport" label="导出口令" :show-feedback="false">
                <NInput
                  v-model:value="exportPassword"
                  type="password"
                  show-password-on="click"
                  placeholder="请输入加密口令"
                />
              </NFormItem>
              <NCheckbox v-model:checked="includeSecrets">
                包含已保存密码与私钥（请妥善保管文件）
              </NCheckbox>
              <NButton type="primary" @click="doExport">导出备份</NButton>

              <NAlert type="info" :bordered="false" title="导入">
                选择合并或覆盖模式后，通过系统对话框选择备份文件。
              </NAlert>
              <NFormItem label="导入模式" :show-feedback="false">
                <NSelect v-model:value="importMode" :options="importModeOptions" />
              </NFormItem>
              <NFormItem label="加密备份口令（明文可留空）" :show-feedback="false">
                <NInput
                  v-model:value="importPassword"
                  type="password"
                  show-password-on="click"
                  placeholder="可选"
                />
              </NFormItem>
              <NButton secondary @click="doImportBackup">导入备份</NButton>
            </NSpace>
          </NCard>

          <NCard title="第三方迁移" size="small" :bordered="true">
            <NSpace vertical :size="12">
              <NSpace>
                <NButton secondary @click="doImportOpenSsh">导入 OpenSSH Config</NButton>
                <NButton type="primary" @click="doImportMoba">导入 MobaXterm</NButton>
              </NSpace>
              <NText depth="3">
                Moba 仅导入 `#109#` SSH 会话；原密码无法还原，请导入后自行补全。
              </NText>
            </NSpace>
          </NCard>

          <NCard title="关于" size="small" :bordered="true">
            <NSpace vertical :size="6">
              <NText v-for="line in aboutLines" :key="line">{{ line }}</NText>
            </NSpace>
          </NCard>
        </NSpace>
      </div>
    </NScrollbar>
  </div>
</template>

<style scoped>
.panel {
  height: 100%;
  background: var(--ez-color-bg);
}

.scroll {
  height: 100%;
}

.inner {
  max-width: min(720px, 100%);
  padding: 20px 28px 40px;
  width: 100%;
  box-sizing: border-box;
}

.page-head {
  display: grid;
  gap: 6px;
  margin-bottom: 16px;
}

.page-head h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
}

/* 让滚动条贴在主内容区右边缘，而不是贴在 max-width 内容盒上 */
.panel :deep(.n-scrollbar) {
  height: 100%;
}

.panel :deep(.n-scrollbar-rail--vertical) {
  right: 2px;
}

@media (max-width: 800px) {
  .inner {
    padding: 14px 14px 28px;
  }

  .page-head h2 {
    font-size: 18px;
  }
}
</style>
