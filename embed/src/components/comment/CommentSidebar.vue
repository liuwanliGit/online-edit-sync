<template>
  <div class="umo-cmt-sidebar">
    <div class="umo-cmt-header">
      <span class="umo-cmt-title">评论 ({{ comments.length }})</span>
      <button class="umo-cmt-icon-btn" title="关闭" @click="$emit('close')">×</button>
    </div>

    <div class="umo-cmt-body">
      <!-- 新建评论（选中文字后点 bubble 的"评论"按钮触发） -->
      <div v-if="pendingAdd" class="umo-cmt-section">
        <CommentForm
          :quote="pendingAdd.selectedText"
          :busy="busy"
          submit-label="发表评论"
          @submit="(v) => $emit('add', v)"
          @cancel="$emit('cancel-add')"
        />
        <div class="umo-cmt-divider"></div>
      </div>

      <div v-if="!comments.length && !pendingAdd" class="umo-cmt-empty">
        选中文字后点击"评论"按钮添加评论
      </div>

      <div
        v-for="c in comments"
        :key="c.id"
        class="umo-cmt-card"
        tabindex="0"
        :class="{
          active: activeCommentId === c.id,
          resolved: c.resolved,
        }"
        @click="onClick(c.id)"
        @focus="onFocus(c.id)"
      >
        <div class="umo-cmt-card-head">
          <span
            class="umo-cmt-avatar"
            :style="{ backgroundColor: c.author?.color || '#888' }"
            >{{ (c.author?.name || '?').charAt(0) }}</span
          >
          <span class="umo-cmt-name">{{ c.author?.name || '匿名' }}</span>
          <span class="umo-cmt-time">{{ fmt(c.createdAt) }}</span>
          <span v-if="c.resolved" class="umo-cmt-badge resolved">已解决</span>
        </div>

        <div v-if="c.selectedText" class="umo-cmt-quote" :title="c.selectedText">
          {{ c.selectedText }}
        </div>

        <div class="umo-cmt-content">{{ c.content }}</div>

        <!-- 回复列表 -->
        <div v-if="c.replies?.length" class="umo-cmt-replies">
          <div v-for="r in c.replies" :key="r.id" class="umo-cmt-reply">
            <span class="umo-cmt-reply-name">{{ r.author?.name || '匿名' }}:</span>
            <span class="umo-cmt-reply-text">{{ r.content }}</span>
          </div>
        </div>

        <!-- 回复表单 -->
        <CommentForm
          v-if="replyingId === c.id"
          mode="reply"
          :busy="replyBusy"
          @submit="(v) => onReply(c.id, v)"
          @cancel="replyingId = null"
        />

        <div class="umo-cmt-card-actions">
          <button class="umo-cmt-link" @click="replyingId = replyingId === c.id ? null : c.id">
            回复
          </button>
          <button class="umo-cmt-link" @click="$emit('resolve', { id: c.id, resolved: !c.resolved })">
            {{ c.resolved ? '取消解决' : '标记解决' }}
          </button>
          <button
            v-if="c.author?.id === currentUserId"
            class="umo-cmt-link umo-cmt-danger"
            @click="$emit('delete', c.id)"
          >
            删除
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import CommentForm from './CommentForm.vue'

defineProps({
  comments: { type: Array, default: () => [] },
  activeCommentId: { type: [String, null], default: null },
  pendingAdd: { type: Object, default: null },
  busy: { type: Boolean, default: false },
  currentUserId: { type: String, default: '' },
})

const emit = defineEmits(['add', 'cancel-add', 'reply', 'resolve', 'delete', 'focus-comment', 'close'])

const replyingId = ref(null)
const replyBusy = ref(false)

function onClick(id) {
  emit('focus-comment', id)
}
function onFocus(id) {
  emit('focus-comment', id)
}
async function onReply(id, content) {
  replyBusy.value = true
  try {
    emit('reply', { id, content })
  } finally {
    replyBusy.value = false
    replyingId.value = null
  }
}
function fmt(ts) {
  if (!ts) return ''
  try {
    return new Date(ts).toLocaleString()
  } catch {
    return ''
  }
}
</script>

<style scoped>
.umo-cmt-sidebar {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--umo-color-white, #fff);
  border-left: 1px solid var(--umo-border-color, #e7e7e7);
  font-size: 13px;
}
.umo-cmt-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid var(--umo-border-color, #e7e7e7);
  flex-shrink: 0;
}
.umo-cmt-title {
  font-weight: 600;
  color: var(--umo-text-color-primary, #333);
}
.umo-cmt-icon-btn {
  border: none;
  background: transparent;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  color: var(--umo-text-color-secondary, #888);
  padding: 2px 6px;
  border-radius: 4px;
}
.umo-cmt-icon-btn:hover {
  background: var(--umo-bg-color-page, #f5f5f5);
}
.umo-cmt-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px 14px;
}
.umo-cmt-empty {
  color: var(--umo-text-color-secondary, #999);
  text-align: center;
  padding: 40px 12px;
  line-height: 1.6;
}
.umo-cmt-section {
  margin-bottom: 4px;
}
.umo-cmt-divider {
  height: 1px;
  background: var(--umo-border-color-light, #f0f0f0);
  margin: 14px 0;
}
.umo-cmt-card {
  padding: 10px 12px;
  border: 1px solid var(--umo-border-color, #eee);
  border-radius: 6px;
  margin-bottom: 10px;
  outline: none;
  transition: box-shadow 0.15s, border-color 0.15s;
}
.umo-cmt-card:hover {
  border-color: var(--umo-border-color-active, #d0d0d0);
}
.umo-cmt-card.active {
  border-color: var(--umo-primary-color, #4d8ee0);
  box-shadow: 0 0 0 2px rgba(77, 142, 224, 0.2);
}
.umo-cmt-card.resolved {
  background: var(--umo-bg-color-page, #fafafa);
}
.umo-cmt-card-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}
.umo-cmt-avatar {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  color: #fff;
  font-size: 11px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.umo-cmt-name {
  font-weight: 600;
  color: var(--umo-text-color-primary, #333);
}
.umo-cmt-time {
  font-size: 11px;
  color: var(--umo-text-color-secondary, #aaa);
}
.umo-cmt-badge {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 8px;
  margin-left: auto;
}
.umo-cmt-badge.resolved {
  background: #e8f7ee;
  color: #2aa05a;
}
.umo-cmt-quote {
  font-size: 12px;
  color: var(--umo-text-color-secondary, #888);
  background: var(--umo-bg-color-page, #f7f7f7);
  border-left: 3px solid var(--umo-primary-color, #4d8ee0);
  padding: 5px 8px;
  border-radius: 3px;
  margin-bottom: 6px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.umo-cmt-content {
  color: var(--umo-text-color-primary, #333);
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
}
.umo-cmt-replies {
  margin-top: 8px;
  padding: 6px 0 2px;
  border-top: 1px dashed var(--umo-border-color, #eee);
}
.umo-cmt-reply {
  font-size: 12px;
  margin-bottom: 3px;
  color: var(--umo-text-color-primary, #444);
}
.umo-cmt-reply-name {
  font-weight: 600;
  margin-right: 4px;
  color: var(--umo-primary-color, #4d8ee0);
}
.umo-cmt-card-actions {
  display: flex;
  gap: 12px;
  margin-top: 8px;
}
.umo-cmt-link {
  border: none;
  background: transparent;
  color: var(--umo-text-color-secondary, #777);
  font-size: 12px;
  cursor: pointer;
  padding: 0;
}
.umo-cmt-link:hover {
  color: var(--umo-primary-color, #4d8ee0);
}
.umo-cmt-danger:hover {
  color: #e5403a;
}
</style>
