import { ref } from 'vue'

// Shared "pick a cover" modal: search Last.fm candidates, then upload a
// chosen one or a device file to the sidecar. Building the sidecar URL and
// applying the result (album cover vs. artist avatar have different
// endpoints and different post-upload state to update) stays with the caller.
export function useCoverSearch() {
  const open       = ref(false)
  const loading    = ref(false)
  const candidates = ref([])
  const target     = ref('album') // caller-defined tag, e.g. 'album' | 'avatar'
  const saving     = ref(false)
  const error      = ref('')

  async function search(searchTarget, searchFn) {
    target.value      = searchTarget
    error.value       = ''
    open.value        = true
    loading.value     = true
    candidates.value  = []
    try {
      candidates.value = await searchFn()
    } finally {
      loading.value = false
    }
  }

  function close() {
    open.value = false
  }

  // POSTs `body` (a File or Blob) to the sidecar endpoint; on success calls
  // onSuccess() and closes the modal, on failure sets `error` and leaves it open.
  async function upload(url, body, filename, onSuccess) {
    saving.value = true
    try {
      const form = new FormData()
      form.append('cover', body, filename)
      const res = await fetch(url, { method: 'POST', body: form })
      if (res.ok) {
        onSuccess()
        open.value = false
      } else {
        error.value = (await res.text().catch(() => '')) || `Save failed (${res.status})`
      }
    } catch (_) {
      error.value = 'Save failed — network error'
    } finally {
      saving.value = false
    }
  }

  // Fetches bytes from a remote candidate URL and uploads them, same path as
  // a device upload. Last.fm's CDN picks the format from Accept — the
  // browser's default asks for WebP, which gonic (Go stdlib) can't decode.
  // cache: reload because the modal's <img> preview already cached the WebP
  // variant and the CDN sends no Vary: Accept.
  async function uploadFromUrl(sourceUrl, uploadUrl, filename, onSuccess) {
    try {
      const blob = await (await fetch(sourceUrl, { cache: 'reload', headers: { Accept: 'image/jpeg,image/png' } })).blob()
      await upload(uploadUrl, blob, filename, onSuccess)
    } catch (_) {
      error.value = 'Save failed — could not fetch the image'
    }
  }

  return { open, loading, candidates, target, saving, error, search, close, upload, uploadFromUrl }
}
