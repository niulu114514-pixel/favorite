<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import {
  ArrowDown,
  ArrowUp,
  GripVertical,
  MoreHorizontal,
  Pencil,
  Pin,
  Trash2,
} from 'lucide-vue-next'
import type { LinkItem } from '../../types'
import { favicon, handleFaviconError } from '../composables/useFavicon'
import { safeTargetUrl } from '../utils/url'

const props = defineProps<{
  links: LinkItem[]
  compact: boolean
  canManage: boolean
  /** 隐藏编辑/删除等工具条（管理员预览用，纯展示开关） */
  hideTools?: boolean
}>()

const emit = defineEmits<{
  pin: [id: string]
  edit: [link: LinkItem]
  delete: [link: LinkItem]
  reorder: [orderedIds: string[]]
}>()

const dragId = ref<string | null>(null)
const overId = ref<string | null>(null)
const actionsOpenId = ref<string | null>(null)
const gridElement = ref<HTMLElement>()

function closeActionsOnOutsideClick(event: PointerEvent) {
  const target = event.target
  if (!(target instanceof Element) || !gridElement.value?.contains(target)) {
    actionsOpenId.value = null
    return
  }
  const card = target.closest<HTMLElement>('.link-card-wrap')
  if (card?.dataset.linkId === actionsOpenId.value) return
  actionsOpenId.value = null
}

onMounted(() => document.addEventListener('pointerdown', closeActionsOnOutsideClick))
onBeforeUnmount(() => document.removeEventListener('pointerdown', closeActionsOnOutsideClick))

function toggleActions(id: string) {
  actionsOpenId.value = actionsOpenId.value === id ? null : id
}

function runCardAction(action: () => void) {
  actionsOpenId.value = null
  action()
}

function move(id: string, delta: number) {
  const from = props.links.findIndex(link => link.id === id)
  const to = from + delta
  if (from < 0 || to < 0 || to >= props.links.length) return
  const next = [...props.links]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  emit(
    'reorder',
    next.map(link => link.id)
  )
}

function gripStart(id: string) {
  dragId.value = id
  document.body.classList.add('sorting-links')
}

function dragEnd() {
  dragId.value = null
  overId.value = null
  document.body.classList.remove('sorting-links')
}

function dropOn(overIdValue: string) {
  const draggedId = dragId.value
  if (!draggedId || draggedId === overIdValue) return dragEnd()
  const ids = props.links.map(link => link.id)
  const from = ids.indexOf(draggedId)
  const to = ids.indexOf(overIdValue)
  if (from < 0 || to < 0) return dragEnd()
  const next = [...ids]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  emit('reorder', next)
  dragEnd()
}
</script>

<template>
  <div ref="gridElement" class="link-grid" :class="{ compact }">
    <article
      v-for="link in links"
      :key="link.id"
      class="link-card-wrap"
      :class="{
        dragging: dragId === link.id,
        'drop-target': dragId && dragId !== link.id && overId === link.id,
        'actions-open': actionsOpenId === link.id,
      }"
      :data-link-id="link.id"
      @dragover.prevent="overId = dragId ? link.id : null"
      @dragleave="overId = null"
      @drop.prevent="dropOn(link.id)"
    >
      <a
        class="link-card"
        :href="safeTargetUrl(link.url)"
        target="_blank"
        rel="noopener noreferrer"
      >
        <img
          :src="favicon(link)"
          alt=""
          loading="lazy"
          decoding="async"
          @error="handleFaviconError($event, link)"
        />
        <div class="link-card-text">
          <strong>{{ link.title }}</strong>
          <p v-if="!compact">{{ link.description || link.url }}</p>
        </div>
      </a>
      <button
        v-if="canManage && !hideTools"
        type="button"
        class="card-more"
        :aria-label="`管理 ${link.title}`"
        :aria-controls="`link-actions-${link.id}`"
        :aria-expanded="actionsOpenId === link.id"
        @click.stop="toggleActions(link.id)"
      >
        <MoreHorizontal :size="18" />
      </button>
      <div
        v-if="canManage && !hideTools"
        :id="`link-actions-${link.id}`"
        class="card-actions"
        :class="{ open: actionsOpenId === link.id }"
      >
        <button
          type="button"
          class="action-drag"
          title="拖动调整顺序"
          aria-label="拖动调整顺序"
          draggable="true"
          @dragstart="gripStart(link.id)"
          @dragend="dragEnd"
        >
          <GripVertical :size="15" /><span>拖动</span>
        </button>
        <button
          type="button"
          title="上移"
          aria-label="上移"
          @click="runCardAction(() => move(link.id, -1))"
        >
          <ArrowUp :size="14" /><span>上移</span>
        </button>
        <button
          type="button"
          title="下移"
          aria-label="下移"
          @click="runCardAction(() => move(link.id, 1))"
        >
          <ArrowDown :size="14" /><span>下移</span>
        </button>
        <button
          type="button"
          :title="link.pinned ? '取消置顶' : '置顶'"
          :aria-label="link.pinned ? '取消置顶' : '置顶'"
          @click="runCardAction(() => emit('pin', link.id))"
        >
          <Pin :size="14" :fill="link.pinned ? 'currentColor' : 'none'" />
          <span>{{ link.pinned ? '取消置顶' : '置顶' }}</span>
        </button>
        <button
          type="button"
          title="编辑"
          aria-label="编辑"
          @click="runCardAction(() => emit('edit', link))"
        >
          <Pencil :size="14" /><span>编辑</span>
        </button>
        <button
          type="button"
          title="删除"
          aria-label="删除"
          class="danger"
          @click="runCardAction(() => emit('delete', link))"
        >
          <Trash2 :size="14" /><span>删除</span>
        </button>
      </div>
    </article>
  </div>
</template>

<style scoped>
.link-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, var(--card-min)), 1fr));
  gap: clamp(12px, 1.4vw, 20px);
  --card-min: 320px;
}
/* 防止网格项/卡片被内容撑开而异常拉长 */
.link-grid > *,
.link-card-wrap,
.link-card {
  min-width: 0;
}
.link-grid.compact {
  --card-min: 236px;
}
.link-card-wrap {
  position: relative;
  contain: layout;
}
.link-card-wrap.drop-target {
  border-radius: 13px;
  box-shadow: 0 0 0 2px rgba(79, 124, 255, 0.55);
  outline: 2px dashed rgba(79, 124, 255, 0.55);
  outline-offset: 2px;
}
.link-card-wrap.dragging {
  opacity: 0.45;
}
.link-card {
  min-height: clamp(74px, 9vw, 116px);
  padding: clamp(13px, 1.7vw, 22px);
  display: flex;
  align-items: center;
  gap: clamp(12px, 1.5vw, 18px);
  background: #fff;
  border: 1px solid #e6e9ef;
  border-radius: 14px;
  text-decoration: none;
  color: inherit;
  transition:
    transform 0.18s ease,
    border-color 0.18s ease,
    box-shadow 0.18s ease;
  box-shadow: 0 2px 5px rgba(28, 39, 60, 0.025);
}
.compact .link-card {
  min-height: 60px;
  padding: 10px 13px;
}
.link-card:hover {
  transform: translateY(-2px);
  border-color: #aabcf2;
  box-shadow: 0 8px 24px rgba(42, 60, 100, 0.1);
}
.link-card img {
  width: 44px;
  height: 44px;
  object-fit: contain;
  border-radius: 10px;
  background: #f4f6f9;
  padding: 6px;
  flex: 0 0 auto;
}
.compact .link-card img {
  width: 32px;
  height: 32px;
  padding: 4px;
}
.link-card-text {
  min-width: 0;
}
.link-card strong {
  font-size: clamp(13.5px, 1.4vw, 17px);
  display: block;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.link-card p {
  font-size: clamp(11.5px, 1.15vw, 13.5px);
  color: #7a8699;
  margin: 5px 0 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.compact .link-card p {
  display: none;
}
.card-more {
  display: none;
}
.card-actions {
  position: absolute;
  right: 7px;
  top: 7px;
  display: none;
  background: #fff;
  border: 1px solid #e5e8ed;
  border-radius: 9px;
  padding: 3px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  gap: 1px;
}
.card-actions button span {
  display: none;
}
.link-card-wrap:hover .card-actions,
.link-card-wrap:focus-within .card-actions,
.link-card-wrap.dragging .card-actions {
  display: flex;
  flex-wrap: wrap;
  max-width: calc(100% - 14px);
}
.card-actions button {
  width: 27px;
  height: 27px;
  border: 0;
  background: transparent;
  color: #718096;
  border-radius: 6px;
  display: grid;
  place-items: center;
  cursor: pointer;
  padding: 0;
}
.card-actions button:hover {
  background: #edf2ff;
  color: #315ed5;
}
.card-actions button.danger:hover {
  background: #fff0f0;
  color: #d63e3e;
}
.card-actions .action-drag {
  cursor: grab;
  color: #a4aebd;
}

/* Responsive: reveal actions and keep cards tappable on small screens. */
@media (max-width: 850px) {
  .link-grid {
    --card-min: 216px;
  }
  .card-more {
    position: absolute;
    z-index: 3;
    top: 7px;
    right: 7px;
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    padding: 0;
    border: 1px solid #e5e8ed;
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.96);
    color: #647188;
    box-shadow: 0 4px 12px rgba(35, 48, 76, 0.1);
  }
  .card-actions,
  .link-card-wrap:hover .card-actions,
  .link-card-wrap:focus-within .card-actions {
    display: none;
  }
  .card-actions.open {
    right: 7px;
    top: 51px;
    z-index: 4;
    display: grid;
    grid-template-columns: 1fr 1fr;
    width: min(220px, calc(100% - 14px));
    max-width: none;
    gap: 4px;
    padding: 6px;
  }
  .card-actions.open button {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 7px;
    width: auto;
    min-width: 0;
    height: 42px;
    padding: 0 10px;
    white-space: nowrap;
  }
  .card-actions.open button span {
    display: inline;
    font-size: 11px;
    font-weight: 650;
  }
  .card-actions.open .action-drag {
    display: none;
  }
  .link-card-wrap.actions-open {
    padding-bottom: 127px;
  }
  .link-card {
    min-height: 80px;
  }
  .link-card img {
    width: 36px;
    height: 36px;
  }
  .link-card p {
    /* 移动端展示两行描述，替代原来的隐藏 */
    display: -webkit-box;
    white-space: normal;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    line-height: 1.35;
  }
}

/* 手机端固定双列卡片，左右并排展示 */
@media (max-width: 640px) {
  .link-grid,
  .link-grid.compact {
    grid-template-columns: repeat(2, 1fr);
    gap: 10px;
  }
  .link-card {
    min-height: 78px;
    padding: 10px;
    gap: 9px;
    border-radius: 12px;
  }
  .link-card img {
    width: 34px;
    height: 34px;
    padding: 5px;
  }
  .compact .link-card img {
    width: 30px;
    height: 30px;
  }
  .link-card strong {
    font-size: 13px;
  }
  .link-card p {
    font-size: 11px;
    margin-top: 4px;
    -webkit-line-clamp: 2;
  }
  .compact .link-card p {
    display: -webkit-box;
    -webkit-line-clamp: 2;
  }
}

@media (max-width: 520px) {
  .link-grid,
  .link-grid.compact {
    grid-template-columns: 1fr;
  }
}

/* ===== 暗色模式（组件内作用域，避免被全局样式漏掉）===== */
html.dark .link-card {
  background: #222933;
  border-color: #343d49;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25);
}
html.dark .link-card:hover {
  border-color: #4a5766;
}
html.dark .link-card img {
  background: #1a2028;
}
html.dark .link-card p {
  color: #9ba7b7;
}
html.dark .card-actions {
  background: #222933;
  border-color: #343d49;
}
html.dark .card-actions button {
  color: #9aa6b6;
}
html.dark .card-actions button:hover {
  background: #2c394b;
  color: #c9d8ff;
}
html.dark .card-more {
  border-color: #343d49;
  background: rgba(34, 41, 51, 0.96);
  color: #c2cad6;
}
</style>
