<template>
  <div class="flex flex-col flex-1 min-h-0 overflow-hidden">

    <div class="px-4 md:px-6 py-3 md:py-6 border-b border-stone-200 bg-white flex-shrink-0">
      <div class="flex items-center justify-between">
        <h1 class="font-serif text-3xl font-semibold">Library Tools</h1>
        <button
          class="text-xs border border-stone-200 rounded-full px-3 py-1.5 text-stone-600 hover:border-amber-700 hover:text-amber-700 transition-colors disabled:opacity-50"
          :disabled="scanning"
          @click="rescan"
        >
          {{ scanning ? 'Scanning…' : '↻ Rescan library' }}
        </button>
      </div>
      <p class="text-sm text-stone-500 mt-1">
        The musiclib maintenance workflows (audit · cleanup · artwork · convert · enrich) now live in the browser.
      </p>
    </div>

    <div class="flex-1 overflow-y-auto px-4 md:px-6 py-4 space-y-4">

      <!-- RUNNING JOBS (ops are async: POST starts a job, poll shows progress) -->
      <section v-if="activeJobs.length" class="bg-white rounded-xl border border-stone-200 p-4">
        <h2 class="text-xs font-medium uppercase tracking-widest text-stone-600 mb-2">Running jobs</h2>
        <div v-for="job in activeJobs" :key="job.id" class="py-2 border-b border-stone-100 last:border-b-0">
          <div class="flex items-center justify-between gap-2 text-sm">
            <span class="font-medium truncate">{{ job.label }}</span>
            <span class="text-xs text-stone-500 flex-shrink-0">{{ job.status }}</span>
          </div>
          <div class="text-xs text-stone-500 truncate">{{ job.message }}</div>
          <div class="mt-1 h-1.5 bg-stone-100 rounded-full overflow-hidden">
            <div
              v-if="job.total"
              class="h-full bg-amber-700 transition-all"
              :style="{ width: Math.min(100, Math.round(job.progress / job.total * 100)) + '%' }"
            ></div>
            <div v-else class="h-full w-1/3 bg-amber-700 animate-pulse"></div>
          </div>
        </div>
      </section>

      <!-- PICKER (album, or every album by one artist) -->
      <section class="bg-white rounded-xl border border-stone-200 p-4">
        <div class="flex items-center justify-between mb-2">
          <h2 class="text-xs font-medium uppercase tracking-widest text-stone-600">{{ pickerMode === 'artist' ? 'Artist' : pickerMode === 'letter' ? 'Letter' : 'Album' }}</h2>
          <div v-if="!selected && !selectedArtist && !selectedLetter" class="flex text-xs border border-stone-200 rounded-full overflow-hidden flex-shrink-0">
            <button
              class="px-2.5 py-1 transition-colors"
              :class="pickerMode === 'album' ? 'bg-amber-700 text-white' : 'text-stone-600 hover:bg-amber-50'"
              @click="setPickerMode('album')"
            >Album</button>
            <button
              class="px-2.5 py-1 transition-colors"
              :class="pickerMode === 'artist' ? 'bg-amber-700 text-white' : 'text-stone-600 hover:bg-amber-50'"
              @click="setPickerMode('artist')"
            >Artist</button>
            <button
              class="px-2.5 py-1 transition-colors"
              :class="pickerMode === 'letter' ? 'bg-amber-700 text-white' : 'text-stone-600 hover:bg-amber-50'"
              @click="setPickerMode('letter')"
            >Letter</button>
          </div>
        </div>
        <p class="text-xs text-stone-500 mb-3">
          Run an operation on a single album, or every album by one artist — or pick a letter to audit that whole ./mp3/&lt;letter&gt;/ folder.
        </p>

        <div v-if="pickerMode === 'letter' && !selectedLetter" class="flex flex-wrap gap-1.5">
          <button
            v-for="l in LETTERS"
            :key="l"
            class="w-8 h-8 text-sm rounded border border-stone-200 uppercase hover:border-amber-700 hover:text-amber-700 transition-colors"
            @click="pickLetter(l)"
          >{{ l }}</button>
        </div>

        <div v-else-if="!selected && !selectedArtist && !selectedLetter" class="relative">
          <input
            v-model="query"
            type="search"
            :placeholder="pickerMode === 'artist' ? 'Search artists…' : 'Search albums…'"
            class="w-full text-sm bg-stone-100 rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-amber-700"
            @input="onQueryInput"
          />
          <div
            v-if="pickerMode === 'album' && results && results.albums.length"
            class="absolute left-0 right-0 z-50 mt-1 bg-white border border-stone-200 rounded-lg shadow-lg max-h-80 overflow-y-auto"
          >
            <button
              v-for="a in results.albums"
              :key="a.id"
              class="w-full text-left px-3 py-2 text-sm hover:bg-amber-50 transition-colors"
              @click="pickAlbum(a)"
            >
              <div class="truncate">{{ a.name }}</div>
              <div class="text-xs text-stone-600 truncate">{{ a.artist }}</div>
            </button>
          </div>
          <div
            v-else-if="pickerMode === 'artist' && results && results.artists.length"
            class="absolute left-0 right-0 z-50 mt-1 bg-white border border-stone-200 rounded-lg shadow-lg max-h-80 overflow-y-auto"
          >
            <button
              v-for="a in results.artists"
              :key="a.id"
              class="w-full text-left px-3 py-2 text-sm hover:bg-amber-50 transition-colors"
              @click="pickArtist(a)"
            >
              <div class="truncate">{{ a.name }}</div>
            </button>
          </div>
          <div
            v-else-if="query && results && !(pickerMode === 'artist' ? results.artists.length : results.albums.length)"
            class="absolute left-0 right-0 z-50 mt-1 bg-white border border-stone-200 rounded-lg shadow px-3 py-2 text-xs text-stone-600"
          >No matching {{ pickerMode === 'artist' ? 'artists' : 'albums' }}</div>
        </div>

        <div v-else-if="selectedLetter" class="flex items-center gap-3">
          <div class="flex-1 min-w-0">
            <div class="text-sm font-medium uppercase">Letter “{{ selectedLetter }}”</div>
          </div>
          <button class="text-xs text-stone-500 hover:text-amber-700" @click="clearLetter">✕ Clear</button>
        </div>

        <div v-else-if="selected" class="flex items-center gap-3">
          <img
            v-if="selected.coverArt"
            :src="coverUrl(selected.coverArt, 60)"
            class="w-12 h-12 rounded object-cover"
            loading="lazy"
          />
          <div class="flex-1 min-w-0">
            <div class="text-sm font-medium truncate">{{ selected.name }}</div>
            <div class="text-xs text-stone-600 truncate">{{ selected.artist }}</div>
          </div>
          <button class="text-xs text-stone-500 hover:text-amber-700" @click="clearAlbum">✕ Clear</button>
        </div>

        <div v-else class="flex items-center gap-3">
          <div class="flex-1 min-w-0">
            <div class="text-sm font-medium truncate">{{ selectedArtist.name }}</div>
            <div class="text-xs text-stone-600 truncate">
              {{ selectedArtist.albums.length }} album{{ selectedArtist.albums.length !== 1 ? 's' : '' }}
            </div>
          </div>
          <button class="text-xs text-stone-500 hover:text-amber-700" @click="clearArtist">✕ Clear</button>
        </div>
      </section>

      <!-- AUDIT -->
      <section class="bg-white rounded-xl border border-stone-200 p-4">
        <h2 class="text-xs font-medium uppercase tracking-widest text-stone-600 mb-2">Audit (read-only)</h2>
        <div class="flex gap-2 flex-wrap">
          <button v-if="!selectedLetter" class="btn" :disabled="(!selected && !selectedArtist) || busy" @click="doAuditAlbum">
            {{ selectedArtist ? 'Audit this artist' : 'Audit this album' }}
          </button>
          <button v-else class="btn" :disabled="busy" @click="doAuditLetter">Audit letter “<span class="uppercase">{{ selectedLetter }}</span>”</button>
          <button class="btn" :disabled="busy" @click="doAuditLibrary">Audit whole library</button>
        </div>
        <p class="text-xs text-stone-500 mt-2">
          Reports junk tags (outside the golden set) and cross-track conflicts on album / album artist / year.
        </p>
      </section>

      <!-- CLEANUP -->
      <section v-if="selected || selectedArtist" class="bg-white rounded-xl border border-stone-200 p-4">
        <h2 class="text-xs font-medium uppercase tracking-widest text-stone-600 mb-2">Tag cleanup</h2>
        <div class="divide-y divide-stone-100">
          <div v-for="c in CLEANUPS" :key="c.op" class="py-2.5 flex items-start gap-3">
            <div class="flex-1 min-w-0">
              <div class="text-sm font-medium">{{ c.title }}</div>
              <div class="text-xs text-stone-500">{{ c.desc }}</div>
            </div>
            <button class="btn btn-ghost" :disabled="busy" @click="cleanupPreview(c.op)">Preview</button>
            <button class="btn btn-danger" :disabled="busy" @click="cleanupApply(c.op)">Apply</button>
          </div>
        </div>
      </section>

      <!-- ARTWORK -->
      <section v-if="selected || selectedArtist" class="bg-white rounded-xl border border-stone-200 p-4">
        <h2 class="text-xs font-medium uppercase tracking-widest text-stone-600 mb-2">Artwork</h2>
        <div class="flex gap-2 flex-wrap">
          <button class="btn" :disabled="busy" @click="doNormalize">Normalize cover.jpg</button>
          <button class="btn" :disabled="busy" @click="doReEmbed">Re-embed cover into tracks</button>
        </div>
        <p class="text-xs text-stone-500 mt-2">
          Normalize re-encodes the folder art as a real JPEG gonic can read; re-embed writes it into every mp3's APIC frame.
        </p>
      </section>

      <!-- CONVERT -->
      <section v-if="selected || selectedArtist" class="bg-white rounded-xl border border-stone-200 p-4">
        <h2 class="text-xs font-medium uppercase tracking-widest text-stone-600 mb-2">Convert</h2>
        <div class="flex items-center gap-2 flex-wrap">
          <select v-model="convTo" class="text-sm border border-stone-200 rounded px-2 py-1.5">
            <option value="mp3">FLAC / M4A / MP4 → MP3 320kbps</option>
            <option value="flac">WAV → FLAC (lossless)</option>
          </select>
          <input
            v-if="convTo === 'mp3'"
            v-model="convBitrate"
            class="text-sm border border-stone-200 rounded px-2 py-1.5 w-24"
            placeholder="320k"
          />
          <label class="text-xs text-stone-600 flex items-center gap-1.5 cursor-pointer">
            <input v-model="convDelete" type="checkbox" class="accent-amber-700" />
            delete originals
          </label>
        </div>
        <div class="mt-3 flex gap-2 flex-wrap">
          <button class="btn" :disabled="busy" @click="convertPreview">Preview</button>
          <button class="btn btn-danger" :disabled="busy" @click="convertApply">Convert album</button>
        </div>
        <p class="text-xs text-stone-500 mt-2">Needs ffmpeg in the sidecar container; runs on the NFS share.</p>
      </section>

      <!-- ENRICH -->
      <section v-if="selected || selectedArtist" class="bg-white rounded-xl border border-stone-200 p-4">
        <h2 class="text-xs font-medium uppercase tracking-widest text-stone-600 mb-2">Enrich</h2>
        <div class="space-y-2">
          <div class="flex items-start gap-3">
            <div class="flex-1 min-w-0">
              <div class="text-sm font-medium">Genre + year</div>
              <div class="text-xs text-stone-500">MusicBrainz, Last.fm fallback — only fills missing values</div>
              <label class="text-xs text-stone-600 flex items-center gap-1.5 cursor-pointer mt-1">
                <input v-model="overwriteYear" type="checkbox" class="accent-amber-700" />
                overwrite existing year with MusicBrainz' oldest release date
              </label>
            </div>
            <button class="btn btn-ghost" :disabled="busy" @click="enrichPreview">Preview</button>
            <button class="btn" :disabled="busy" @click="enrichApply">Apply</button>
          </div>
          <div class="flex items-start gap-3">
            <div class="flex-1 min-w-0">
              <div class="text-sm font-medium">Lyrics</div>
              <div class="text-xs text-stone-500">LRCLIB → embeds USLT + writes a .lrc sidecar</div>
            </div>
            <button class="btn btn-ghost" :disabled="busy" @click="lyricsPreview">Preview</button>
            <button class="btn" :disabled="busy" @click="lyricsApply">Apply</button>
          </div>
        </div>
      </section>


      <!-- RESULT -->
      <section v-if="result" class="bg-white rounded-xl border border-stone-200 p-4">
        <div class="flex items-center justify-between mb-2">
          <h2 class="text-xs font-medium uppercase tracking-widest text-stone-600">Result</h2>
          <button class="text-xs text-stone-400 hover:text-stone-600" @click="result = null">✕</button>
        </div>

        <div v-if="!result.ok" class="text-sm text-red-600 whitespace-pre-wrap">{{ result.error }}</div>

        <template v-else>
          <!-- whole-library audit -->
          <template v-if="result.data.problems">
            <div class="text-sm text-stone-600 mb-2">
              Scanned <span class="font-medium">{{ result.data.scanned }}</span> albums —
              <span class="font-medium">{{ result.data.problems.length }}</span> with issues.
            </div>
            <div v-if="!result.data.problems.length" class="text-sm text-emerald-700">All clean ✓</div>
            <div v-else class="space-y-3 max-h-96 overflow-y-auto pr-1">
              <div v-for="p in result.data.problems" :key="p.folder" class="border border-stone-200 rounded-lg p-3">
                <div class="text-sm font-medium">{{ p.folder }} <span class="text-xs text-stone-500">({{ p.trackCount }} tracks)</span></div>
                <div v-if="p.missing.length" class="text-xs text-amber-700 mt-1">missing: {{ p.missing.join(', ') }}</div>
                <div v-if="p.junkTags.length" class="text-xs text-stone-600 mt-1">junk tags: {{ p.junkTags.join(', ') }}</div>
                <div v-for="(vmap, label) in p.conflicts" :key="label" class="mt-1">
                  <div class="text-xs font-medium text-red-600">conflict — {{ label }}:</div>
                  <div v-for="(files, value) in vmap" :key="value" class="text-xs text-stone-600 pl-3">
                    “{{ value }}” · {{ files.length }} track{{ files.length !== 1 ? 's' : '' }}
                  </div>
                </div>
              </div>
            </div>
          </template>

          <!-- single-album audit -->
          <template v-else-if="result.data.album">
            <div class="border border-stone-200 rounded-lg p-3">
              <div class="text-sm font-medium">
                {{ result.data.album.folder }}
                <span class="text-xs text-stone-500">({{ result.data.album.trackCount }} tracks)</span>
              </div>
              <div
                v-if="!result.data.album.missing.length && !result.data.album.junkTags.length && !Object.keys(result.data.album.conflicts).length"
                class="text-sm text-emerald-700 mt-1"
              >All clean ✓</div>
              <div v-if="result.data.album.missing.length" class="text-xs text-amber-700 mt-1">
                missing: {{ result.data.album.missing.join(', ') }}
              </div>
              <div v-if="result.data.album.junkTags.length" class="text-xs text-stone-600 mt-1">
                junk tags: {{ result.data.album.junkTags.join(', ') }}
              </div>
              <div v-for="(vmap, label) in result.data.album.conflicts" :key="label" class="mt-1">
                <div class="text-xs font-medium text-red-600">conflict — {{ label }}:</div>
                <div v-for="(files, value) in vmap" :key="value" class="text-xs text-stone-600 pl-3">
                  “{{ value }}” · {{ files.length }} track{{ files.length !== 1 ? 's' : '' }}
                </div>
              </div>
            </div>
          </template>

          <!-- changes (cleanup / artwork / convert / enrich) -->
          <template v-else-if="result.data.changes !== undefined">
            <div class="flex items-center gap-2 mb-2">
              <span
                class="text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded-full"
                :class="result.data.applied !== false ? 'bg-amber-100 text-amber-800' : 'bg-stone-100 text-stone-600'"
              >{{ result.data.applied !== false ? 'applied' : 'preview' }}</span>
              <span v-if="result.data.op" class="text-xs text-stone-500">{{ result.data.op }}</span>
              <span v-if="result.data.to" class="text-xs text-stone-500">→ {{ result.data.to }}</span>
            </div>
            <div v-if="!result.data.changes.length" class="text-sm text-stone-500">Nothing to change.</div>
            <div v-else class="max-h-96 overflow-y-auto pr-1 space-y-1">
              <div v-for="(ch, i) in result.data.changes" :key="i" class="text-xs font-mono text-stone-700 border-b border-stone-100 pb-1">
                <span class="text-stone-400">{{ ch.file }}</span> — {{ ch.detail }}
              </div>
            </div>
          </template>
        </template>
      </section>

      <p class="text-[11px] text-stone-400 px-1">
        Tag changes are written straight to the mp3s on the NFS share — hit “↻ Rescan library” afterwards so gonic re-indexes them.
      </p>
    </div>
  </div>
</template>


<script setup>
import { ref, onUnmounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useConfigStore } from '../stores/config'
import { useJobsStore } from '../stores/jobs'
import { search, getArtist, coverUrl, startScan, getScanStatus } from '../api/subsonic'
import {
  startAudit, startCleanup, startNormalizeCover, startReEmbedCover,
  startConvert, startEnrich, startEnrichLyrics,
} from '../api/maintenance'

const config = useConfigStore()
const jobsStore = useJobsStore()
const { activeJobs, result, busy } = storeToRefs(jobsStore)
const { launchJob } = jobsStore

// ── picker: a single album, every album by one artist, or an on-disk
// ── letter folder (./mp3/<letter>/*, letter-mode audit only) ───
const pickerMode     = ref('album')  // 'album' | 'artist' | 'letter'
const query          = ref('')
const results        = ref(null)
const selected       = ref(null)   // a subsonic album: { id, name, artist, albumArtist, coverArt }
const selectedArtist = ref(null)   // { id, name, albums: [subsonic album, …] }
const selectedLetter = ref(null)   // on-disk letter dir name, e.g. 'a' or '1'
const LETTERS = [...'abcdefghijklmnopqrstuvwxyz', '1']
let debounce          = null

function setPickerMode(m) {
  pickerMode.value = m
  query.value = ''
  results.value = null
}

function pickLetter(l) {
  selectedLetter.value = l
  result.value = null
}
function clearLetter() {
  selectedLetter.value = null
  result.value = null
}

function onQueryInput() {
  clearTimeout(debounce)
  const q = query.value.trim()
  if (!q) { results.value = null; return }
  debounce = setTimeout(async () => {
    try { results.value = await search(q) } catch { results.value = null }
  }, 300)
}

function pickAlbum(a) {
  selected.value = a
  selectedArtist.value = null
  query.value = ''
  results.value = null
  result.value = null
}

async function pickArtist(a) {
  selected.value = null
  query.value = ''
  results.value = null
  result.value = null
  try {
    const { albums } = await getArtist(a.id)
    selectedArtist.value = { id: a.id, name: a.name, albums }
  } catch (e) {
    result.value = { ok: false, error: e.message || String(e) }
  }
}

function clearAlbum() {
  selected.value = null
  result.value = null
}

function clearArtist() {
  selectedArtist.value = null
  result.value = null
}

// The on-disk identity the sidecar resolves the folder by, for every album the
// current selection covers — same convention as the tag-save UI: albumArtist ||
// artist, plus the album name. Artist mode uses the picked artist's own name for
// every album, since that's the name Subsonic grouped them under (the physical
// artist folder), not each album's own artist/albumArtist tag.
function targets() {
  if (selectedArtist.value) {
    return selectedArtist.value.albums.map(al => ({ artist: selectedArtist.value.name, album: al.name || '' }))
  }
  if (selected.value) {
    const a = selected.value
    return [{ artist: a.albumArtist || a.artist || '', album: a.name || '' }]
  }
  return []
}

// Job progress/results now live in useJobsStore (../stores/jobs.js) instead
// of local refs, so navigating away from this view and back doesn't lose
// track of a still-running (or just-finished) job — the sidecar job itself
// was always fire-and-forget from the browser's perspective either way.

// ── audit ────────────────────────────────────────────────────
function doAuditAlbum() {
  for (const t of targets()) {
    launchJob(() => startAudit({ artist: t.artist, album: t.album }), `Audit ${t.album}`)
  }
}
function doAuditLetter() {
  if (!selectedLetter.value) return
  launchJob(() => startAudit({ scope: 'letter', letter: selectedLetter.value }), `Audit letter "${selectedLetter.value}"`)
}
function doAuditLibrary() {
  launchJob(() => startAudit({ scope: 'all' }), 'Audit whole library')
}

// ── tag cleanup ──────────────────────────────────────────────
const CLEANUPS = [
  { op: 'sort-tags',     title: 'Delete sort tags',        desc: 'Removes TSOP, TSO2, TSOA, TSOT, TSOS, TSOC, TSOO, XSOP' },
  { op: 'golden-set',    title: 'Sanitize to golden set',  desc: 'Wipes every non-golden frame, then aligns grouping tags (album, album artist, year, disc, compilation) to the first track' },
  { op: 'lowercase',     title: 'Lowercase all text tags', desc: 'Lowercases every text frame value — nuclear, only for a fresh-ripped library' },
  { op: 'from-filename', title: 'Tag from filename',       desc: 'Parses "Artist - Title" / "NN - Title" into TIT2/TPE1' },
]

function cleanupPreview(op) {
  for (const t of targets()) {
    launchJob(() => startCleanup(t.artist, t.album, op), `Preview ${op} — ${t.album}`)
  }
}
function cleanupApply(op) {
  const ts = targets(); if (!ts.length) return
  const scope = selectedArtist.value ? ` across ${ts.length} albums by ${selectedArtist.value.name}` : ''
  if (!window.confirm(`Apply “${op}”${scope}? This rewrites ID3 tags on the NFS share.`)) return
  for (const t of ts) {
    launchJob(() => startCleanup(t.artist, t.album, op, { apply: true }), `Apply ${op} — ${t.album}`)
  }
}

// ── artwork ──────────────────────────────────────────────────
function doNormalize() {
  for (const t of targets()) {
    launchJob(() => startNormalizeCover(t.artist, t.album), `Normalize cover — ${t.album}`)
  }
}
function doReEmbed() {
  const ts = targets(); if (!ts.length) return
  const scope = selectedArtist.value ? ` across ${ts.length} albums by ${selectedArtist.value.name}` : ' in the album'
  if (!window.confirm(`Re-embed the folder cover into every track${scope}? This rewrites all mp3 files.`)) return
  for (const t of ts) {
    launchJob(() => startReEmbedCover(t.artist, t.album), `Re-embed cover — ${t.album}`)
  }
}

// ── convert ──────────────────────────────────────────────────
const convTo      = ref('mp3')
const convBitrate = ref('320k')
const convDelete  = ref(true)

function convertPreview() {
  for (const t of targets()) {
    launchJob(() => startConvert(t.artist, t.album, { to: convTo.value, bitrate: convBitrate.value, deleteOriginal: convDelete.value }), `Preview conversion — ${t.album}`)
  }
}
function convertApply() {
  const ts = targets(); if (!ts.length) return
  const del = convDelete.value ? ' Original files will be DELETED after a successful conversion.' : ''
  const scope = selectedArtist.value ? `${ts.length} albums by ${selectedArtist.value.name}` : 'this album'
  if (!window.confirm(`Convert ${scope} to ${convTo.value.toUpperCase()}?${del}`)) return
  for (const t of ts) {
    launchJob(() => startConvert(t.artist, t.album, { to: convTo.value, bitrate: convBitrate.value, deleteOriginal: convDelete.value, apply: true }), `Convert to ${convTo.value.toUpperCase()} — ${t.album}`)
  }
}

// ── enrich ───────────────────────────────────────────────────
const overwriteYear = ref(false)

function enrichPreview() {
  for (const t of targets()) {
    launchJob(() => startEnrich(t.artist, t.album, { fields: 'genre,year', lastfmKey: config.lastfmKey, overwriteYear: overwriteYear.value }), `Preview enrich — ${t.album}`)
  }
}
function enrichApply() {
  const ts = targets(); if (!ts.length) return
  const verb = overwriteYear.value ? 'Fill missing genre + overwrite year' : 'Fill missing genre + year'
  const scope = selectedArtist.value ? ` across ${ts.length} albums by ${selectedArtist.value.name}` : ''
  if (!window.confirm(`${verb}${scope} (MusicBrainz, Last.fm fallback)?`)) return
  for (const t of ts) {
    launchJob(() => startEnrich(t.artist, t.album, { fields: 'genre,year', lastfmKey: config.lastfmKey, overwriteYear: overwriteYear.value, apply: true }), `Enrich genre + year — ${t.album}`)
  }
}
function lyricsPreview() {
  for (const t of targets()) {
    launchJob(() => startEnrichLyrics(t.artist, t.album), `Preview lyrics — ${t.album}`)
  }
}
function lyricsApply() {
  const ts = targets(); if (!ts.length) return
  const scope = selectedArtist.value ? ` across ${ts.length} albums by ${selectedArtist.value.name}` : ''
  if (!window.confirm(`Embed lyrics from LRCLIB into every track${scope} (USLT + .lrc sidecar)?`)) return
  for (const t of ts) {
    launchJob(() => startEnrichLyrics(t.artist, t.album, { apply: true }), `Embed lyrics — ${t.album}`)
  }
}

// ── library rescan (same poll pattern as the sidebar) ────────
const scanning = ref(false)
let scanPoll   = null

async function rescan() {
  if (scanning.value) return
  scanning.value = true
  try {
    await startScan()
    scanPoll = setInterval(async () => {
      try {
        const data = await getScanStatus()
        if (!data.scanStatus?.scanning) {
          clearInterval(scanPoll)
          scanPoll = null
          scanning.value = false
        }
      } catch (_) {
        clearInterval(scanPoll)
        scanPoll = null
        scanning.value = false
      }
    }, 30000)
  } catch (_) {
    scanning.value = false
  }
}

onUnmounted(() => { if (scanPoll) clearInterval(scanPoll) })
</script>


<style scoped>
@reference "../style.css";

.btn {
  @apply text-xs font-medium px-3 py-1.5 rounded-full border border-stone-200 text-stone-700 bg-white hover:border-amber-700 hover:text-amber-700 hover:bg-amber-50 transition-colors disabled:opacity-40 disabled:pointer-events-none;
}
.btn-ghost {
  @apply border-transparent text-stone-500 hover:bg-amber-50;
}
.btn-danger {
  @apply border-red-200 text-red-600 hover:border-red-500 hover:bg-red-50 hover:text-red-700;
}
</style>

