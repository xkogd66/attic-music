<template>
  <!-- Single-series vertical bar chart, plain HTML. Hover/focus a bar to read its
       value in the header; selectable charts emit `select` with the bar's key. -->
  <div>
    <div class="flex items-baseline justify-between mb-2 gap-2">
      <h2 class="text-xs font-medium uppercase tracking-widest text-stone-600">{{ title }}</h2>
      <span class="text-xs text-stone-600 tabular-nums">
        {{ hovered ? `${hovered.label} · ${hovered.value.toLocaleString()} plays` : '' }}
      </span>
    </div>
    <div class="flex items-end gap-0.5 h-32 border-b border-stone-200">
      <button
        v-for="b in bars" :key="b.key"
        type="button"
        class="flex-1 h-full flex items-end focus:outline-none"
        :class="selectable ? 'cursor-pointer' : 'cursor-default'"
        :aria-label="`${b.label}: ${b.value.toLocaleString()} plays`"
        :aria-pressed="selectable ? selected === b.key : undefined"
        @mouseenter="hovered = b" @mouseleave="hovered = null"
        @focus="hovered = b" @blur="hovered = null"
        @click="selectable && $emit('select', b.key)"
      >
        <div
          class="w-full rounded-t transition-colors"
          :class="barClass(b)"
          :style="{ height: b.value ? `max(2px, ${(b.value / max) * 100}%)` : '0' }"
        />
      </button>
    </div>
    <div class="flex gap-0.5 mt-1">
      <span
        v-for="b in bars" :key="b.key"
        class="flex-1 text-center text-[10px] text-stone-500 truncate"
      >{{ b.short ?? b.label }}</span>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'

// bars: [{ key, label, short?, value }]
const props = defineProps({
  title:      { type: String, required: true },
  bars:       { type: Array,  required: true },
  selectable: { type: Boolean, default: false },
  selected:   { default: null },
})
defineEmits(['select'])

const hovered = ref(null)
const max = computed(() => Math.max(1, ...props.bars.map(b => b.value)))

function barClass(b) {
  if (hovered.value?.key === b.key) return 'bg-amber-800'
  if (props.selected === null) return 'bg-amber-600'
  return props.selected === b.key ? 'bg-amber-700' : 'bg-amber-200'
}
</script>
