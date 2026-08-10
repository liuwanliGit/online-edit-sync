<template>
  <div class="umo-comment-form">
    <div v-if="quote" class="umo-comment-quote" :title="quote">
      {{ quote }}
    </div>
    <textarea
      ref="taRef"
      v-model="text"
      class="umo-comment-textarea umo-scrollbar"
      :placeholder="
        mode === 'reply'
          ? t('comment.replyPlaceholder')
          : t('comment.placeholder')
      "
      rows="3"
      @keydown.meta.enter.prevent="submit"
      @keydown.ctrl.enter.prevent="submit"
    ></textarea>
    <div class="umo-comment-actions">
      <button class="umo-comment-btn umo-comment-btn-ghost" @click="$emit('cancel')">
        {{ t('comment.cancel') }}
      </button>
      <button
        class="umo-comment-btn umo-comment-btn-primary"
        :disabled="!text.trim() || busy"
        @click="submit"
      >
        {{
          busy
            ? '...'
            : submitLabel || (mode === 'reply' ? t('comment.reply') : t('comment.submit'))
        }}
      </button>
    </div>
  </div>
</template>

<script setup>
const { t } = useI18n()

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

<style lang="less">
.umo-comment-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.umo-comment-quote {
  font-size: 12px;
  color: var(--umo-text-color-light);
  background: var(--umo-button-hover-background);
  border-left: 3px solid var(--umo-primary-color);
  padding: 6px 8px;
  border-radius: 3px;
  max-height: 60px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.umo-comment-textarea {
  width: 100%;
  resize: vertical;
  min-height: 64px;
  padding: 8px;
  border: 1px solid var(--umo-border-color);
  border-radius: var(--umo-radius);
  font-size: 13px;
  font-family: inherit;
  box-sizing: border-box;
  outline: none;
  background-color: var(--umo-color-white);
  color: var(--umo-text-color);
  &:focus {
    border-color: var(--umo-primary-color);
  }
}
.umo-comment-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.umo-comment-btn {
  border: none;
  border-radius: var(--umo-radius);
  padding: 5px 12px;
  font-size: 13px;
  cursor: pointer;
}
.umo-comment-btn-ghost {
  background: transparent;
  color: var(--umo-text-color-light);
  &:hover {
    background: var(--umo-button-hover-background);
  }
}
.umo-comment-btn-primary {
  background: var(--umo-primary-color);
  color: #fff;
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}
</style>
