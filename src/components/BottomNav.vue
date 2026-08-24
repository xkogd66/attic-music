<template>
  <nav class="fixed bottom-0 left-0 right-0 h-16 bg-white border-t border-stone-200 flex items-center justify-around z-50 md:hidden">
    <RouterLink
      v-for="item in navItems" :key="item.to"
      :to="item.to"
      class="flex-1 flex flex-col items-center justify-center gap-0.5 py-1 transition-colors"
      :class="isActive(item.to) ? 'text-amber-700' : 'text-stone-900'"
    >
      <component :is="item.icon" :size="22" />
      <span class="text-[10px] font-medium">{{ item.label }}</span>
    </RouterLink>
  </nav>
</template>

<script setup>
import { useRoute } from 'vue-router'
import { Home, Mic2, Disc3, ListMusic, Search, Wrench } from 'lucide-vue-next'

const route = useRoute()

const navItems = [
  { to: '/home',      icon: Home,      label: 'Home'      },
  { to: '/artists',   icon: Mic2,      label: 'Artists'   },
  { to: '/albums',    icon: Disc3,     label: 'Albums'    },
  { to: '/playlists', icon: ListMusic, label: 'Playlists' },
  { to: '/search',    icon: Search,    label: 'Search'    },
  { to: '/tools',     icon: Wrench,    label: 'Tools'     },
]

function isActive(path) {
  return route.path.startsWith(path)
}
</script>
