<script setup lang="ts">
import { ref } from "vue";
import { brandName } from "@ezshell/ui-tokens";

const tabs = [
  { key: "hosts", label: "主机" },
  { key: "keys", label: "密钥" },
  { key: "snippets", label: "片段" },
  { key: "mine", label: "我的" },
] as const;

type TabKey = (typeof tabs)[number]["key"];
const active = ref<TabKey>("hosts");

/**
 * 切换底部导航。
 *
 * @param key - 标签键
 * @returns void
 */
function selectTab(key: TabKey): void {
  active.value = key;
}
</script>

<template>
  <div class="phone">
    <header>
      <strong>{{ brandName }}</strong>
      <span>P0 空壳</span>
    </header>

    <main>
      <section v-if="active === 'hosts'" class="empty">
        <h1>主机</h1>
        <p>点击连接；长按更多操作（P4 实现）。</p>
        <button type="button" disabled>添加主机</button>
      </section>
      <section v-else-if="active === 'mine'" class="panel">
        <h1>我的</h1>
        <p>设置 / 账户 / 会员入口将在此接入。</p>
        <p class="muted">版本 0.1.0-p0 · H5 壳（后续对齐 uni-app）</p>
      </section>
      <section v-else class="panel muted">
        <h1>{{ tabs.find((item) => item.key === active)?.label }}</h1>
        <p>模块将在 P4 与桌面核心能力对齐。</p>
      </section>
    </main>

    <nav>
      <button
        v-for="tab in tabs"
        :key="tab.key"
        type="button"
        :class="{ active: active === tab.key }"
        @click="selectTab(tab.key)"
      >
        {{ tab.label }}
      </button>
    </nav>
  </div>
</template>

<style scoped>
.phone {
  max-width: 480px;
  margin: 0 auto;
  min-height: 100%;
  display: grid;
  grid-template-rows: auto 1fr auto;
  background: var(--ez-color-bg);
}

header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 16px;
  border-bottom: 1px solid var(--ez-color-border);
}

header span {
  font-size: 12px;
  color: var(--ez-color-primary);
}

main {
  padding: 20px 16px 88px;
}

h1 {
  margin: 0 0 8px;
  font-size: 22px;
}

p {
  margin: 0 0 16px;
  color: var(--ez-color-text-muted);
  line-height: 1.5;
}

button {
  min-height: 44px;
  min-width: 44px;
  border: none;
  border-radius: 10px;
  background: var(--ez-color-primary);
  color: #fff;
  padding: 0 16px;
}

button:disabled {
  opacity: 0.5;
}

.muted {
  color: var(--ez-color-text-muted);
}

nav {
  position: sticky;
  bottom: 0;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 4px;
  padding: 8px 8px calc(8px + env(safe-area-inset-bottom));
  background: var(--ez-color-bg-sidebar);
  border-top: 1px solid var(--ez-color-border);
}

nav button {
  background: transparent;
  color: var(--ez-color-text-muted);
  font-size: 13px;
}

nav button.active {
  color: var(--ez-color-primary);
  background: var(--ez-color-surface);
}
</style>
