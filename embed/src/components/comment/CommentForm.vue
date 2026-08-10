<template>
  <div class="umo-cmt-form">
    <div v-if="quote" class="umo-cmt-quote" :title="quote">{{ quote }}</div>
    <textarea
      ref="taRef"
      v-model="text"
      class="umo-cmt-textarea"
      :placeholder="mode === 'reply' ? '写下你的回复…' : '写下你的评论…'"
      rows="3"
      @keydown.meta.enter.prevent="submit"
      @keydown.ctrl.enter.prevent="submit"
    ></textarea>
    <div class="umo-cmt-actions">
      <button class="umo-cmt-btn umo-cmt-btn-ghost" @click="$emit('cancel')">取消</button>
      <button
        class="umo-cmt-btn umo-cmt-btn-primary"
        :disabled="!text.trim() || busy"
        @click="submit"
      >
        {{ busy ? '提交中…' : (submitLabel || (mode === 'reply' ? '回复' : '评论')) }}
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'

const props = defineProps({
  quote: { type: String, default: '' },
  mode: { type: String, default: 'create' }, // 'create' | 'reply'
  submitLabel: { type: String, default: '' },
  busy: { type: Boolean, default: false },
})
const emit = defineEmits(['submit', 'cancel'])

const text = ref('')
const taRef = ref(null)

function submit() {
  const v = text.value.trim()
  if (!v || props.busy) return
  emit('submit', v)
  text.value = ''
}

defineExpose({ focus: () => taRef.value?.focus() })
</script>

<style scoped>
.umo-cmt-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.umo-cmt-quote {
  font-size: 12px;
  color: var(--umo-text-color-secondary, #888);
  background: var(--umo-bg-color-page, #f5f5f5);
  border-left: 3px solid var(--umo-primary-color, #4d8ee0);
  padding: 6px 8px;
  border-radius: 3px;
  max-height: 60px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.umo-cmt-textarea {
  width: 100%;
  resize: vertical;
  min-height: 64px;
  padding: 8px;
  border: 1px solid var(--umo-border-color, #ddd);
  border-radius: 4px;
  font-size: 13px;
  font-family: inherit;
  box-sizing: border-box;
  outline: none;
}
.umo-cmt-textarea:focus {
  border-color: var(--umo-primary-color, #4d8ee0);
}
.umo-cmt-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.umo-cmt-btn {
  border: none;
  border-radius: 4px;
  padding: 5px 12px;
  font-size: 13px;
  cursor: pointer;
}
.umo-cmt-btn-ghost {
  background: transparent;
  color: var(--umo-text-color-secondary, #888);
}
.umo-cmt-btn-ghost:hover {
  background: var(--umo-bg-color-page, #f5f5f5);
}
.umo-cmt-btn-primary {
  background: var(--umo-primary-color, #4d8ee0);
  color: #fff;
}
.umo-cmt-btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
