<template>
  <div
    v-if="open"
    class="fixed inset-0 z-[100] flex items-start justify-center bg-stone-900/40 px-6 pt-24"
    @click.self="$emit('close')"
  >
    <div class="w-full max-w-2xl flex flex-col max-h-[70vh] bg-white border border-stone-200 rounded-xl shadow-xl">

      <div class="flex items-center justify-between px-5 py-4 border-b border-stone-200 flex-shrink-0">
        <h2 class="font-serif text-xl font-semibold">Ask AI</h2>
        <button class="text-stone-600 hover:text-stone-800 text-sm leading-none" @click="$emit('close')">✕</button>
      </div>

      <div class="px-5 py-4 border-b border-stone-100 flex-shrink-0">
        <form class="flex gap-2" @submit.prevent="onSubmit">
          <input
            ref="inputEl"
            v-model="query"
            type="text"
            placeholder="Ask about your library…"
            class="flex-1 text-sm px-3 py-2 rounded-lg border border-stone-200 bg-stone-50 placeholder-stone-400 focus:outline-none focus:border-amber-400 transition-colors"
            @keydown.escape="$emit('close')"
          />
          <button
            type="submit"
            class="flex-shrink-0 px-4 rounded-lg bg-amber-500 text-white text-sm font-medium hover:bg-amber-600 transition-colors"
          >Ask</button>
        </form>

        <div v-if="providers.length > 1" class="flex items-center gap-2 mt-2.5">
          <span class="text-xs text-stone-600">Provider</span>
          <select
            v-model="provider"
            class="text-xs px-2 py-1 rounded border border-stone-200 bg-stone-50 text-stone-600 focus:outline-none focus:border-amber-400"
          >
            <option v-for="p in providers" :key="p.id" :value="p.id">{{ p.label }}</option>
          </select>
        </div>
      </div>

      <div class="flex-1 overflow-y-auto">
        <div v-if="loading" class="py-12 text-center text-sm text-stone-600">Thinking…</div>

        <template v-else-if="reply">
          <div class="px-5 py-3 text-sm text-stone-700 bg-amber-50/50 border-b border-stone-100">{{ reply }}</div>
          <div v-if="!songs.length" class="py-12 text-center text-sm text-stone-600">No songs found</div>
          <TrackItem
            v-for="(track, i) in songs"
            :key="track.id"
            :track="track"
            :index="i"
            @play="player.playTrack(track, songs, i)"
            @queue="player.addToQueue(track)"
          />
        </template>

        <div v-else class="flex flex-col items-center gap-2 py-14 px-8 text-stone-500">
          <span class="text-4xl">✨</span>
          <span class="text-sm text-stone-600 text-center">Ask about your library, e.g. "all versions of Let's Dance by David Bowie"</span>
        </div>
      </div>

    </div>
  </div>
</template>

<script setup>
import { ref, watch, onMounted, nextTick } from 'vue'
import { askAI, fetchProviders } from '../api/chat'
import { usePlayerStore } from '../stores/player'
import TrackItem from './TrackItem.vue'

const props = defineProps({ open: Boolean })
defineEmits(['close'])

const player    = usePlayerStore()
const inputEl   = ref(null)
const query     = ref('')
const reply     = ref('')
const songs     = ref([])
const loading   = ref(false)
const providers = ref([])
const provider  = ref('')

onMounted(async () => {
  providers.value = await fetchProviders()
  provider.value = providers.value[0]?.id || ''
})

watch(() => props.open, async (open) => {
  if (open) {
    await nextTick()
    inputEl.value?.focus()
  }
})

async function onSubmit() {
  if (!query.value.trim()) return
  loading.value = true
  try {
    const res = await askAI(query.value.trim(), provider.value)
    reply.value = res.reply || ''
    songs.value = res.songs || []
  } catch (err) {
    reply.value = `Something went wrong: ${err.message}`
    songs.value = []
  } finally {
    loading.value = false
  }
}
</script>
