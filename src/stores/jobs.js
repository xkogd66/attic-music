// App-level (not component-local) tracking for the async maintenance jobs
// started from Tools.vue. Living in a Pinia store — instead of refs inside
// Tools.vue — means navigating away from the Tools route and back doesn't
// wipe activeJobs/result: the jobs on the sidecar keep running either way,
// this just stops the UI from losing track of them.
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { getJob } from '../api/maintenance'

export const useJobsStore = defineStore('jobs', () => {
  const activeJobs = ref([])   // running jobs: { id, label, status, message, progress, total, … }
  const result      = ref(null) // latest finished job → { ok, data } | { ok: false, error }
  let pollTimer     = null

  const busy = computed(() => activeJobs.value.some(j => j.status === 'running'))

  function launchJob(startFn, label) {
    startFn()
      .then(({ id }) => {
        activeJobs.value.push({ id, label, status: 'running', message: 'queued…', progress: 0, total: 0 })
        ensurePolling()
      })
      .catch(e => {
        result.value = { ok: false, error: e.message || String(e) }
      })
  }

  function ensurePolling() {
    if (pollTimer) return
    pollTimer = setInterval(pollJobs, 1500)
  }

  async function pollJobs() {
    const running = activeJobs.value.filter(j => j.status === 'running')
    if (!running.length) { stopPolling(); return }
    const states = await Promise.all(running.map(j => getJob(j.id).catch(() => null)))
    for (const job of activeJobs.value) {
      const st = states.find(s => s && s.id === job.id)
      if (st) Object.assign(job, st)   // label is preserved — server state has none
    }
    const finished = activeJobs.value.filter(j => j.status !== 'running')
    if (finished.length) {
      result.value = jobToResult(finished[finished.length - 1])
    }
    activeJobs.value = activeJobs.value.filter(j => j.status === 'running')
    if (!activeJobs.value.length) stopPolling()
  }

  function stopPolling() {
    clearInterval(pollTimer)
    pollTimer = null
  }

  // Map a finished job onto the shape the result panel renders.
  function jobToResult(job) {
    if (job.status === 'error') return { ok: false, error: job.error || 'job failed' }
    if (job.data && (job.data.problems || job.data.album)) return { ok: true, data: job.data }
    return { ok: true, data: { changes: job.changes || [], applied: job.applied, op: job.op } }
  }

  return { activeJobs, result, busy, launchJob }
})
