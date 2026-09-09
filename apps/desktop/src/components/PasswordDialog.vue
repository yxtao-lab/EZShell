<script setup lang="ts">
import { ref, watch } from "vue";

const props = defineProps<{
  open: boolean;
  title: string;
  message: string;
  hostLabel: string;
}>();

const emit = defineEmits<{
  cancel: [];
  submit: [payload: { password: string; remember: boolean }];
}>();

const password = ref("");
const remember = ref(true);

watch(
  () => props.open,
  (open) => {
    if (open) {
      password.value = "";
      remember.value = true;
    }
  },
);

/**
 * 提交密码。
 *
 * @returns {void}
 */
function onSubmit(): void {
  if (!password.value) {
    return;
  }
  emit("submit", { password: password.value, remember: remember.value });
}
</script>

<template>
  <div v-if="open" class="mask" @click.self="emit('cancel')">
    <form class="dialog" @submit.prevent="onSubmit">
      <h3>{{ title }}</h3>
      <p class="host">{{ hostLabel }}</p>
      <p class="msg">{{ message }}</p>
      <label>
        密码
        <input
          v-model="password"
          type="password"
          autocomplete="current-password"
          autofocus
          required
        />
      </label>
      <label class="check">
        <input v-model="remember" type="checkbox" />
        记住密码（写入系统安全存储）
      </label>
      <div class="actions">
        <button type="button" class="ghost" @click="emit('cancel')">取消</button>
        <button type="submit" class="primary">连接</button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  background: rgba(12, 14, 28, 0.72);
  display: grid;
  place-items: center;
  z-index: 50;
}

.dialog {
  width: min(420px, 92vw);
  background: var(--ez-color-bg-elevated);
  border: 1px solid var(--ez-color-border);
  border-radius: 12px;
  padding: 20px;
  display: grid;
  gap: 12px;
}

h3 {
  margin: 0;
}

.host {
  margin: 0;
  color: var(--ez-color-primary);
  font-family: var(--ez-font-mono);
  font-size: 13px;
}

.msg {
  margin: 0;
  color: var(--ez-color-text-muted);
  font-size: 13px;
}

label {
  display: grid;
  gap: 6px;
  font-size: 13px;
}

input[type="password"] {
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid var(--ez-color-border);
  background: var(--ez-color-bg);
  color: var(--ez-color-text);
}

.check {
  display: flex;
  align-items: center;
  gap: 8px;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

button {
  border: none;
  border-radius: 8px;
  padding: 8px 14px;
  cursor: pointer;
}

.primary {
  background: var(--ez-color-primary);
  color: var(--ez-color-primary-ink);
}

.ghost {
  background: transparent;
  color: var(--ez-color-text-muted);
  border: 1px solid var(--ez-color-border);
}
</style>
