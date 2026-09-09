<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { api } from "../lib/api";
import { setTokens } from "../lib/auth-store";
import type { Entitlements } from "@ezshell/shared";

const router = useRouter();
const profile = ref<{
  email: string;
  nickname: string | null;
  membership: {
    planName: string;
    status: string;
    expiresAt: string | null;
  };
} | null>(null);
const entitlements = ref<Entitlements | null>(null);
const error = ref("");

/**
 * 加载当前用户与权益。
 *
 * @returns Promise
 */
async function load(): Promise<void> {
  try {
    const [me, ents] = await Promise.all([
      api.getMe() as Promise<{
        email: string;
        nickname: string | null;
        membership: {
          planName: string;
          status: string;
          expiresAt: string | null;
        };
      }>,
      api.getEntitlements(),
    ]);
    profile.value = me;
    entitlements.value = ents;
  } catch (err) {
    error.value = err instanceof Error ? err.message : "加载失败";
  }
}

/**
 * 退出登录。
 *
 * @returns Promise
 */
async function logout(): Promise<void> {
  try {
    await api.logout();
  } finally {
    setTokens(null);
    await router.push({ name: "login" });
  }
}

onMounted(() => {
  void load();
});
</script>

<template>
  <div class="layout">
    <aside>
      <div class="brand">EZShell</div>
      <nav>
        <a class="active" href="#">概览</a>
        <a class="disabled" href="#">用户管理</a>
        <a class="disabled" href="#">会员管理</a>
        <a class="disabled" href="#">订单</a>
        <a class="disabled" href="#">套餐配置</a>
        <a class="disabled" href="#">公告</a>
      </nav>
    </aside>
    <main>
      <header>
        <h1>运营概览</h1>
        <button class="btn" type="button" @click="logout">退出登录</button>
      </header>

      <p v-if="error" class="error">{{ error }}</p>

      <section v-if="profile" class="panel">
        <h2>当前账号</h2>
        <p>{{ profile.nickname || "未设置昵称" }} · {{ profile.email }}</p>
        <p>
          会员：{{ profile.membership.planName }}（{{
            profile.membership.status
          }}）
        </p>
      </section>

      <section v-if="entitlements" class="panel">
        <h2>权益快照</h2>
        <ul>
          <li>主机上限：{{ entitlements.maxHosts ?? "不限" }}</li>
          <li>云同步：{{ entitlements.cloudSync ? "开启" : "关闭" }}</li>
          <li>设备上限：{{ entitlements.maxDevices ?? "不限" }}</li>
        </ul>
      </section>

      <section class="panel muted">
        <h2>后续模块（P5）</h2>
        <p>用户管理、手动开通会员、订单流水、套餐配置、数据看板将在此完善。</p>
      </section>
    </main>
  </div>
</template>

<style scoped>
.layout {
  display: grid;
  grid-template-columns: 220px 1fr;
  min-height: 100vh;
}

aside {
  background: var(--ez-color-bg-sidebar);
  border-right: 1px solid var(--ez-color-border);
  padding: 20px 14px;
}

.brand {
  font-weight: 700;
  font-size: 20px;
  color: var(--ez-color-primary);
  margin-bottom: 24px;
}

nav {
  display: grid;
  gap: 6px;
}

nav a {
  padding: 10px 12px;
  border-radius: 8px;
  color: var(--ez-color-text-muted);
}

nav a.active {
  background: var(--ez-color-surface);
  color: var(--ez-color-text);
}

nav a.disabled {
  opacity: 0.45;
  pointer-events: none;
}

main {
  padding: 24px;
}

header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

h1 {
  margin: 0;
  font-size: 22px;
}

.panel {
  background: var(--ez-color-bg-elevated);
  border: 1px solid var(--ez-color-border);
  border-radius: 12px;
  padding: 16px 18px;
  margin-bottom: 14px;
}

.panel.muted {
  color: var(--ez-color-text-muted);
}

h2 {
  margin: 0 0 10px;
  font-size: 16px;
}

ul {
  margin: 0;
  padding-left: 18px;
}
</style>
