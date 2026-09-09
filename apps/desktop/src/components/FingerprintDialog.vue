<script setup lang="ts">
defineProps<{
  open: boolean;
  fingerprint: string;
  message: string;
  changed: boolean;
}>();

defineEmits<{
  accept: [];
  reject: [];
}>();
</script>

<template>
  <div v-if="open" class="mask">
    <div class="dialog">
      <h3>{{ changed ? "主机指纹已变化" : "确认主机指纹" }}</h3>
      <p>{{ message }}</p>
      <code>{{ fingerprint }}</code>
      <div class="actions">
        <button type="button" class="ghost" @click="$emit('reject')">拒绝</button>
        <button type="button" class="primary" @click="$emit('accept')">
          {{ changed ? "仍要信任并连接" : "信任并继续" }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  background: rgba(12, 14, 28, 0.72);
  display: grid;
  place-items: center;
  z-index: 60;
}

.dialog {
  width: min(520px, 92vw);
  background: var(--ez-color-bg-elevated);
  border: 1px solid var(--ez-color-border);
  border-radius: 12px;
  padding: 20px;
  display: grid;
  gap: 12px;
}

h3,
p {
  margin: 0;
}

p {
  color: var(--ez-color-text-muted);
  font-size: 13px;
}

code {
  display: block;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--ez-color-bg);
  border: 1px solid var(--ez-color-border);
  font-family: var(--ez-font-mono);
  font-size: 12px;
  word-break: break-all;
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
