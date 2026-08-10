<template>
  <div ref="commentContainerRef" class="umo-comment-container">
    <div class="umo-comment-title">
      <icon class="icon-comment" name="comment" />
      {{ t('comment.title') }}
      <span class="umo-comment-count">({{ comments.length }})</span>
      <div class="umo-dialog__close" @click="$emit('close')">
        <icon name="close" />
      </div>
    </div>

    <div class="umo-comment-body umo-scrollbar">
      <!-- 新建评论（选中文字后点气泡"评论"按钮触发） -->
      <div v-if="pendingAdd" class="umo-comment-section">
        <container-comment-form
          ref="addFormRef"
          :quote="pendingAdd.selectedText"
          :busy="addBusy"
          :submit-label="t('comment.submit')"
          @submit="onSubmitAdd"
          @cancel="onCancelAdd"
        />
        <div class="umo-comment-divider"></div>
      </div>

      <div v-if="!comments.length && !pendingAdd" class="umo-comment-empty">
        {{ t('comment.empty') }}
      </div>

      <div
        v-for="c in comments"
        :key="c.id"
        class="umo-comment-card"
        tabindex="0"
        :class="{
          active: activeCommentId === c.id,
          resolved: c.resolved,
        }"
        @click="onClickCard(c.id)"
        @focus="onFocusCard(c.id)"
      >
        <div class="umo-comment-card-head">
          <span
            class="umo-comment-avatar"
            :style="{ backgroundColor: c.author?.color || '#888' }"
            >{{ (c.author?.name || '?').charAt(0) }}</span
          >
          <span class="umo-comment-name">{{ c.author?.name || '匿名' }}</span>
          <span class="umo-comment-time">{{ fmt(c.createdAt) }}</span>
          <span v-if="c.resolved" class="umo-comment-badge resolved">
            {{ t('comment.resolved') }}
          </span>
        </div>

        <div v-if="c.selectedText" class="umo-comment-quote" :title="c.selectedText">
          {{ c.selectedText }}
        </div>

        <div class="umo-comment-content">{{ c.content }}</div>

        <!-- 回复列表 -->
        <div v-if="c.replies?.length" class="umo-comment-replies">
          <div v-for="r in c.replies" :key="r.id" class="umo-comment-reply">
            <span class="umo-comment-reply-name"
              >{{ r.author?.name || '匿名' }}:</span
            >
            <span class="umo-comment-reply-text">{{ r.content }}</span>
          </div>
        </div>

        <!-- 回复表单 -->
        <container-comment-form
          v-if="replyingId === c.id"
          mode="reply"
          :busy="replyBusy"
          @submit="(v) => onSubmitReply(c.id, v)"
          @cancel="replyingId = null"
        />

        <div class="umo-comment-card-actions">
          <button
            class="umo-comment-link"
            @click="replyingId = replyingId === c.id ? null : c.id"
          >
            {{ t('comment.reply') }}
          </button>
          <button
            class="umo-comment-link"
            @click="onResolve(c.id, !c.resolved)"
          >
            {{ c.resolved ? t('comment.unresolve') : t('comment.resolve') }}
          </button>
          <button
            v-if="c.author?.id === currentUserId"
            class="umo-comment-link umo-comment-danger"
            @click="onDelete(c.id)"
          >
            {{ t('comment.delete') }}
          </button>
        </div>
      </div>
    </div>

    <div class="umo-comment-resize-handle" @mousedown="startResize"></div>
  </div>
</template>

<script setup>
const { t } = useI18n()

defineEmits(['close'])

// 从根组件注入评论状态
const comments = inject('comments', ref([]))
const activeCommentId = inject('activeCommentId', ref(null))
const pendingAdd = inject('commentPendingAdd', ref(null))
const addBusy = inject('commentAddBusy', ref(false))
const currentUserId = inject('commentCurrentUserId', ref(''))
const addComment = inject('commentAdd', () => {})
const cancelAdd = inject('commentCancelAdd', () => {})
const replyComment = inject('commentReply', () => {})
const resolveComment = inject('commentResolve', () => {})
const deleteComment = inject('commentDelete', () => {})
const focusComment = inject('commentFocus', () => {})

const replyingId = ref(null)
const replyBusy = ref(false)
const addFormRef = ref(null)

function onClickCard(id) {
  focusComment(id)
}
function onFocusCard(id) {
  focusComment(id)
}

async function onSubmitAdd(content) {
  await addComment(content)
}
function onCancelAdd() {
  cancelAdd()
}

async function onSubmitReply(id, content) {
  replyBusy.value = true
  try {
    await replyComment(id, content)
  } finally {
    replyBusy.value = false
    replyingId.value = null
  }
}

async function onResolve(id, resolved) {
  await resolveComment(id, resolved)
}

async function onDelete(id) {
  await deleteComment(id)
}

function fmt(ts) {
  if (!ts) return ''
  try {
    return new Date(ts).toLocaleString()
  } catch {
    return ''
  }
}

// ============ 拖拽调宽（参考 toc.vue） ============
const baseWidth = 320
const minWidth = baseWidth / 1.5
const maxWidth = baseWidth * 2
const commentContainerRef = ref(null)
const umoPageContainer = ref(null)
const isResizing = ref(false)
const startX = ref(0)
const initialWidth = ref(baseWidth)
let resizeFrame = 0
let pendingWidth = null

const applyWidth = (width) => {
  if (commentContainerRef.value) {
    commentContainerRef.value.style.width = `${width}px`
  }
}

const flushWidth = () => {
  resizeFrame = 0
  if (pendingWidth === null) return
  applyWidth(pendingWidth)
}

const startResize = (e) => {
  if (!commentContainerRef.value) return
  e.preventDefault()
  isResizing.value = true
  startX.value = e.clientX
  initialWidth.value = parseInt(
    getComputedStyle(commentContainerRef.value).width,
    10,
  )
  document.body.style.userSelect = 'none'
  document.addEventListener('mousemove', resize)
  document.addEventListener('mouseup', stopResize)
}

const resize = (e) => {
  if (!isResizing.value) return
  const offsetX = e.clientX - startX.value
  pendingWidth = Math.min(
    maxWidth,
    Math.max(minWidth, initialWidth.value + offsetX),
  )
  if (!resizeFrame) {
    resizeFrame = requestAnimationFrame(flushWidth)
  }
}

const stopResize = () => {
  if (!isResizing.value) return
  isResizing.value = false
  document.body.style.userSelect = ''
  document.removeEventListener('mousemove', resize)
  document.removeEventListener('mouseup', stopResize)
  if (resizeFrame) {
    cancelAnimationFrame(resizeFrame)
    flushWidth()
  }
  pendingWidth = null
}

// pendingAdd 出现时自动聚焦表单
watch(
  () => pendingAdd.value,
  async (val) => {
    if (val) {
      await nextTick()
      addFormRef.value?.focus?.()
    }
  },
)

onBeforeUnmount(() => {
  stopResize()
})
</script>

<style lang="less">
.umo-comment-container {
  width: 320px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  position: relative;
  font-size: 13px;

  .umo-comment-resize-handle {
    position: absolute;
    top: 0;
    right: -5px;
    width: 10px;
    height: 100%;
    background-color: transparent;
    cursor: col-resize;
    &::before {
      content: '';
      position: absolute;
      top: 0;
      right: 4px;
      width: 2px;
      height: 100%;
      opacity: 0.5;
      background-color: transparent;
      transition: background-color 0.2s ease;
    }
    &:hover {
      &::before {
        background-color: var(--umo-primary-color);
      }
    }
  }
  &:hover {
    .umo-dialog__close {
      display: flex !important;
    }
  }

  .umo-comment-title {
    display: flex;
    align-items: center;
    position: relative;
    padding: 20px 15px 10px;
    font-weight: 600;
    color: var(--umo-text-color);
    .icon-comment {
      margin-right: 5px;
      font-size: 20px;
    }
    .umo-comment-count {
      margin-left: 4px;
      font-weight: 400;
      color: var(--umo-text-color-light);
    }
    .umo-dialog__close {
      position: absolute;
      right: -4px;
      display: flex;
      align-items: center;
      justify-content: center;
      display: none;
    }
  }

  .umo-comment-body {
    flex: 1;
    overflow-y: auto;
    padding: 10px 15px;
  }

  .umo-comment-empty {
    color: var(--umo-text-color-light);
    text-align: center;
    padding: 40px 12px;
    line-height: 1.6;
  }

  .umo-comment-section {
    margin-bottom: 4px;
  }

  .umo-comment-divider {
    height: 1px;
    background: var(--umo-border-color-light);
    margin: 14px 0;
  }

  .umo-comment-card {
    padding: 10px 12px;
    border: 1px solid var(--umo-border-color);
    border-radius: var(--umo-radius);
    margin-bottom: 10px;
    outline: none;
    transition: box-shadow 0.15s, border-color 0.15s;
    &:hover {
      border-color: var(--umo-primary-color);
    }
    &.active {
      border-color: var(--umo-primary-color);
      box-shadow: 0 0 0 2px rgba(77, 142, 224, 0.2);
    }
    &.resolved {
      background: var(--umo-button-hover-background);
    }
  }

  .umo-comment-card-head {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 6px;
  }

  .umo-comment-avatar {
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

  .umo-comment-name {
    font-weight: 600;
    color: var(--umo-text-color);
  }

  .umo-comment-time {
    font-size: 11px;
    color: var(--umo-text-color-light);
  }

  .umo-comment-badge {
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 8px;
    margin-left: auto;
    &.resolved {
      background: #e8f7ee;
      color: #2aa05a;
    }
  }

  .umo-comment-quote {
    font-size: 12px;
    color: var(--umo-text-color-light);
    background: var(--umo-button-hover-background);
    border-left: 3px solid var(--umo-primary-color);
    padding: 5px 8px;
    border-radius: 3px;
    margin-bottom: 6px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .umo-comment-content {
    color: var(--umo-text-color);
    line-height: 1.55;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .umo-comment-replies {
    margin-top: 8px;
    padding: 6px 0 2px;
    border-top: 1px dashed var(--umo-border-color);
  }

  .umo-comment-reply {
    font-size: 12px;
    margin-bottom: 3px;
    color: var(--umo-text-color);
  }

  .umo-comment-reply-name {
    font-weight: 600;
    margin-right: 4px;
    color: var(--umo-primary-color);
  }

  .umo-comment-card-actions {
    display: flex;
    gap: 12px;
    margin-top: 8px;
  }

  .umo-comment-link {
    border: none;
    background: transparent;
    color: var(--umo-text-color-light);
    font-size: 12px;
    cursor: pointer;
    padding: 0;
    &:hover {
      color: var(--umo-primary-color);
    }
  }

  .umo-comment-danger:hover {
    color: #e5403a;
  }
}

// skin-default 下的差异化样式（与 toc.vue 一致）
.umo-editor-container.umo-skin-default {
  .umo-comment-container {
    background-color: var(--umo-color-white);
    border-right: solid 1px var(--umo-border-color);
    .umo-comment-title {
      border-bottom: solid 1px var(--umo-border-color-light);
      padding: 10px 15px;
      .umo-dialog__close {
        right: 15px;
      }
    }
  }
}
</style>
