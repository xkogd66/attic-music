<template>
  <div class="h-screen flex items-center justify-center bg-stone-50">
    <div class="w-96 bg-white border border-stone-200 p-12">
      <h1 class="font-serif text-5xl font-semibold mb-1">attic music</h1>
      <p class="text-stone-400 text-sm mb-8">a client for subsonic</p>

      <div class="space-y-4">
        <div>
          <label class="block text-xs font-medium uppercase tracking-widest text-stone-400 mb-1.5">Server URL</label>
          <input v-model="form.server" class="input" placeholder="https://gonic.example.com" @keyup.enter="login" />
        </div>
        <div>
          <label class="block text-xs font-medium uppercase tracking-widest text-stone-400 mb-1.5">Username</label>
          <input v-model="form.username" class="input" autocomplete="username" @keyup.enter="login" />
        </div>
        <div>
          <label class="block text-xs font-medium uppercase tracking-widest text-stone-400 mb-1.5">Password</label>
          <input v-model="form.password" type="password" class="input" autocomplete="current-password" @keyup.enter="login" />
        </div>
      </div>

      <div v-if="config.turnstileSiteKey" ref="turnstileEl" class="mt-4"></div>

      <button
        class="mt-6 w-full bg-stone-900 text-white text-sm font-medium tracking-wide py-3 hover:bg-amber-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        @click="login"
        :disabled="logging || (config.turnstileSiteKey && !turnstileToken)"
      >
        {{ logging ? 'Connecting…' : 'Connect' }}
      </button>

      <p v-if="error" class="mt-3 text-sm text-amber-700">{{ error }}</p>
    </div>
  </div>
</template>

<script setup>
import { reactive, ref, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useConfigStore } from '../stores/config'
import { ping } from '../api/subsonic'

const config  = useConfigStore()
const router  = useRouter()

const logging        = ref(false)
const error          = ref('')
const turnstileEl    = ref(null)
const turnstileToken = ref('')
const widgetId       = ref(null)

const form = reactive({
  server:   '',
  username: '',
  password: '',
})

onMounted(async () => {
  form.server   = config.server
  form.username = config.username
  form.password = config.password

  if (!config.turnstileSiteKey) return

  if (!window.turnstile) {
    await new Promise((resolve) => {
      const script = document.createElement('script')
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
      script.onload = resolve
      document.head.appendChild(script)
    })
  }

  widgetId.value = window.turnstile.render(turnstileEl.value, {
    sitekey: config.turnstileSiteKey,
    callback:           (token) => { turnstileToken.value = token },
    'expired-callback': ()      => { turnstileToken.value = '' },
    'error-callback':   ()      => { turnstileToken.value = '' },
  })
})

onUnmounted(() => {
  if (widgetId.value !== null && window.turnstile) {
    window.turnstile.remove(widgetId.value)
  }
})

async function login() {
  if (config.turnstileSiteKey && !turnstileToken.value) return
  error.value   = ''
  logging.value = true
  try {
    config.server   = form.server.replace(/\/$/, '')
    config.username = form.username
    config.password = form.password
    await ping()
    config.saveSession()
    router.push('/')
  } catch(e) {
    error.value = 'Could not connect — check URL and credentials.'
    if (widgetId.value !== null && window.turnstile) {
      window.turnstile.reset(widgetId.value)
      turnstileToken.value = ''
    }
  } finally {
    logging.value = false
  }
}
</script>

<style scoped>
@reference "../style.css";

.input {
  @apply w-full border border-stone-200 bg-stone-50 px-3 py-2.5 text-sm text-stone-900 outline-none focus:border-amber-700 transition-colors;
}
</style>
