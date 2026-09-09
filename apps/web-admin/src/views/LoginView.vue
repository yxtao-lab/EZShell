<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { api } from "../lib/api";
import { SdkError } from "@ezshell/sdk";

const router = useRouter();
const mode = ref<"login" | "register">("login");
const email = ref("");
const password = ref("");
const nickname = ref("");
const loading = ref(false);
const error = ref("");

/**
 * 提交登录或注册表单。
 *
 * @returns Promise
 */
async function submit(): Promise<void> {
  error.value = "";
  loading.value = true;
  try {
    if (mode.value === "login") {
      await api.login(email.value.trim(), password.value);
    } else {
      await api.register(
        email.value.trim(),
        password.value,
        nickname.value.trim() || undefined,
      );
    }
    await router.push({ name: "dashboard" });
  } catch (err) {
    error.value =
      err instanceof SdkError ? err.message : "请求失败，请稍后重试";
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="page">
    <form class="card" @submit.prevent="submit">
      <h1>EZShell 管理后台</h1>
      <p class="hint">P0 骨架：使用邮箱账号登录（后续切换独立管理员鉴权）</p>

      <label>
        邮箱
        <input v-model="email" class="input" type="email" required />
      </label>
      <label v-if="mode === 'register'">
        昵称（可选）
        <input v-model="nickname" class="input" type="text" />
      </label>
      <label>
        密码
        <input
          v-model="password"
          class="input"
          type="password"
          required
          minlength="8"
        />
      </label>

      <p v-if="error" class="error">{{ error }}</p>

      <button class="btn" type="submit" :disabled="loading">
        {{ loading ? "提交中…" : mode === "login" ? "登录" : "注册并登录" }}
      </button>

      <button
        class="link"
        type="button"
        @click="mode = mode === 'login' ? 'register' : 'login'"
      >
        {{ mode === "login" ? "没有账号？注册" : "已有账号？登录" }}
      </button>
    </form>
  </div>
</template>

<style scoped>
.page {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 24px;
  background:
    radial-gradient(ellipse at top, #134e4a 0%, transparent 55%),
    var(--ez-color-bg);
}

.card {
  width: min(420px, 100%);
  background: var(--ez-color-bg-elevated);
  border: 1px solid var(--ez-color-border);
  border-radius: 12px;
  padding: 28px;
  display: grid;
  gap: 14px;
}

h1 {
  margin: 0;
  font-size: 24px;
}

.hint {
  margin: 0;
  color: var(--ez-color-text-muted);
  font-size: 13px;
}

label {
  display: grid;
  gap: 6px;
  font-size: 14px;
}

.link {
  background: transparent;
  border: none;
  color: var(--ez-color-text-muted);
  cursor: pointer;
  text-align: left;
  padding: 0;
}

.link:hover {
  color: var(--ez-color-primary);
}
</style>
