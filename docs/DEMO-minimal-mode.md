# Demo script — player minimize + minimal (zen) mode

Manual acceptance test for the two desktop UI changes. Everything here is
desktop-only by design: the mobile `MiniPlayer` / `FullPlayer` / `BottomNav`
path is untouched, and step 11 proves it.

> There is no test runner in this repo and no dev-dependency for one. This
> script is the acceptance test — run it by hand in the browser.

---

## 0. Build & serve

```bash
npm run dev          # http://localhost:5173
```

Needs the `/rest` proxy target (`gonic.ekskog.net`) reachable for the library to
load, and `/artist-images` on `localhost:8081` for avatars — **covers and
carousels will be empty without a working gonic, which makes step 6 untestable.**
At minimum steps 1–3, 5, 7–10 still pass with only the player shell.

Log in, set the window to **desktop width** (≥ 768px), and open DevTools →
Console to catch errors.

---

## 1. Baseline — full UI

1. Console is clean; no Vue warnings, no failed component imports.
2. Sidebar is **wide (`w-56`)**: `attic player` wordmark, server name,
   `LIBRARY` + rescan icon, 5 nav items **with text labels**, search box,
   `✨ Ask AI`, Recent plays (if Last.fm configured), and a footer row:
   `Sign out` … `PanelLeftClose` icon.
3. Footer player is **80px tall** (`h-20`): cover, title/artist/album, shuffle,
   prev/play/next, repeat, scrubber with `0:00` on both sides, volume slider
   (only ≥1024px), `Lyrics`, `Queue`, and a **chevrons-down** icon.

✅ **Pass:** layout matches, console clean.

---

## 2. Minimize the player

1. Click **chevrons-down** (last button, right of `Queue`).
2. Footer collapses to a **48px strip** (`h-12`): small cover, title + artist,
   prev/play/next, scrubber, chevrons-up.
3. Console: `localStorage.getItem('attic_player_minimized')` → `"1"`.

✅ **Pass:** strip is roughly half the height, no layout jump in the content
area, no console errors.

---

## 3. Compact strip actually controls playback

1. Click **play** in the strip → audio starts; icon becomes pause.
2. Click the **scrubber** at ~75% → playback jumps there; fill bar follows.
3. `next` then `prev` → track changes, strip's title/artist/cover update.
4. A long track name **truncates** — it does not wrap or overflow.

✅ **Pass:** all controls work; nothing overflows.

> **Regression check:** audio must **not** restart or stutter when the footer
> swaps between full ⇄ compact. If the track cuts out on minimize, the `Audio`
> element got re-created — that's a real bug, report it.

---

## 4. Persistence of minimize

1. Reload (⌘R).
2. You land back in the compact state — the strip is still minimized.

✅ **Pass:** `"1"` survived the reload.

---

## 5. Minimal (zen) mode

1. Click the **`PanelLeftClose`** icon in the sidebar footer.
2. Sidebar animates to a **narrow `w-16` rail** (~200ms transition). It now
   shows only: 5 **icons** (no labels), and a footer with two icons stacked
   (sign-out, and `PanelLeftOpen`).
3. Everything else is **gone**: no wordmark, no server name, no `LIBRARY`
   header, no rescan button, no search box, no `✨ Ask AI`, no Recent plays.
4. Hover a nav icon → native tooltip shows `Home` / `Artists` / etc.
5. `localStorage.getItem('attic_ui_minimal')` → `"1"`.

✅ **Pass:** rail is icon-only, tooltips work, nothing cut off or overlapping.

---

## 6. Carousels disappear (the "busy" fix)

1. Go to **Home**. Normally: *Recently Added*, *Discover Artists*, *Recently
   Added Albums*, *Discover Albums*.
2. In minimal mode: **all four are gone**; the page is empty (expected — Home is
   carousels-only on desktop).
3. Go to **Albums**. The *Recently Added* and *Discover* carousels above the grid
   are **gone**; the album grid + header are unchanged and usable.

✅ **Pass:** no carousels, grid intact, scrolling fine.

4. **Network check (the real point of unmounting):** DevTools → Network, then
   toggle minimal and navigate to Home/Albums. The carousels are unmounted
   (`v-if`), so no cover-art requests should fire for them.

---

## 7. Navigation still works in the rail

1. Click each of the 5 rail icons → each route loads, active icon highlights amber.
2. On **Artists** / **Albums**, drill into a detail then leave via the rail —
   navigation is not blocked by the collapsed rail.

✅ **Pass:** all 5 routes reachable, active state visible.

---

## 8. The expand path (subtle — check this one)

This is the case that needed special handling: in minimal mode the player is
compact because of the *override*, not the minimize flag.

1. Still in minimal mode, click **chevrons-up** (or the cover) on the strip.
2. **Both** happen: minimal mode exits *and* the full player returns — sidebar
   widens back to `w-56`, **and** the footer returns to 80px.
3. `attic_ui_minimal` → `"0"`, and `attic_player_minimized` → `"0"`.

✅ **Pass:** expand has a visible effect. ❌ **If the sidebar widens but the
footer stays a strip** (or vice-versa), the override logic is broken.

---

## 9. Override does not clobber your preference

1. Minimize with chevrons-down (`attic_player_minimized = "1"`).
2. Enter minimal mode, then **leave** it with `PanelLeftOpen` in the sidebar.
3. Footer is **still the compact strip** — your minimize choice came back.
4. Now expand the strip → full player, and `attic_player_minimized = "0"`.

✅ **Pass:** the two keys are independent, and minimal mode never writes
`attic_player_minimized`.

---

## 10. Queue / Lyrics panels don't collide with the strip

1. In full mode, open **Lyrics** (panel floats bottom-right, above the footer).
2. Click **chevrons-down** → the panel **closes**; nothing floats over the 48px
   strip.
3. Same test with **Queue**.
4. Enter minimal mode from a state with Queue open → also closes.

✅ **Pass:** no orphaned panel hovering over a shrunk footer.

---

## 11. Mobile is genuinely untouched

1. Narrow the window below 768px (or DevTools device mode, iPhone).
2. Expect: bottom nav with **6 tabs**
   (Home/Artists/Albums/Playlists/**Search**/Tools), a `MiniPlayer` bar **above**
   it (only when a track is loaded), and no sidebar at all.
3. Tap the mini player → full-screen `FullPlayer` slides up; art/lyrics toggle,
   controls, seek, volume all present.
4. **Whatever minimal-mode state you were in, mobile looks identical:**
   `attic_ui_minimal` has no effect below `md`. The mobile bar must be the normal
   mobile player, never the desktop strip.
5. In the console, `document.querySelector('aside')` → the element still exists
   but is `display:none` (it's inside `hidden md:flex`).

✅ **Pass:** mobile renders exactly as before this change.

---

## 12. Console / error checklist

- [ ] No `Failed to resolve component` for `CompactPlayer`, `PanelLeftClose`,
      `PanelLeftOpen`, `LogOut`
- [ ] No `Cannot read properties of undefined (reading 'minimal')` — that means
      `useUiStore()` wasn't called in that component
- [ ] No Pinia `getActivePinia` errors
- [ ] No render warnings when toggling minimal mode rapidly

---

## 13. Programmatic sanity check

Paste in the console to confirm state and that only **one** footer is mounted:

```js
const keys = ['attic_ui_minimal', 'attic_player_minimized']
console.table(keys.map(k => ({ key: k, value: localStorage.getItem(k) })))

// Desktop: exactly 1 (full footer OR the strip — never both)
console.log('footers:', document.querySelectorAll('body > div > footer').length)

console.log('aside width:', getComputedStyle(document.querySelector('aside')).width)
// w-56 => 224px, w-16 => 64px
```

Expected on desktop: **one** `<footer>`. If you see 2, the `v-if` / `v-else`
pairing broke.

Reset everything:

```js
localStorage.removeItem('attic_ui_minimal')
localStorage.removeItem('attic_player_minimized')
location.reload()
```

---

## Known limitations (not bugs)

- **Minimal mode is desktop-only** by design — every element it hides is already
  `md:`-scoped, and `ui.minimal` is never read by the mobile path.
- **Home becomes empty in minimal mode.** It contains nothing but carousels on
  desktop. If that's not what you want, the fix is to keep one row rather than
  all four.
- **Artists / Albums / Playlists headers, filters and letter-nav are not hidden**
  in this pass — only sidebar chrome, carousels, and player height. Extending it
  there is a follow-up.
- **No search entry point in minimal mode** — the desktop sidebar search box is
  unmounted. Mobile keeps its `/search` tab; desktop minimal mode doesn't have
  one yet.
- **Not tested against a built bundle by me.** `dist/` in the working tree is
  from Oct 16 and predates this work; per `CLAUDE.md` I did not run any build.
  Run `npm run dev` (or `npm run build && npm run preview`) yourself.



