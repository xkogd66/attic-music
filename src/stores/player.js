import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useConfigStore } from './config'
import { scrobble, coverUrl } from '../api/subsonic'

export const usePlayerStore = defineStore('player', () => {
  const config = useConfigStore()

  // ── AUDIO ─────────────────────────────────────────────
  const audio = new Audio()
  audio.preload = 'auto'

  // ── STATE ─────────────────────────────────────────────
  const queue        = ref([])
  const currentIndex = ref(-1)
  const currentTrack = ref(null)
  const isPlaying    = ref(false)
  const shuffle      = ref(false)
  const repeat       = ref(false)
  const currentTime  = ref(0)
  const duration     = ref(0)

  const _savedVol = parseFloat(localStorage.getItem('attic_volume') ?? '1')
  const volume = ref(isNaN(_savedVol) ? 1 : Math.min(1, Math.max(0, _savedVol)))
  audio.volume = volume.value
  let _lastVolBeforeMute = volume.value || 1

  // scrobble tracking — reset per track
  let scrobbleSubmitted = false
  let scrobbleThreshold = Infinity

  // ── COMPUTED ──────────────────────────────────────────
  const progressPct = computed(() =>
    duration.value ? (currentTime.value / duration.value) * 100 : 0
  )

  // ── AUDIO EVENTS ──────────────────────────────────────
  audio.addEventListener('timeupdate', () => {
    currentTime.value = audio.currentTime
    if (!scrobbleSubmitted && audio.currentTime >= scrobbleThreshold) {
      scrobbleSubmitted = true
      scrobble(currentTrack.value.id, true).catch(() => {})
    }
    if ('mediaSession' in navigator && duration.value > 0) {
      try {
        navigator.mediaSession.setPositionState({
          duration:     duration.value,
          playbackRate: audio.playbackRate,
          position:     audio.currentTime,
        })
      } catch (_) {}
    }
  })
  audio.addEventListener('durationchange', () => {
    duration.value = isFinite(audio.duration) ? audio.duration : 0
    if (duration.value > 0) {
      scrobbleThreshold = Math.max(30, Math.min(duration.value * 0.5, 240))
    }
  })
  audio.addEventListener('play',  () => {
    isPlaying.value = true
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing'
  })
  audio.addEventListener('pause', () => {
    isPlaying.value = false
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused'
  })
  audio.addEventListener('ended', () => {
    if (repeat.value) { audio.currentTime = 0; audio.play() }
    else nextTrack()
  })

  // ── HELPERS ───────────────────────────────────────────
  function streamUrl(id) {
    const { server, username, password } = config
    const hex = Array.from(password).map(c => c.charCodeAt(0).toString(16).padStart(2,'0')).join('')
    return `${server}/rest/stream?u=${encodeURIComponent(username)}&p=enc:${hex}&v=1.16.1&c=atticweb&f=json&id=${id}&format=raw`
  }

  // ── PLAYBACK ──────────────────────────────────────────
  function startTrack(track) {
    scrobbleSubmitted = false
    scrobbleThreshold = Infinity
    currentTrack.value = track
    audio.src = streamUrl(track.id)
    audio.play().catch(e => { if (e.name !== 'AbortError') console.error('[player] play failed:', e) })
    scrobble(track.id, false).catch(() => {})
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title:   track.title  || '',
        artist:  track.artist || '',
        album:   track.album  || '',
        artwork: track.coverArt
          ? [{ src: coverUrl(track.coverArt, 512), sizes: '512x512', type: 'image/jpeg' }]
          : [],
      })
    }
  }

  function playFromQueue(index) {
    if (index < 0 || index >= queue.value.length) return
    currentIndex.value = index
    startTrack(queue.value[index])
  }

  function playTrack(track, trackList = null, index = 0) {
    if (trackList) {
      queue.value = [...trackList]
      currentIndex.value = index
    }
    startTrack(track)
  }

  function togglePlay() {
    if (!currentTrack.value) return
    if (isPlaying.value) audio.pause()
    else audio.play()
  }

  function nextTrack() {
    if (!queue.value.length) return
    if (shuffle.value) {
      playFromQueue(Math.floor(Math.random() * queue.value.length))
    } else {
      const next = currentIndex.value + 1
      if (next < queue.value.length) playFromQueue(next)
    }
  }

  function prevTrack() {
    if (audio.currentTime > 3) { audio.currentTime = 0; return }
    const prev = currentIndex.value - 1
    if (prev >= 0) playFromQueue(prev)
  }

  function addToQueue(track)  { queue.value.push(track) }
  function clearQueue()       { queue.value = []; currentIndex.value = -1 }
  function jumpToQueue(index) { playFromQueue(index) }

  function setVolume(v) {
    const clamped = Math.min(1, Math.max(0, v))
    volume.value = clamped
    audio.volume = clamped
    localStorage.setItem('attic_volume', String(clamped))
  }

  function toggleMute() {
    if (volume.value > 0) {
      _lastVolBeforeMute = volume.value
      setVolume(0)
    } else {
      setVolume(_lastVolBeforeMute || 1)
    }
  }

  function seek(event, el) {
    if (!duration.value) return
    const rect = el.getBoundingClientRect()
    audio.currentTime = ((event.clientX - rect.left) / rect.width) * duration.value
  }

  function fmt(secs) {
    if (!secs && secs !== 0) return '—'
    const s = Math.floor(secs)
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  }

  // ── MEDIA SESSION ACTIONS ─────────────────────────────
  if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('play',          () => audio.play())
    navigator.mediaSession.setActionHandler('pause',         () => audio.pause())
    navigator.mediaSession.setActionHandler('nexttrack',     () => nextTrack())
    navigator.mediaSession.setActionHandler('previoustrack', () => prevTrack())
    navigator.mediaSession.setActionHandler('seekto', ({ seekTime }) => {
      if (seekTime != null) audio.currentTime = seekTime
    })
  }

  return {
    queue, currentIndex, currentTrack, isPlaying,
    shuffle, repeat, currentTime, duration, progressPct, volume,
    playTrack, playFromQueue, togglePlay,
    nextTrack, prevTrack, addToQueue, clearQueue, jumpToQueue,
    seek, fmt, setVolume, toggleMute,
  }
})