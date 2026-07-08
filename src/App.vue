<template>
  <div v-if="ready" class="h-screen flex flex-col bg-stone-50 text-stone-900 overflow-hidden">

    <!-- DESKTOP: sidebar + content -->
    <div class="hidden md:flex flex-1 overflow-hidden">
      <SideBar />
      <main class="flex-1 flex flex-col overflow-hidden">
        <RouterView />
      </main>
    </div>

    <!-- MOBILE: full width content -->
    <div class="flex md:hidden flex-1 flex-col overflow-hidden">
      <RouterView />
    </div>

    <!-- PLAYER (handles desktop footer + mobile mini/full/bottomnav internally) -->
    <Player v-if="config.loggedIn" />

    <!-- LOGIN (shown over everything when not logged in) -->
    <div v-if="!config.loggedIn" class="fixed inset-0 z-50">
      <RouterView />
    </div>

  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useConfigStore } from './stores/config'
import SideBar from './components/SideBar.vue'
import Player  from './components/Player.vue'

const config = useConfigStore()
const ready  = ref(false)

onMounted(async () => {
  await config.load()
  ready.value = true
})
</script>