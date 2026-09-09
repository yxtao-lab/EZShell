<script setup lang="ts">
import { NConfigProvider, NDialogProvider, NMessageProvider } from "naive-ui";
import { RouterView } from "vue-router";
import { getDesktopApi } from "./lib/bridge";
import { ezshellNaiveTheme, ezshellThemeOverrides } from "./lib/naiveTheme";

const hasBridge = Boolean(getDesktopApi());
</script>

<template>
  <NConfigProvider
    :theme="ezshellNaiveTheme"
    :theme-overrides="ezshellThemeOverrides"
    abstract
  >
    <NDialogProvider>
      <NMessageProvider>
        <div v-if="!hasBridge" class="boot-error">
          <h1>EZShell</h1>
          <p>未检测到桌面桥接。请在项目根目录执行：</p>
          <code>pnpm dev:desktop</code>
        </div>
        <RouterView v-else />
      </NMessageProvider>
    </NDialogProvider>
  </NConfigProvider>
</template>

<style scoped>
.boot-error {
  min-height: 100%;
  display: grid;
  place-content: center;
  gap: 12px;
  text-align: center;
  color: var(--ez-color-text);
  background: var(--ez-color-bg);
  padding: 24px;
}

h1 {
  margin: 0;
  color: var(--ez-color-primary);
}

p {
  margin: 0;
  color: var(--ez-color-text-muted);
}

code {
  font-family: var(--ez-font-mono);
  padding: 10px 14px;
  border-radius: 8px;
  background: var(--ez-color-bg-elevated);
  border: 1px solid var(--ez-color-border);
}
</style>
