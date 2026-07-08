<template>
  <div>
    <div class="flex items-center gap-3 px-3 py-2.5 rounded cursor-pointer hover:bg-white transition-colors text-sm">
      <button
        class="w-6 h-6 flex items-center justify-center text-stone-500 hover:text-amber-700"
        @click.stop="toggle"
        :aria-expanded="expanded.toString()"
        :title="expanded ? 'Collapse' : 'Expand'"
      >
        <svg :class="['w-4 h-4 transition-transform', expanded ? 'rotate-90' : '']" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M8 5v14l11-7L8 5z" fill="currentColor" />
        </svg>
      </button>

      <div class="flex items-center gap-3 flex-1" @click="openDir">
        <span class="text-2xl">📁</span>
        <span class="flex-1 truncate">{{ item.title || item.name }}</span>
      </div>

      <div class="text-xs text-stone-400">{{ itemCountText }}</div>
    </div>

    <div v-if="expanded" class="ml-6 border-l border-stone-100 pl-4 mt-2">
      <div v-if="loading" class="py-2 text-stone-400 text-sm">Loading…</div>
      <div v-else>
        <!-- child directories -->
        <FolderNode
          v-for="child in dirChildren"
          :key="child.id"
          :item="child"
        />

        <!-- child tracks -->
        <div v-for="track in tracks" :key="track.id"
             class="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer active:bg-white transition-colors text-sm group"
             @click.stop="playTrack(track)"
        >
          <span class="text-stone-400 flex-shrink-0">🎵</span>
          <span class="flex-1 truncate">{{ track.title || track.name }}</span>
          <span class="text-xs text-stone-400">{{ player.fmt(track.duration) }}</span>
          <button
            class="opacity-0 group-hover:opacity-100 text-stone-400 hover:text-amber-700 border border-stone-200 hover:border-amber-700 hover:bg-amber-50 px-2 py-0.5 rounded text-base leading-snug transition-all flex-shrink-0"
            @click.stop="addToQueue(track)"
          >+</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, inject, provide, watch } from 'vue'
import { useRouter } from 'vue-router'
import { usePlayerStore } from '../stores/player'
import { getDirectory } from '../api/subsonic'

defineOptions({ name: 'FolderNode' })

const props = defineProps({ item: { type: Object, required: true } })

const player = usePlayerStore()
const router = useRouter()

// accordion control from parent
const parentOpenChildId = inject('openChildId', null)
const parentSetOpen = inject('setOpenChild', null)

// provide an openChild controller for our children
const openChildId = ref(null)
provide('openChildId', openChildId)
provide('setOpenChild', (id) => { openChildId.value = id })

const expanded = ref(false)
const loading = ref(false)
const dirChildren = ref([])
const tracks = ref([])

const itemCountText = computed(() => {
  const c = (props.item.childCount || props.item.childCount === 0) ? props.item.childCount : ''
  return c ? `${c}` : ''
})

// react to parent's open child changes so siblings collapse
if (parentOpenChildId) {
  watch(parentOpenChildId, (val) => {
    expanded.value = (val === props.item.id)
  })
}

async function toggle() {
  if (parentSetOpen) {
    // tell parent to open/collapse this node; parent will drive expanded via watcher
    const currently = parentOpenChildId?.value
    parentSetOpen(currently === props.item.id ? null : props.item.id)
  } else {
    expanded.value = !expanded.value
  }

  if ((expanded.value || parentOpenChildId?.value === props.item.id) && !dirChildren.value.length && !tracks.value.length) {
    loading.value = true
    try {
      const res = await getDirectory(props.item.id)
      dirChildren.value = res.filter(i => i.isDir)
      tracks.value = res.filter(i => !i.isDir)
    } finally { loading.value = false }
  }
}

function openDir() {
  router.push(`/albums`)
}

function playTrack(track) {
  const songs = tracks.value
  const idx = songs.findIndex(s => s.id === track.id)
  player.playTrack(track, songs, idx >= 0 ? idx : 0)
}

function addToQueue(track) {
  player.addToQueue(track)
}
</script>
