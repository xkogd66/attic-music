// Max concurrent Deezer requests — keeps us under rate limits
const MAX_CONCURRENT = 4
let active = 0
const pending = []

function schedule(fn) {
  return new Promise((resolve, reject) => {
    pending.push({ fn, resolve, reject })
    drain()
  })
}

function drain() {
  while (active < MAX_CONCURRENT && pending.length) {
    const { fn, resolve, reject } = pending.shift()
    active++
    fn().then(
      val => { active--; resolve(val); drain() },
      err => { active--; reject(err); drain() }
    )
  }
}

export async function getArtistImage(name) {
  return schedule(async () => {
    const url = `/deezer-api/search/artist?q=${encodeURIComponent(name)}&limit=1`
    try {
      const res    = await fetch(url)
      const json   = await res.json()
      const artist = json?.data?.[0]
      return artist?.picture_big || artist?.picture_medium || artist?.picture || null
    } catch (_) {
      return null
    }
  })
}
