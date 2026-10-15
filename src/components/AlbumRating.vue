<template>
  <div v-if="r?.rating && full" class="text-xs text-stone-600 mb-1">
    <a :href="r.url" target="_blank" rel="noopener" class="hover:text-amber-700 transition-colors" :title="title">
      <span class="text-amber-700">★ {{ r.rating.toFixed(1) }}</span> · {{ r.votes.toLocaleString() }} votes on Discogs
    </a>
  </div>
  <span v-else-if="r?.rating" class="text-amber-700" :title="title">{{ (bare ? '★ ' : ' · ★ ') + r.rating.toFixed(1) }}</span>
</template>

<script setup>
import { computed } from 'vue'
import { useRatingsStore } from '../stores/ratings'

// The stored Discogs rating for a subsonic album object, or nothing. Compact
// " · ★ 4.3" for cards and lists (`bare` drops the leading dot, for a line of its
// own); `full` is the linked line for detail headers.
const props = defineProps({ album: { type: Object, default: null }, full: Boolean, bare: Boolean })

const ratings = useRatingsStore()
ratings.load()

const r = computed(() => ratings.of(props.album))
const title = computed(() =>
  (r.value?.releases ?? [])
    .map(x => `${[x.format, x.year, x.country].filter(Boolean).join(' · ')}: ${x.avg.toFixed(2)} (${x.votes})`)
    .join('\n'))
</script>
