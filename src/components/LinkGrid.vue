<script setup lang="ts">
import { ref } from 'vue'
import { ArrowDown, ArrowUp, GripVertical, Pencil, Pin, Trash2 } from 'lucide-vue-next'
import type { LinkItem } from '../../types'
import { favicon, handleFaviconError } from '../composables/useFavicon'
import { safeTargetUrl } from '../utils/url'

const props = defineProps<{
  links: LinkItem[]
  compact: boolean
  canManage: boolean
}>()

const emit = defineEmits<{
  pin: [id: string]
  edit: [link: LinkItem]
  delete: [link: LinkItem]
  reorder: [orderedIds: string[]]
}>()

const dragId = ref<string | null>(null)
const overId = ref<string | null>(null)

function move(id: string, delta: number) {
  const from = props.links.findIndex(link => link.id === id)
  const to = from + delta
  if (from < 0 || to < 0 || to >= props.links.length) return
  const next = [...props.links]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  emit('reorder', next.map(link => link.id))
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
  <div class="link-grid" :class="{ compact }">
    <article
      v-for="link in links"
      :key="link.id"
      class="link-card-wrap"
      :class="{
        dragging: dragId === link.id,
        'drop-target': dragId && dragId !== link.id && overId === link.id,
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
      <div v-if="canManage" class="card-actions">
        <button
          class="action-drag"
          :title="'拖动或点击上下箭头调整顺序'"
          draggable="true"
          @dragstart="gripStart(link.id)"
          @dragend="dragEnd"
        >
          <GripVertical :size="15" />
        </button>
        <button :title="'上移'" @click="move(link.id, -1)"><ArrowUp :size="14" /></button>
        <button :title="'下移'" @click="move(link.id, 1)"><ArrowDown :size="14" /></button>
        <button :title="link.pinned ? '取消置顶' : '置顶'" @click="emit('pin', link.id)">
          <Pin :size="14" :fill="link.pinned ? 'currentColor' : 'none'" />
        </button>
        <button :title="'编辑'" @click="emit('edit', link)"><Pencil :size="14" /></button>
        <button :title="'删除'" @click="emit('delete', link)"><Trash2 :size="14" /></button>
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
.link-card-wrap:hover .card-actions,
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
.card-actions .action-drag {
  cursor: grab;
  color: #a4aebd;
}

/* Responsive: reveal actions and keep cards tappable on small screens. */
@media (max-width: 850px) {
  .link-grid {
    --card-min: 244px;
  }
  .card-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 1px;
  }
  .link-card {
    min-height: 76px;
  }
  .link-card img {
    width: 36px;
    height: 36px;
  }
  .link-card p {
    display: none;
  }
}
</style>