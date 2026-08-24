#!/usr/bin/env python3
"""
musiclib.py  v1.0  —  Navidrome Music Library Manager

One interactive menu-driven tool replacing ~30 individual scripts.

Sections:
  A  Cover Art       — fetch artist thumbs / album covers / embed / extract
  B  Tags Cleanup    — sanitize / sort-tags / lowercase / TPE2 / nuclear / rename
  C  Tags Enrich     — genre+year (MusicBrainz+Last.fm) / MB tagger / lyrics
  D  Audit           — golden-set report / file diff / folder diff
  E  Convert         — FLAC→MP3 / WAV→FLAC / M4A→MP3
  F  Utilities       — MP3 splitter / macOS junk purge
  G  Configuration   — API keys / default library path
"""

import os
import re
import sys
import json
import time
import shutil
import signal
import threading
import subprocess
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

# ── hard dependencies ────────────────────────────────────────────────────────
try:
    import requests
except ImportError:
    print("Missing dep: requests   →  pip install requests")
    sys.exit(1)

try:
    import mutagen
    from mutagen.mp3 import MP3
    from mutagen.id3 import (
        ID3, ID3NoHeaderError, TextFrame,
        TIT2, TPE1, TPE2, TALB, TDRC, TCON, TRCK, TPOS, APIC, USLT,
    )
except ImportError:
    print("Missing dep: mutagen   →  pip install mutagen")
    sys.exit(1)

try:
    from PIL import Image
    from io import BytesIO as _BytesIO
except ImportError:
    print("Missing dep: Pillow   →  pip install Pillow")
    sys.exit(1)

# ── constants ────────────────────────────────────────────────────────────────
VERSION       = "1.0"
GOLDEN_TAGS   = {'TIT2','TALB','TPE1','TPE2','TRCK','TDRC','TPOS','TCOM','TPE3','APIC','TCMP'}
GROUPING_TAGS = ['TALB','TPE2','TDRC','TPOS','TCMP']
SORT_TAGS     = {'TSOP','TSO2','TSOA','TSOT','TSOS','TSOC','TSOO','XSOP'}
AUDIO_EXTS    = {'.mp3','.flac','.ogg','.m4a','.wav','.aiff'}
IMG_NAMES     = {'cover.jpg','cover.jpeg','cover.png','folder.jpg','folder.jpeg','front.jpg'}

MB_API     = "https://musicbrainz.org/ws/2"
DDZ_API    = "https://api.deezer.com"
FANART_API = "https://webservice.fanart.tv/v3/music"
LASTFM_API = "https://ws.audioscrobbler.com/2.0/"
LRCLIB_API = "https://lrclib.net/api/get"

GENERIC_GENRES = {
    "rock","pop","jazz","blues","folk","classical","country","metal",
    "electronic","dance","hip hop","hip-hop","rap","soul","funk",
    "reggae","punk","alternative","indie","r&b","rnb","ambient",
    "world","latin","gospel","ska","grunge","experimental","noise",
    "hardcore","emo","acoustic","instrumental","soundtrack",
}

CONFIG_FILE = Path.home() / ".musiclib.json"
LOG_DIR     = Path.home() / "musiclib_logs"

# ── runtime globals ──────────────────────────────────────────────────────────
CFG: dict        = {}
_last_path: Path = None   # persisted across prompts within a session
_exit_flag: bool = False  # set by SIGINT handler


# ════════════════════════════════════════════════════════════════════════════
# 0. Bootstrap
# ════════════════════════════════════════════════════════════════════════════

def load_config():
    global CFG
    defaults = {
        "fanart_key":           os.environ.get("FANART_API_KEY", "534d55e821819637a0fa7fea2dd0bca4"),
        "lastfm_key":           os.environ.get("LASTFM_API_KEY", ""),
        "mb_email":             "ekskog@gmail.com",
        "default_library_path": "",
    }
    if CONFIG_FILE.exists():
        try:
            saved = json.loads(CONFIG_FILE.read_text())
            defaults.update(saved)
        except Exception:
            pass
    CFG = defaults


def save_config():
    try:
        with open(CONFIG_FILE, "w") as f:
            json.dump(CFG, f, indent=2)
        print(f"  Config saved → {CONFIG_FILE}")
    except Exception as e:
        print(f"  [!] Could not save config: {e}")


def _mb_init():
    try:
        import musicbrainzngs
        musicbrainzngs.set_useragent("musiclib", VERSION, CFG.get("mb_email", ""))
    except ImportError:
        pass


def _signal_handler(sig, frame):
    global _exit_flag
    _exit_flag = True
    print("\n  [!] Interrupted.")
    sys.exit(0)

signal.signal(signal.SIGINT, _signal_handler)


# ════════════════════════════════════════════════════════════════════════════
# 1. Core Infrastructure
# ════════════════════════════════════════════════════════════════════════════

def setup_readline():
    try:
        import readline
        import glob

        def _completer(text, state):
            expanded = os.path.expanduser(text)
            matches = []
            for m in glob.glob(expanded + "*"):
                display = text + m[len(expanded):]
                if os.path.isdir(m) and not display.endswith(os.sep):
                    display += os.sep
                matches.append(display)
            return matches[state] if state < len(matches) else None

        readline.set_completer(_completer)
        readline.set_completer_delims("\t\n;")
        if sys.platform == "darwin":
            readline.parse_and_bind("bind ^I rl_complete")
        else:
            readline.parse_and_bind("tab: complete")
    except ImportError:
        pass


def prompt_path(label="Path") -> Path:
    """Prompt for a directory path with tab completion; remember last used."""
    global _last_path
    setup_readline()
    default = _last_path or Path.cwd()
    while True:
        try:
            raw = input(f"\n  {label} [{default}]: ").strip()
        except EOFError:
            return None
        p = Path(raw).expanduser().resolve() if raw else default
        if p.is_dir():
            _last_path = p
            return p
        print(f"  [!] Not a directory: {p}")


def detect_hierarchy_level(path: Path) -> str:
    """
    Returns 'root' | 'letter' | 'artist' | 'album' | 'unknown'.

    root   — /mp3/         children are single-char letter folders
    letter — /mp3/a/       children are artist folders
    artist — /mp3/a/xyz/   children are album folders containing audio
    album  — /mp3/a/xyz/y/ contains audio files directly
    """
    path = Path(path)
    try:
        entries = list(path.iterdir())
    except PermissionError:
        return "unknown"

    files = [e for e in entries if e.is_file()]
    dirs  = [e for e in entries if e.is_dir() and not e.name.startswith('.')]

    # album: contains audio files directly
    if any(f.suffix.lower() in AUDIO_EXTS for f in files):
        return "album"

    if not dirs:
        return "unknown"

    # Probe depth to first audio file across a sample of children.
    # depth 1 → audio in children           → artist level (children are albums)
    # depth 2 → audio in grandchildren      → letter level (children are artists)
    # depth 3 → audio in great-grandchildren→ root   level (children are letters)
    def _vis_dirs(p):
        try:
            return [d for d in p.iterdir() if d.is_dir() and not d.name.startswith('.')]
        except PermissionError:
            return []

    def _has_audio(p):
        try:
            return any(f.suffix.lower() in AUDIO_EXTS for f in p.iterdir() if f.is_file())
        except PermissionError:
            return False

    for child in dirs[:4]:
        if _has_audio(child):
            return "artist"
        for gc in _vis_dirs(child)[:4]:
            if _has_audio(gc):
                return "letter"
            for ggc in _vis_dirs(gc)[:3]:
                if _has_audio(ggc):
                    return "root"

    return "unknown"


def prompt_level(path: Path) -> str:
    """Show detected level as default; let user pick explicitly."""
    detected = detect_hierarchy_level(path)
    levels = ["album", "artist", "letter", "root"]
    choices = "  ".join(f"[{i+1}] {l}" for i, l in enumerate(levels))
    default_idx = levels.index(detected) + 1 if detected in levels else None
    if default_idx:
        prompt_str = f"\n  Level: {choices}  [Enter={detected}]: "
    else:
        prompt_str = f"\n  Level: {choices}: "
    try:
        raw = input(prompt_str).strip()
    except EOFError:
        return detected
    if not raw and default_idx:
        return detected
    try:
        n = int(raw)
        if 1 <= n <= len(levels):
            return levels[n - 1]
    except ValueError:
        pass
    return detected


def iter_albums(path: Path, level: str = None):
    """Yield every album-level directory under path (any hierarchy level)."""
    path  = Path(path)
    level = level or detect_hierarchy_level(path)
    if level == "album":
        yield path
    elif level == "artist":
        for child in sorted(path.iterdir()):
            if child.is_dir() and not child.name.startswith("."):
                yield child
    elif level == "letter":
        for artist in sorted(path.iterdir()):
            if not artist.is_dir() or artist.name.startswith("."):
                continue
            for album in sorted(artist.iterdir()):
                if album.is_dir() and not album.name.startswith("."):
                    yield album
    elif level == "root":
        for letter in sorted(path.iterdir()):
            if not letter.is_dir() or letter.name.startswith("."):
                continue
            for artist in sorted(letter.iterdir()):
                if not artist.is_dir() or artist.name.startswith("."):
                    continue
                for album in sorted(artist.iterdir()):
                    if album.is_dir() and not album.name.startswith("."):
                        yield album
    else:
        # unknown — try walking and yield dirs that contain audio
        for dirpath, dirnames, filenames in os.walk(str(path)):
            dirnames[:] = [d for d in sorted(dirnames) if not d.startswith(".")]
            if any(Path(f).suffix.lower() in AUDIO_EXTS for f in filenames):
                yield Path(dirpath)


def iter_artists(path: Path, level: str = None):
    """Yield every artist-level directory under path."""
    path  = Path(path)
    level = level or detect_hierarchy_level(path)
    if level == "artist":
        yield path
    elif level == "album":
        yield path.parent
    elif level == "letter":
        for child in sorted(path.iterdir()):
            if child.is_dir() and not child.name.startswith("."):
                yield child
    elif level == "root":
        for letter in sorted(path.iterdir()):
            if not letter.is_dir() or letter.name.startswith("."):
                continue
            for artist in sorted(letter.iterdir()):
                if artist.is_dir() and not artist.name.startswith("."):
                    yield artist


def setup_logging(label: str) -> Path:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    return LOG_DIR / f"{label}_{ts}.log"


def dry_run_confirm(action: str, items: list, noun: str = "item") -> bool:
    if not items:
        print("  Nothing to do.")
        return False
    n = len(items)
    print(f"\n  Preview — {n} {noun}{'s' if n != 1 else ''}:")
    for item in items[:20]:
        print(f"    {item}")
    if n > 20:
        print(f"    … and {n - 20} more")
    try:
        ans = input(f"\n  {action}? [y/N]: ").strip().lower()
    except EOFError:
        return False
    return ans == "y"


# ── threaded progress bar ────────────────────────────────────────────────────
_prog      = {"current": 0, "total": 0, "label": "", "running": False}
_prog_lock = threading.Lock()


def _render_bar():
    with _prog_lock:
        cur, tot, lbl = _prog["current"], _prog["total"], _prog["label"]
    width  = 38
    filled = int(width * cur / tot) if tot else 0
    bar    = "█" * filled + "░" * (width - filled)
    pct    = int(100 * cur / tot) if tot else 0
    short  = lbl[:33].ljust(33)
    print(f"\r  [{bar}] {pct:3d}%  {cur}/{tot}  {short}", end="", flush=True)


def _progress_worker():
    spin = ["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"]
    tick = 0
    while _prog["running"]:
        _render_bar()
        sys.stdout.write(f" {spin[tick % len(spin)]}")
        sys.stdout.flush()
        tick += 1
        time.sleep(0.12)


def start_progress(total: int) -> threading.Thread:
    _prog.update({"current": 0, "total": total, "label": "", "running": True})
    t = threading.Thread(target=_progress_worker, daemon=True)
    t.start()
    return t


def advance_progress(label: str = ""):
    with _prog_lock:
        _prog["current"] += 1
        _prog["label"]    = label


def finish_progress(thread: threading.Thread):
    _prog["running"] = False
    thread.join()
    tot = _prog["total"]
    print(f"\r  [{'█'*38}] 100%  {tot}/{tot}{'':36}", flush=True)


# ── small helpers ─────────────────────────────────────────────────────────────

def check_dep(module: str, hint: str = "") -> bool:
    import importlib.util
    if importlib.util.find_spec(module) is None:
        print(f"  [!] Missing: {module}")
        if hint:
            print(f"      Install:  {hint}")
        return False
    return True


def check_ffmpeg() -> bool:
    try:
        subprocess.run(["ffmpeg", "-version"], capture_output=True, check=True)
        return True
    except (FileNotFoundError, subprocess.CalledProcessError):
        print("  [!] ffmpeg not found.  Install:  brew install ffmpeg")
        return False


def _headers() -> dict:
    return {"User-Agent": f"musiclib/{VERSION} ({CFG.get('mb_email','')})"}


def _human(name: str) -> str:
    """Convert folder_name to 'Folder Name' style."""
    return name.replace("_", " ").strip()


def _audio_files(folder: Path, ext: str = ".mp3") -> list:
    return sorted(f for f in folder.iterdir() if f.is_file() and f.suffix.lower() == ext)


def _all_audio(path: Path) -> list:
    return sorted(f for f in path.rglob("*") if f.is_file() and f.suffix.lower() in AUDIO_EXTS)


def _parse_year(s) -> int:
    m = re.match(r"(\d{4})", str(s).strip())
    if m:
        y = int(m.group(1))
        return y if 1900 <= y <= 2100 else None
    return None


def _sanitize_slug(text: str) -> str:
    text = text.strip().lower()
    text = re.sub(r"[^\w\s-]", "_", text, flags=re.UNICODE)
    text = re.sub(r"\s+", "_", text)
    text = re.sub(r"_+", "_", text)
    return text.strip("_")


# ════════════════════════════════════════════════════════════════════════════
# A. Cover Art
# ════════════════════════════════════════════════════════════════════════════

def _ensure_real_jpeg(data: bytes) -> bytes:
    """
    Verify that image bytes decode to a genuine JPEG; if the actual format is
    something else (e.g. a remote host serving WebP under a .jpg URL), convert
    it to real JPEG. Returns None if the bytes aren't a decodable image at all.
    """
    if not data:
        return None
    try:
        img = Image.open(_BytesIO(data))
        img.load()
        if img.format == "JPEG":
            return data
        if img.mode != "RGB":
            img = img.convert("RGB")
        buf = _BytesIO()
        img.save(buf, format="JPEG", quality=92)
        return buf.getvalue()
    except Exception:
        return None


def _deezer_get_image(endpoint: str, query: str, url_key: str, fallback_key: str) -> bytes:
    try:
        r    = requests.get(f"{DDZ_API}/{endpoint}",
                            params={"q": query, "limit": 5}, timeout=10)
        data = r.json().get("data", [])
        if not data:
            return None
        url = data[0].get(url_key) or data[0].get(fallback_key)
        if not url:
            return None
        return _ensure_real_jpeg(requests.get(url, timeout=15).content)
    except Exception:
        return None


def fetch_album_cover_lastfm(artist_name: str, album_name: str) -> bytes:
    key = CFG.get("lastfm_key", "")
    if not key:
        return None
    clean_artist = artist_name.replace("_", " ").strip()
    clean_album  = re.sub(r"^\d{4}[-_]", "", album_name).replace("_", " ").strip()
    try:
        r = requests.get(LASTFM_API, params={
            "method": "album.getinfo",
            "artist": clean_artist,
            "album": clean_album,
            "autocorrect": 1,
            "api_key": key,
            "format": "json",
        }, headers=_headers(), timeout=10)
        data   = r.json()
        images = data.get("album", {}).get("image", [])
        url = None
        for size in ("mega", "extralarge", "large"):
            url = next((img.get("#text") for img in images
                       if img.get("size") == size and img.get("#text")), None)
            if url:
                break
        if not url:
            return None
        return _ensure_real_jpeg(requests.get(url, timeout=15).content)
    except Exception:
        return None


def fetch_artist_thumb_deezer(artist_name: str) -> bytes:
    return _deezer_get_image("search/artist", artist_name, "picture_xl", "picture_big")


def _run_fetch_artist_thumbs(path: Path, level: str = None):
    """Fetch artist thumbnails from Deezer; skip artists that already have cover.jpg."""
    artists = list(iter_artists(path, level))
    targets = [a for a in artists if not (a / "cover.jpg").exists()]
    if not targets:
        print("  All artists already have thumbnails — skipping.")
        return
    log_path = setup_logging("fetch_thumb_deezer")
    missing  = []
    with open(log_path, "w") as log:
        for i, artist_path in enumerate(targets, 1):
            if _exit_flag:
                break
            name = _human(artist_path.name)
            print(f"  [{i}/{len(targets)}] {name}…", end="\r")
            data = fetch_artist_thumb_deezer(name)
            if data:
                (artist_path / "cover.jpg").write_bytes(data)
                print(f"  [{i}/{len(targets)}] {name} — saved         ")
                log.write(f"OK   {artist_path.name}\n")
            else:
                missing.append(name)
                print(f"  [{i}/{len(targets)}] {name} — not found     ")
                log.write(f"MISS {artist_path.name}\n")
    print(f"\n  Done: {len(targets)-len(missing)} saved, {len(missing)} missing")


def normalize_album_artwork(path: Path, level: str = None):
    """
    Per album, in order:
      1. Image file in folder → embed into all MP3 APIC (replacing any existing)
      2. No image → extract APIC from tags → save as cover.jpg → embed all
      3. Nothing anywhere → fetch from Last.fm → save cover.jpg → embed all
    """
    albums = list(iter_albums(path, level))
    if not albums:
        print("  No albums found.")
        return
    stats    = {"from_folder": 0, "from_tags": 0, "from_lastfm": 0, "missing": 0, "files": 0, "errors": 0}
    log_path = setup_logging("normalize_artwork")
    IMG_ORDER = ("cover.jpg", "cover.jpeg", "cover.png", "folder.jpg", "folder.jpeg", "front.jpg")
    with open(log_path, "w") as log:
        for i, album in enumerate(albums, 1):
            if _exit_flag:
                break
            mp3s = _audio_files(album, ".mp3")
            if not mp3s:
                continue
            img_data = None
            mime     = "image/jpeg"
            label    = ""
            # 1. image file in folder
            img_file = next((album / n for n in IMG_ORDER if (album / n).exists()), None)
            if img_file:
                img_data = img_file.read_bytes()
                mime     = "image/png" if img_file.suffix.lower() == ".png" else "image/jpeg"
                stats["from_folder"] += 1
                label = "folder"
            # 2. extract from APIC
            if img_data is None:
                for mp3 in mp3s:
                    try:
                        tags   = ID3(mp3)
                        frames = tags.getall("APIC")
                        if not frames:
                            continue
                        frames.sort(key=lambda f: (0 if f.type == 3 else 1))
                        frame = frames[0]
                        if frame.data:
                            img_data = frame.data
                            mime     = frame.mime if frame.mime else "image/jpeg"
                            (album / "cover.jpg").write_bytes(img_data)
                            stats["from_tags"] += 1
                            label = "extracted"
                            log.write(f"EXTRACTED {album.parent.name}/{album.name}\n")
                            break
                    except Exception:
                        continue
            # 3. fetch from Last.fm
            if img_data is None:
                print(f"  [{i}/{len(albums)}] {album.parent.name}/{album.name} — fetching…", end="\r")
                data = fetch_album_cover_lastfm(album.parent.name, album.name)
                if data:
                    img_data = data
                    (album / "cover.jpg").write_bytes(data)
                    stats["from_lastfm"] += 1
                    label = "lastfm"
                    log.write(f"FETCHED {album.parent.name}/{album.name}\n")
                else:
                    stats["missing"] += 1
                    print(f"  [{i}/{len(albums)}] {album.parent.name}/{album.name} — no art found      ")
                    log.write(f"MISS {album.parent.name}/{album.name}\n")
                    continue
            # embed into every MP3
            n_ok = n_err = 0
            for mp3 in mp3s:
                try:
                    audio = MP3(mp3, ID3=ID3)
                    if audio.tags is None:
                        audio.add_tags()
                    audio.tags.delall("APIC")
                    audio.tags.add(APIC(encoding=3, mime=mime, type=3,
                                        desc="Front Cover", data=img_data))
                    audio.save()
                    n_ok += 1
                except Exception:
                    n_err += 1
            stats["files"]  += n_ok
            stats["errors"] += n_err
            print(f"  [{i}/{len(albums)}] {album.parent.name}/{album.name} [{label}] → {n_ok} files")
    print(f"\n  Albums: {len(albums)}"
          f"  |  folder: {stats['from_folder']}"
          f"  extracted: {stats['from_tags']}"
          f"  fetched: {stats['from_lastfm']}"
          f"  missing: {stats['missing']}")
    print(f"  Files updated: {stats['files']}  Errors: {stats['errors']}")
    print(f"  Log: {log_path}")


def run_section_cover_art():
    while True:
        print("""
  A. Cover Art
  ─────────────────────────────────────────────────────────
  1  Normalize artwork
     folder cover.jpg → embed  |  APIC → extract+embed  |  Last.fm → fetch+embed
  0  Back""")
        choice = input("\n  Choice: ").strip()
        if choice in ("0", "q"):
            return
        if choice == "1":
            path = prompt_path("Library path")
            if not path:
                continue
            level = prompt_level(path)
            normalize_album_artwork(path, level)


# ════════════════════════════════════════════════════════════════════════════
# B. Tags — Cleanup
# ════════════════════════════════════════════════════════════════════════════

def sanitize_to_golden_set(path: Path, auto: bool = False, level: str = None):
    """
    Two-pass album sanitization:
    1. Wipe every tag not in GOLDEN_TAGS
    2. Align GROUPING_TAGS to the first file's values (forces consistency)
    """
    albums = list(iter_albums(path, level))
    if not auto and not dry_run_confirm("Sanitize tags to golden set",
                                        [str(a) for a in albums], "album"):
        return
    log_path = setup_logging("sanitize")
    stats    = {"albums": 0, "modified": 0, "errors": 0}
    with open(log_path, "w") as log:
        for album in albums:
            if _exit_flag:
                break
            mp3s = sorted(_audio_files(album, ".mp3"))
            if not mp3s:
                continue
            # Pass 1: wipe non-golden
            for mp3 in mp3s:
                try:
                    audio = ID3(mp3)
                    for tag in list(audio.keys()):
                        if tag.split(":")[0] not in GOLDEN_TAGS:
                            audio.pop(tag)
                    audio.save(v2_version=3)
                    stats["modified"] += 1
                except Exception as e:
                    log.write(f"ERR_SANITIZE {mp3}: {e}\n")
                    stats["errors"] += 1
            # Pass 2: align grouping tags from first file
            try:
                ref       = ID3(mp3s[0])
                blueprint = {t: ref.get(t) for t in GROUPING_TAGS}
                for mp3 in mp3s:
                    audio   = ID3(mp3)
                    changed = False
                    for tag, val in blueprint.items():
                        if audio.get(tag) != val:
                            if val is None:
                                if tag in audio:
                                    audio.pop(tag)
                                    changed = True
                            else:
                                audio.add(val)
                                changed = True
                    if changed:
                        audio.save(v2_version=3)
                        log.write(f"ALIGNED {mp3.name}\n")
            except Exception as e:
                log.write(f"ERR_ALIGN {album}: {e}\n")
                stats["errors"] += 1
            stats["albums"] += 1
            print(f"\r  [{stats['albums']}/{len(albums)}] {album.name}" + " " * 20, end="")
    print(f"\n  Done: {stats['albums']} albums | {stats['modified']} files | {stats['errors']} errors")
    print(f"  Log: {log_path}")


def delete_sort_tags(path: Path):
    """Delete all sort-order tags (TSOP, TSO2 etc.) from every audio file."""
    audio_files = _all_audio(path)
    if not dry_run_confirm(f"Delete sort tags from {len(audio_files)} audio files",
                           [f.name for f in audio_files[:20]], "file"):
        return
    log_path   = setup_logging("delete_sort_tags")
    other_keys = ["artistsort","albumartistsort","albumsort","titlesort","composersort"]
    stats      = {"cleaned": 0, "errors": 0}
    with open(log_path, "w") as log:
        for i, fp in enumerate(audio_files, 1):
            if _exit_flag:
                break
            try:
                if fp.suffix.lower() == ".mp3":
                    tags    = ID3(fp)
                    removed = [t for t in SORT_TAGS if t in tags]
                    for t in removed:
                        tags.delall(t)
                    txxx_del = [t.desc for t in tags.getall("TXXX")
                                if "sort" in t.desc.lower()]
                    for desc in txxx_del:
                        tags.delall(f"TXXX:{desc}")
                        removed.append(f"TXXX:{desc}")
                    if removed:
                        tags.save(v2_version=3)
                        log.write(f"PURGED {fp.name}: {', '.join(removed)}\n")
                        stats["cleaned"] += 1
                else:
                    audio = mutagen.File(str(fp))
                    if audio and audio.tags:
                        removed = [k for k in other_keys if k in audio]
                        for k in removed:
                            del audio[k]
                        if removed:
                            audio.save()
                            log.write(f"PURGED {fp.name}: {', '.join(removed)}\n")
                            stats["cleaned"] += 1
            except Exception as e:
                log.write(f"ERROR {fp}: {e}\n")
                stats["errors"] += 1
            if i % 50 == 0 or i == len(audio_files):
                print(f"\r  {i}/{len(audio_files)}  cleaned: {stats['cleaned']}", end="", flush=True)
    print(f"\n  Done: {stats['cleaned']} cleaned | {stats['errors']} errors")
    print(f"  Log: {log_path}")


def lowercase_all_text_frames(path: Path, auto: bool = False):
    """Lowercase every TextFrame in every MP3."""
    mp3s = list(path.rglob("*.mp3"))
    if not auto and not dry_run_confirm(f"Lowercase all text frames in {len(mp3s)} MP3s",
                                        [f.name for f in mp3s[:20]], "file"):
        return
    log_path = setup_logging("lowercase_tags")
    stats    = {"updated": 0, "errors": 0}
    with open(log_path, "w") as log:
        for i, mp3 in enumerate(mp3s, 1):
            if _exit_flag:
                break
            try:
                audio   = ID3(mp3)
                changed = False
                for fid in list(audio.keys()):
                    frame = audio[fid]
                    if isinstance(frame, TextFrame):
                        lowered = [str(v).lower() for v in frame.text]
                        if lowered != [str(v) for v in frame.text]:
                            frame.text = lowered
                            changed    = True
                if changed:
                    audio.save(v2_version=4)
                    stats["updated"] += 1
                    log.write(f"LOWERCASED {mp3.name}\n")
            except ID3NoHeaderError:
                pass
            except Exception as e:
                log.write(f"ERROR {mp3}: {e}\n")
                stats["errors"] += 1
            if i % 100 == 0 or i == len(mp3s):
                print(f"\r  {i}/{len(mp3s)}  updated: {stats['updated']}", end="", flush=True)
    print(f"\n  Done: {stats['updated']} updated | {stats['errors']} errors")
    print(f"  Log: {log_path}")


def set_tpe2_from_path(path: Path, level: str = None):
    """Prompt for an Album Artist value and set TPE2 on all MP3s under the folder."""
    mp3s = list(path.rglob("*.mp3"))
    if not mp3s:
        print("  No MP3s found.")
        return
    tag_value = input("  Album Artist: ").strip()
    if not tag_value:
        print("  Cancelled.")
        return
    preview = [f"'{tag_value}'  ({len(mp3s)} files)"]
    if not dry_run_confirm("Set TPE2 (Album Artist)", preview, "file"):
        return
    log_path = setup_logging("set_tpe2")
    updated  = 0
    with open(log_path, "w") as log:
        for mp3 in mp3s:
            if _exit_flag:
                break
            try:
                audio = ID3(mp3)
                audio.add(TPE2(encoding=3, text=tag_value))
                audio.save(v2_version=3)
                updated += 1
            except Exception as e:
                log.write(f"ERROR {mp3}: {e}\n")
        log.write(f"SET TPE2='{tag_value}' on {updated} files\n")
    print(f"  Done: {updated} files updated")
    print(f"  Log: {log_path}")


def nuclear_clean_and_rename(path: Path):
    """
    DESTRUCTIVE: delete ALL tags, rewrite 5 core tags (lowercased),
    extract feat. from artist field, rename files to NN-NN-title.ext.
    """
    files = _all_audio(path)
    print(f"\n  WARNING: deletes ALL tags (MusicBrainz IDs, artwork, lyrics…)")
    print(f"  Found {len(files)} audio files in {path}")
    if not dry_run_confirm("Nuclear clean + rename", [f.name for f in files[:20]], "file"):
        return
    try:
        confirm = input("  Type NUCLEAR to confirm: ").strip()
    except EOFError:
        return
    if confirm != "NUCLEAR":
        print("  Aborted.")
        return
    log_path = setup_logging("nuclear_clean")
    feat_re  = re.compile(r"(.*?)\s+(?:feat\.?|ft\.?|featuring|with|vs\.?)\s+(.*)",
                          re.IGNORECASE)
    stats    = {"cleaned": 0, "renamed": 0, "errors": 0}
    with open(log_path, "w") as log:
        for i, fp in enumerate(files, 1):
            if _exit_flag:
                break
            try:
                audio = mutagen.File(str(fp), easy=True)
                if audio is None:
                    continue
                artist    = str(audio.get("artist",      [""])[0]).strip()
                title     = str(audio.get("title",       [""])[0]).strip()
                album     = str(audio.get("album",       [""])[0]).strip()
                alb_art   = str(audio.get("albumartist", [""])[0]).strip()
                track     = str(audio.get("tracknumber", ["0"])[0]).split("/")[0]
                disc      = str(audio.get("discnumber",  ["1"])[0]).split("/")[0]
                date      = str(audio.get("date",        [""])[0]).strip()
                # feat. extraction
                m = feat_re.search(artist)
                if m:
                    artist = m.group(1).strip()
                    guest  = m.group(2).strip()
                    if f"feat. {guest}".lower() not in title.lower():
                        title = f"{title} (feat. {guest})"
                if not alb_art or alb_art.lower() == "none":
                    alb_art = artist
                # wipe & rewrite
                audio.delete()
                audio = mutagen.File(str(fp), easy=True)
                audio["artist"]      = artist.lower()
                audio["title"]       = title.lower()
                audio["album"]       = album.lower()
                audio["albumartist"] = alb_art.lower()
                audio["tracknumber"] = track
                audio["discnumber"]  = disc
                if date:
                    audio["date"] = date
                audio.save()
                stats["cleaned"] += 1
                # rename
                safe     = re.sub(r'[\/\\:*?"<>|()]', "", title.lower()).replace(" ", "_")
                safe     = re.sub(r"_+", "_", safe).strip("_")
                new_name = f"{disc.zfill(2)}-{track.zfill(2)}-{safe}{fp.suffix.lower()}"
                new_path = fp.parent / new_name
                if fp.name != new_name and not new_path.exists():
                    fp.rename(new_path)
                    stats["renamed"] += 1
                    log.write(f"RENAMED {fp.name} → {new_name}\n")
            except Exception as e:
                log.write(f"ERROR {fp}: {e}\n")
                stats["errors"] += 1
            if i % 50 == 0 or i == len(files):
                print(f"\r  {i}/{len(files)}  cleaned: {stats['cleaned']}  renamed: {stats['renamed']}  errors: {stats['errors']}",
                      end="", flush=True)
    print(f"\n  Cleaned: {stats['cleaned']}  Renamed: {stats['renamed']}  Errors: {stats['errors']}")
    print(f"  Log: {log_path}")


def rename_album_folder_from_tags(path: Path):
    """Rename album folders to YYYY-album_name based on ID3 tags."""
    renames = []
    for dirpath, _, files in os.walk(str(path), topdown=False):
        dp   = Path(dirpath)
        mp3s = [f for f in files if f.lower().endswith(".mp3")]
        if not mp3s:
            continue
        years, albums = [], []
        for f in mp3s:
            try:
                audio = mutagen.File(str(dp / f), easy=True)
                if not audio:
                    continue
                d = audio.get("date", [None])[0]
                if d:
                    y = _parse_year(str(d))
                    if y:
                        years.append(y)
                a = audio.get("album", [None])[0]
                if a:
                    albums.append(str(a))
            except Exception:
                pass
        if not years or not albums:
            continue
        year     = str(Counter(years).most_common(1)[0][0])
        album    = Counter(albums).most_common(1)[0][0]
        new_name = f"{year}-{_sanitize_slug(album)}"
        new_path = dp.parent / new_name
        if dp.name != new_name:
            renames.append((dp, new_path))
    if not dry_run_confirm("Rename album folders from tags",
                           [f"{r[0].name}  →  {r[1].name}" for r in renames], "folder"):
        return
    log_path = setup_logging("rename_albums")
    done     = 0
    with open(log_path, "w") as log:
        for old, new in renames:
            if _exit_flag:
                break
            if new.exists():
                log.write(f"COLLISION {new.name}\n")
                print(f"  [skip] {new.name} already exists")
                continue
            old.rename(new)
            log.write(f"RENAMED {old.name} → {new.name}\n")
            done += 1
    print(f"  Done: {done} folders renamed")
    print(f"  Log: {log_path}")


def slugify_folders(path: Path):
    """Rename all subdirectories to lowercase_underscore slug format."""
    renames = []
    for root, dirs, _ in os.walk(str(path), topdown=False):
        for d in dirs:
            s = re.sub(r"^\((\d+)\)\s*", r"\1-", d)  # (2) foo → 2-foo
            new = _sanitize_slug(s)
            if d != new:
                renames.append((Path(root) / d, Path(root) / new))
    if not dry_run_confirm("Slugify folder names",
                           [f"{r[0].name}  →  {r[1].name}" for r in renames], "folder"):
        return
    done = 0
    for old, new in renames:
        if _exit_flag:
            break
        try:
            if not new.exists():
                old.rename(new)
                done += 1
            else:
                print(f"  [skip] collision: {new.name}")
        except OSError as e:
            print(f"  [!] {e}")
    print(f"  Done: {done} folders renamed")


def tag_from_filename(path: Path):
    """Parse 'Artist - Title.mp3' or 'NN - Title.mp3' and write TIT2/TPE1 tags."""
    patterns = [
        re.compile(r"^(.+?)\s*-\s*(.+?)\.mp3$", re.IGNORECASE),
        re.compile(r"^(\d+)\s*[-_.]\s*(.+?)\.mp3$", re.IGNORECASE),
    ]
    mp3s     = list(path.rglob("*.mp3"))
    jobs     = []
    previews = []
    for mp3 in mp3s:
        for pat in patterns:
            m = pat.match(mp3.name)
            if m:
                p1, p2 = m.group(1).strip(), m.group(2).strip()
                if p1.isdigit():
                    jobs.append((mp3, None, p2.replace("_"," ")))
                    previews.append(f"{mp3.name}  →  title='{p2}'")
                else:
                    jobs.append((mp3, p1.replace("_"," "), p2.replace("_"," ")))
                    previews.append(f"{mp3.name}  →  artist='{p1}'  title='{p2}'")
                break
    if not dry_run_confirm("Tag TIT2/TPE1 from filename", previews, "file"):
        return
    done = 0
    for mp3, artist, title in jobs:
        if _exit_flag:
            break
        try:
            try:
                tags = ID3(mp3)
            except ID3NoHeaderError:
                tags = ID3()
            if title:
                tags.add(TIT2(encoding=3, text=title))
            if artist:
                tags.add(TPE1(encoding=3, text=artist))
            tags.save(mp3)
            done += 1
        except Exception as e:
            print(f"  [!] {mp3.name}: {e}")
    print(f"  Done: {done} files updated")


def run_section_tag_cleanup():
    while True:
        print("""
  B. Tags — Cleanup
  ─────────────────────────────────────────────────────────
  1  Sanitize to Golden Set   (wipe non-golden, align grouping tags)
  2  Delete all sort tags     (TSOP, TSO2, TSOA, TSOT, TSOS…)
  3  Lowercase all text frames  (nuclear)
  4  Set TPE2 (Album Artist)   (prompt for value)
  5  Nuclear clean + rename     (wipe all, rewrite 5 core tags, NN-NN-title.ext)
  6  Rename album folders from tags  (YYYY-album_name)
  7  Slugify folder names  (lowercase_underscore)
  8  Tag TIT2/TPE1 from filename
  0  Back""")
        choice = input("\n  Choice: ").strip()
        if choice in ("0", "q"):
            return
        path = prompt_path("Library path")
        if not path:
            continue
        level = detect_hierarchy_level(path)
        print(f"  Detected level: {level}")
        if   choice == "1": sanitize_to_golden_set(path, level=level)
        elif choice == "2": delete_sort_tags(path)
        elif choice == "3": lowercase_all_text_frames(path)
        elif choice == "4": set_tpe2_from_path(path, level=level)
        elif choice == "5": nuclear_clean_and_rename(path)
        elif choice == "6": rename_album_folder_from_tags(path)
        elif choice == "7": slugify_folders(path)
        elif choice == "8": tag_from_filename(path)


# ════════════════════════════════════════════════════════════════════════════
# C. Tags — Enrich
# ════════════════════════════════════════════════════════════════════════════

# ── MusicBrainz helpers ───────────────────────────────────────────────────────

def _mb_get(url: str, params: dict) -> dict:
    r = requests.get(url, params=params, headers=_headers(), timeout=10)
    r.raise_for_status()
    return r.json()


def _mb_search_releases(artist: str, album: str, limit: int = 25) -> list:
    parts = []
    if artist: parts.append(f'artist:"{artist}"')
    if album:  parts.append(f'release:"{album}"')
    if not parts:
        return []
    try:
        data = _mb_get(f"{MB_API}/release",
                       {"query": " AND ".join(parts), "fmt": "json", "limit": limit})
        return data.get("releases", [])
    except Exception:
        return []


def _pick_best_genre(items: list) -> str:
    if not items:
        return None
    items = sorted(items, key=lambda x: x.get("count", 0), reverse=True)
    top   = items[0].get("name","").strip()
    if top and top.lower() not in GENERIC_GENRES:
        return top.title()
    for item in items[1:]:
        name = item.get("name","").strip()
        if name and name.lower() not in GENERIC_GENRES:
            return name.title()
    return top.title() if top else None


def _mb_genre(releases: list) -> str:
    for rel in releases:
        rid = rel.get("id")
        if not rid:
            continue
        time.sleep(0.5)
        for endpoint, inc in [
            (f"{MB_API}/release/{rid}",              "genres+tags"),
            (f"{MB_API}/release-group/{rel.get('release-group',{}).get('id','')}", "genres+tags"),
        ]:
            if not endpoint.endswith("/"):
                try:
                    data = _mb_get(endpoint, {"inc": inc, "fmt": "json"})
                    for field in ("genres","tags"):
                        items = data.get(field, [])
                        g = _pick_best_genre(items)
                        if g:
                            return g
                except Exception:
                    pass
            time.sleep(0.5)
    return None


def _mb_year(releases: list) -> int:
    years = []
    for r in releases:
        y = _parse_year(r.get("date",""))
        if y: years.append(y)
        rg = r.get("release-group") or {}
        y  = _parse_year(rg.get("first-release-date",""))
        if y: years.append(y)
    return min(years) if years else None


def _lastfm_genre(artist: str, album: str) -> str:
    key = CFG.get("lastfm_key","")
    if not key:
        return None
    for params in [
        {"method":"album.getTopTags", "artist": artist, "album": album, "autocorrect": 1},
        {"method":"artist.getTopTags","artist": artist, "autocorrect": 1},
    ]:
        try:
            r = requests.get(LASTFM_API, params={**params, "api_key":key, "format":"json"},
                             headers=_headers(), timeout=10)
            data = r.json()
            if "error" in data:
                continue
            key2 = "album" if "album" in params["method"] else "artist"
            raw  = data.get(key2, {}).get("toptags", {}).get("tag", [])
            if isinstance(raw, dict):
                raw = [raw]
            items = [{"name":t["name"],"count":int(t.get("count",0))}
                     for t in raw if t.get("name")]
            g = _pick_best_genre(items)
            if g:
                return g
        except Exception:
            pass
        time.sleep(0.3)
    return None


# ── main enrich function ──────────────────────────────────────────────────────

def enrich_genre_year(path: Path, do_genre: bool, do_year: bool):
    """Fill missing genre/year via MusicBrainz + Last.fm (two-pass)."""
    mp3_folders = sorted({f.parent for f in path.rglob("*.mp3")})
    if not mp3_folders:
        print("  No MP3 folders found.")
        return
    if do_genre and not CFG.get("lastfm_key"):
        print("  [i] No Last.fm key → Last.fm fallback disabled. Set it in G → Config.")
    mode     = " + ".join((["genre"] if do_genre else []) + (["year"] if do_year else []))
    total    = len(mp3_folders)
    log_path = setup_logging(f"enrich_{mode.replace(' + ','_')}")
    print(f"\n  Mode: {mode} | {total} album folders | Progress bar active…\n")

    artist_genres: dict = {}
    deferred            = []
    misses              = []
    progress_t          = start_progress(total)

    with open(log_path, "w") as log:
        for i, folder in enumerate(mp3_folders, 1):
            if _exit_flag:
                break
            mp3s = sorted(folder.glob("*.mp3"))
            try:
                audio = MP3(mp3s[0], ID3=ID3)
                tags  = audio.tags
                if tags is None:
                    advance_progress(folder.name)
                    continue
                artist    = str(tags.get("TPE1") or tags.get("TPE2") or "").strip() or None
                album     = str(tags.get("TALB") or "").strip() or None
                has_genre = bool(str(tags.get("TCON","")).strip())
                has_year  = bool(str(tags.get("TDRC","")).strip())
            except Exception:
                advance_progress(folder.name)
                continue

            need_genre = do_genre and not has_genre
            need_year  = do_year  and not has_year
            if not need_genre and not need_year:
                advance_progress(folder.name)
                continue

            releases = _mb_search_releases(artist or "", album or "") if (need_genre or need_year) else []
            genre = year = None

            if need_genre:
                if releases:
                    genre = _mb_genre(releases)
                if not genre:
                    genre = _lastfm_genre(artist or "", album or "")
                if genre:
                    artist_genres.setdefault((artist or "").lower(), []).append(genre)
                else:
                    deferred.append({"folder": folder, "artist": artist,
                                     "album": album, "mp3s": mp3s})

            if need_year:
                if releases:
                    year = _mb_year(releases)
                if not year:
                    misses.append(f"YEAR {folder}")
                    log.write(f"YEAR_MISS {folder}\n")

            if genre or year:
                for mp3 in mp3s:
                    try:
                        t = ID3(mp3)
                        if genre:
                            t.delall("TCON"); t.add(TCON(encoding=3, text=[genre]))
                        if year:
                            t.delall("TDRC"); t.delall("TYER")
                            t.add(TDRC(encoding=3, text=[str(year)]))
                        t.save(mp3)
                    except Exception as e:
                        log.write(f"WRITE_ERR {mp3}: {e}\n")

            advance_progress(folder.name)
            if i < total:
                time.sleep(1)

        # Pass 2: artist-majority fallback
        if do_genre and deferred:
            with _prog_lock:
                _prog["label"] = "artist fallback…"
            for entry in deferred:
                if _exit_flag:
                    break
                akey     = (entry["artist"] or "").lower()
                fallback = None
                known    = artist_genres.get(akey, [])
                if known:
                    fallback = Counter(known).most_common(1)[0][0]
                if not fallback:
                    fallback = _lastfm_genre(entry["artist"] or "", entry["album"] or "")
                if fallback:
                    for mp3 in entry["mp3s"]:
                        try:
                            t = ID3(mp3)
                            t.delall("TCON"); t.add(TCON(encoding=3, text=[fallback]))
                            t.save(mp3)
                        except Exception:
                            pass
                    log.write(f"FALLBACK_GENRE {entry['folder'].name}: {fallback}\n")
                else:
                    misses.append(f"GENRE {entry['folder']}")
                    log.write(f"GENRE_MISS {entry['folder']}\n")

    finish_progress(progress_t)
    print(f"\n  Processed: {total}  Tagged: {total - len(misses)}  Misses: {len(misses)}")
    print(f"  Log: {log_path}")


# ── interactive MusicBrainz tagger ────────────────────────────────────────────

def interactive_mb_tagger(start_path: Path):
    """Interactive release search → select → apply full tag set + art."""
    if not check_dep("musicbrainzngs", "pip install musicbrainzngs"):
        return
    import musicbrainzngs
    _mb_init()

    path = start_path
    # Navigate down to an album folder if needed
    while True:
        mp3s = sorted(path.glob("*.mp3"))
        if mp3s:
            break
        subdirs = sorted([d for d in path.iterdir() if d.is_dir() and not d.name.startswith(".")])
        if not subdirs:
            print("  No MP3s or subdirectories found.")
            return
        print(f"\n  Folders in {path.name}:")
        for i, d in enumerate(subdirs, 1):
            print(f"    {i:>2}. {d.name}")
        try:
            sel = input("  Select folder # (or path): ").strip()
        except EOFError:
            return
        if sel.lower() in ("q","0"):
            return
        if sel.isdigit() and 1 <= int(sel) <= len(subdirs):
            path = subdirs[int(sel)-1]
        else:
            p = Path(sel).expanduser().resolve()
            if p.is_dir():
                path = p
            else:
                print("  Not a valid directory.")
                return

    while True:
        mp3s = sorted(path.glob("*.mp3"))
        print(f"\n  Folder: {path.name} ({len(mp3s)} MP3s)")
        try:
            artist_in = input("  Artist name: ").strip()
        except EOFError:
            return
        if not artist_in:
            return

        album_hint = path.name
        while True:
            try:
                raw = input(f"  Album query [{album_hint}]: ").strip()
            except EOFError:
                return
            if not raw:
                raw = album_hint
            clean = re.sub(r"^\d{4}[-_ ]", "", raw)
            try:
                result   = musicbrainzngs.search_releases(
                    query=f"artist:({artist_in}) release:({clean})", limit=50)
                releases = result["release-list"]
            except Exception as e:
                print(f"  Search error: {e}")
                break

            filtered = [r for r in releases
                        if r.get("artist-credit-phrase","").lower() == artist_in.lower()]
            if not filtered:
                filtered = releases[:20]
            if not filtered:
                print("  No results.")
                try:
                    if input("  Retry? [y/N]: ").lower() != "y":
                        break
                except EOFError:
                    return
                continue

            print(f"\n  {'#':<3} {'Artist':<15} {'Album':<30} {'Date':<11} {'Trk':<4} Format")
            print("  " + "─"*78)
            for i, r in enumerate(filtered, 1):
                ar  = r.get("artist-credit-phrase","?")[:14]
                tit = r.get("title","?")[:29]
                dat = r.get("date","?")
                trk = r.get("medium-track-count","?")
                fmt = ((r.get("medium-list") or [{}])[0]).get("format","?")
                print(f"  {i:<3} {ar:<15} {tit:<30} {dat:<11} {trk:<4} {fmt}")
            print("  " + "─"*78)

            try:
                choice = input("  Select # (r=retry, q=skip): ").strip().lower()
            except EOFError:
                return
            if choice == "r":
                continue
            if choice == "q":
                break
            if not choice.isdigit() or not (1 <= int(choice) <= len(filtered)):
                print("  Invalid selection.")
                continue

            release_id = filtered[int(choice)-1]["id"]
            try:
                res     = musicbrainzngs.get_release_by_id(release_id,
                                                           includes=["artists","recordings"])
                details = res["release"]
                year    = str(_parse_year(details.get("date","")) or "")
                art     = None
                print("  Fetching artwork…", end="", flush=True)
                try:
                    art = _ensure_real_jpeg(musicbrainzngs.get_image_front(release_id, size=500))
                    print(" OK" if art else " not found")
                except Exception:
                    print(" not found")

                tracks_list  = [t for m in details.get("medium-list",[])
                                for t in m.get("track-list",[])]
                artist_phrase = details.get("artist-credit-phrase", artist_in)

                for i, mp3 in enumerate(mp3s):
                    try:
                        audio = MP3(mp3, ID3=ID3)
                        if audio.tags is None:
                            audio.add_tags()
                        if i < len(tracks_list):
                            t = tracks_list[i]
                            audio.tags["TIT2"] = TIT2(encoding=3, text=t["recording"]["title"])
                            audio.tags["TRCK"] = TRCK(encoding=3, text=str(t["position"]))
                        audio.tags["TPE1"] = TPE1(encoding=3, text=artist_phrase)
                        audio.tags["TPE2"] = TPE2(encoding=3, text=artist_phrase)
                        audio.tags["TALB"] = TALB(encoding=3, text=details["title"])
                        audio.tags["TDRC"] = TDRC(encoding=3, text=year)
                        if art:
                            audio.tags.delall("APIC")
                            audio.tags.add(APIC(encoding=3, mime="image/jpeg",
                                                type=3, desc="Front Cover", data=art))
                        audio.save()
                        if i < len(tracks_list):
                            print(f"    ✓ {tracks_list[i]['position']}. {tracks_list[i]['recording']['title']}")
                    except Exception as e:
                        print(f"    [!] {mp3.name}: {e}")
                print(f"  Tagged {len(mp3s)} files with year: {year or '(not found)'}")
            except Exception as e:
                print(f"  [!] Error applying tags: {e}")
            break

        # Offer sibling album
        parent   = path.parent
        siblings = sorted([d for d in parent.iterdir()
                           if d.is_dir() and not d.name.startswith(".")])
        if siblings:
            print(f"\n  Albums in {parent.name}:")
            for i, s in enumerate(siblings, 1):
                print(f"    {i:>2}. {s.name}", end="   ")
                if i % 2 == 0:
                    print()
            print()
        try:
            cont = input(f"\n  Tag another album for {artist_in}? [y/N]: ").strip().lower()
        except EOFError:
            return
        if cont != "y":
            return
        try:
            sel = input("  Folder # or path: ").strip()
        except EOFError:
            return
        if sel.isdigit() and 1 <= int(sel) <= len(siblings):
            path = siblings[int(sel)-1]
        else:
            p = Path(sel).expanduser().resolve()
            if p.is_dir():
                path = p
            else:
                return
        # reload mp3s for next loop iteration
        mp3s = _audio_files(path, ".mp3")


def fetch_and_embed_lyrics(path: Path):
    """Fetch lyrics from LRCLIB → embed USLT in ID3 + write .lrc sidecar."""
    mp3s = list(path.rglob("*.mp3"))
    print(f"  Found {len(mp3s)} MP3 files")
    found = missing = 0
    for mp3 in mp3s:
        if _exit_flag:
            break
        try:
            audio  = MP3(mp3, ID3=ID3)
            artist = str(audio.get("TPE1","") or "").strip()
            title  = str(audio.get("TIT2","") or "").strip()
            album  = str(audio.get("TALB","") or "").strip()
            dur    = int(audio.info.length)
            print(f"  Searching: {artist} — {title}…", end="\r")
            r = requests.get(LRCLIB_API, params={
                "artist_name": artist, "track_name": title,
                "album_name": album, "duration": dur}, timeout=10)
            if r.status_code == 200:
                data = r.json()
                if data.get("plainLyrics"):
                    if audio.tags is None:
                        audio.add_tags()
                    audio.tags.add(USLT(encoding=3, lang="eng", desc="", text=data["plainLyrics"]))
                    audio.save()
                    if data.get("syncedLyrics"):
                        mp3.with_suffix(".lrc").write_text(data["syncedLyrics"], encoding="utf-8")
                    found += 1
                    print(f"  ✓ {title}" + " "*30)
                else:
                    missing += 1
                    print(f"  ✗ {title} — no lyrics" + " "*20)
            else:
                missing += 1
        except Exception as e:
            print(f"  [!] {mp3.name}: {e}")
            missing += 1
    print(f"\n  Done: {found} found, {missing} missing")


def run_section_tag_enrich():
    while True:
        print("""
  C. Tags — Enrich
  ─────────────────────────────────────────────────────────
  1  Fill missing genre tags       (MusicBrainz + Last.fm two-pass)
  2  Fill missing year tags        (MusicBrainz oldest release)
  3  Fill genre + year             (combined, most efficient)
  4  Interactive MusicBrainz tagger  (search → select → full tag set + art)
  5  Fetch and embed lyrics        (LRCLIB → USLT + .lrc sidecar)
  0  Back""")
        choice = input("\n  Choice: ").strip()
        if choice in ("0", "q"):
            return
        path = prompt_path("Library path")
        if not path:
            continue
        if   choice == "1": enrich_genre_year(path, do_genre=True,  do_year=False)
        elif choice == "2": enrich_genre_year(path, do_genre=False, do_year=True)
        elif choice == "3": enrich_genre_year(path, do_genre=True,  do_year=True)
        elif choice == "4": interactive_mb_tagger(path)
        elif choice == "5": fetch_and_embed_lyrics(path)


# ════════════════════════════════════════════════════════════════════════════
# D. Audit
# ════════════════════════════════════════════════════════════════════════════

def audit_golden_tags(path: Path):
    """Report tag inconsistencies and junk tags (read-only)."""
    CRITICAL = {"TALB": "Album Name", "TPE2": "Album Artist", "TDRC": "Date"}
    problems = 0
    for mp3_dir in sorted({f.parent for f in path.rglob("*.mp3")}):
        mp3s  = sorted(mp3_dir.glob("*.mp3"))
        group = defaultdict(lambda: defaultdict(list))
        junk  = set()
        for mp3 in mp3s:
            try:
                audio = ID3(mp3)
                for k in audio.keys():
                    base = k.split(":")[0]
                    if base not in GOLDEN_TAGS and base != "APIC":
                        junk.add(base)
                for tag_id, label in CRITICAL.items():
                    val = audio.get(tag_id)
                    v   = (str(val.text[0]).lower().strip()
                           if (hasattr(val,"text") and val.text)
                           else str(val).lower().strip())
                    group[label][v].append(mp3.name)
            except Exception:
                continue
        conflicts = {lbl: vmap for lbl, vmap in group.items() if len(vmap) > 1}
        if conflicts or junk:
            problems += 1
            print(f"\n  {'='*68}")
            print(f"  FOLDER: {mp3_dir}")
            for label, vmap in conflicts.items():
                print(f"  [!] CONFLICT: {label}")
                for v, files in vmap.items():
                    print(f"      '{v}'  ({len(files)} tracks)")
            if junk:
                print(f"  [!] JUNK TAGS: {sorted(junk)}")
    print(f"\n  {'='*68}")
    print(f"  Scan complete. {problems} folder(s) with issues.")


def compare_two_files(file1: Path, file2: Path):
    """Side-by-side tag diff between two audio files."""
    def get_tags(p: Path) -> dict:
        audio = mutagen.File(str(p))
        if not audio:
            return {}
        tags = {}
        if hasattr(audio,"tags") and audio.tags:
            for k, v in audio.tags.items():
                tags[k] = str(v)[:120] if not isinstance(v, bytes) else f"<bytes {len(v)}>"
        return tags

    t1, t2   = get_tags(file1), get_tags(file2)
    all_keys = sorted(set(t1) | set(t2))
    W        = 38
    print(f"\n  {'TAG':<18} | {'FILE 1':<{W}} | {'FILE 2':<{W}}")
    print("  " + "─" * (22 + W * 2))
    diffs = 0
    for k in all_keys:
        v1 = t1.get(k,"[MISSING]")
        v2 = t2.get(k,"[MISSING]")
        m  = "!" if v1 != v2 else " "
        if v1 != v2:
            diffs += 1
        d1 = (v1[:W-2]+"…") if len(v1)>W else v1
        d2 = (v2[:W-2]+"…") if len(v2)>W else v2
        print(f"  {m} {k:<17} | {d1:<{W}} | {d2:<{W}}")
    print(f"\n  {diffs} difference(s)" if diffs else "\n  Files are identical.")


def compare_two_folders(folder1: Path, folder2: Path):
    """Compare the first audio file found in each folder."""
    def first_audio(p: Path):
        for f in sorted(p.rglob("*")):
            if f.is_file() and f.suffix.lower() in AUDIO_EXTS:
                return f
        return None

    f1, f2 = first_audio(folder1), first_audio(folder2)
    if not f1 or not f2:
        print("  Could not find audio in one or both folders.")
        return
    print(f"  Comparing: {f1.name}  vs  {f2.name}")
    compare_two_files(f1, f2)


def run_section_audit():
    while True:
        print("""
  D. Audit  (read-only)
  ─────────────────────────────────────────────────────────
  1  Audit Golden Tag compliance   (junk tags + consistency report)
  2  Compare tags: two files
  3  Compare tags: two folders
  0  Back""")
        choice = input("\n  Choice: ").strip()
        if choice in ("0", "q"):
            return
        if choice == "1":
            path = prompt_path("Library path")
            if path:
                audit_golden_tags(path)
        elif choice == "2":
            setup_readline()
            try:
                f1 = Path(input("  File 1: ").strip().strip("'\"")).expanduser()
                f2 = Path(input("  File 2: ").strip().strip("'\"")).expanduser()
            except EOFError:
                continue
            if f1.is_file() and f2.is_file():
                compare_two_files(f1, f2)
            else:
                print("  One or both files not found.")
        elif choice == "3":
            p1 = prompt_path("Folder 1")
            p2 = prompt_path("Folder 2")
            if p1 and p2:
                compare_two_folders(p1, p2)


# ════════════════════════════════════════════════════════════════════════════
# E. Convert
# ════════════════════════════════════════════════════════════════════════════

def _ffmpeg_convert(src: Path, dest: Path, extra: list) -> bool:
    result = subprocess.run(
        ["ffmpeg", "-y", "-i", str(src)] + extra + [str(dest)],
        capture_output=True, text=True)
    if result.returncode == 0:
        print(f"  ✓ {src.name}  →  {dest.name}")
        return True
    print(f"  ✗ {src.name}")
    for line in result.stderr.splitlines():
        if any(w in line for w in ("Error","error","Invalid")):
            print(f"    {line.strip()}")
    return False


def _run_conversion(path: Path, src_exts: set, dest_ext: str, bitrate: str, extra_args: list,
                    delete_original: bool = False):
    if not check_ffmpeg():
        return
    sources = [f for f in path.rglob("*") if f.is_file() and f.suffix.lower() in src_exts]
    if not dry_run_confirm(f"Convert {len(sources)} files → {dest_ext}",
                           [f.name for f in sources[:20]], "file"):
        return
    ok = fail = deleted = 0
    for src in sources:
        if _exit_flag:
            break
        dest = src.with_suffix(dest_ext)
        if _ffmpeg_convert(src, dest, extra_args):
            ok += 1
            if delete_original:
                src.unlink()
                deleted += 1
        else:
            fail += 1
    suffix = f", {deleted} originals deleted" if deleted else ""
    print(f"\n  Done: {ok} converted, {fail} failed{suffix}")


def run_section_convert():
    while True:
        print("""
  E. Convert  (requires ffmpeg)
  ─────────────────────────────────────────────────────────
  1  FLAC  →  MP3 320kbps
  2  WAV   →  FLAC  (lossless)
  3  M4A / MP4  →  MP3 320kbps
  0  Back""")
        choice = input("\n  Choice: ").strip()
        if choice in ("0", "q"):
            return
        path = prompt_path("Library path")
        if not path:
            continue
        mp3_args  = ["-vn", "-ab", "320k", "-map_metadata", "0", "-id3v2_version", "3"]
        flac_args = ["-compression_level", "8"]
        if   choice == "1": _run_conversion(path, {".flac"},      ".mp3",  "320k", mp3_args,  delete_original=True)
        elif choice == "2": _run_conversion(path, {".wav"},        ".flac", "lossless", flac_args)
        elif choice == "3": _run_conversion(path, {".m4a",".mp4"}, ".mp3",  "320k", mp3_args,  delete_original=True)


# ════════════════════════════════════════════════════════════════════════════
# F. Utilities
# ════════════════════════════════════════════════════════════════════════════

def split_mp3_by_cue(cue_file: Path):
    """Split a long MP3 into tracks based on a timestamp/cue file."""
    if not check_ffmpeg():
        return

    re_a = re.compile(r"^(.+?)\s+(?:(\d+):)?(\d{1,2}):(\d{2})$")
    re_b = re.compile(r"^(?:(\d+):)?(\d{1,2}):(\d{2})\s+(.+)$")

    def parse_cue(p: Path) -> list:
        songs = []
        for line in p.read_text(encoding="utf-8", errors="replace").splitlines():
            line = line.strip()
            if not line:
                continue
            ma = re_a.match(line)
            mb = re_b.match(line)
            if ma:
                name = re.sub(r"^\d+\.\s*", "", ma.group(1).strip())
                h  = int(ma.group(2)) if ma.group(2) else 0
                mi, s = int(ma.group(3)), int(ma.group(4))
            elif mb:
                h  = int(mb.group(1)) if mb.group(1) else 0
                mi, s = int(mb.group(2)), int(mb.group(3))
                name = mb.group(4).strip()
            else:
                print(f"  [!] Unrecognized line: {line}")
                continue
            songs.append((name, h*3600 + mi*60 + s))
        return songs

    songs = parse_cue(cue_file)
    if not songs:
        print("  No tracks parsed.")
        return

    print(f"\n  {'#':<3} {'Track':<40} Start")
    for i, (name, sec) in enumerate(songs, 1):
        ts = f"{sec//3600:02d}:{(sec%3600)//60:02d}:{sec%60:02d}"
        print(f"  {i:02d}. {name[:39]:<40} {ts}")

    cue_dir        = cue_file.parent
    mp3_candidates = list(cue_dir.glob("*.mp3"))
    if not mp3_candidates:
        setup_readline()
        try:
            mp3_path = Path(input("  MP3 file path: ").strip()).expanduser()
        except EOFError:
            return
    elif len(mp3_candidates) == 1:
        mp3_path = mp3_candidates[0]
        print(f"  Using: {mp3_path.name}")
    else:
        for i, f in enumerate(mp3_candidates, 1):
            print(f"  {i}. {f.name}")
        try:
            sel = input("  Select MP3 #: ").strip()
        except EOFError:
            return
        if sel.isdigit() and 1 <= int(sel) <= len(mp3_candidates):
            mp3_path = mp3_candidates[int(sel)-1]
        else:
            mp3_path = Path(sel).expanduser()

    if not mp3_path.is_file():
        print("  MP3 file not found.")
        return

    print()
    ok = fail = 0
    for i, (name, start_sec) in enumerate(songs):
        safe     = re.sub(r"[^\w\s-]", "", name)
        safe     = re.sub(r"\s+", "_", safe).lower()
        out_path = cue_dir / f"{i+1:02d}-{safe}.mp3"
        cmd = ["ffmpeg", "-y", "-i", str(mp3_path), "-ss", str(start_sec)]
        if i < len(songs) - 1:
            cmd += ["-to", str(songs[i+1][1])]
        cmd += ["-c", "copy", str(out_path)]
        print(f"  [{i+1}/{len(songs)}] {out_path.name}…", end=" ", flush=True)
        result = subprocess.run(cmd, capture_output=True)
        if result.returncode == 0:
            print("OK")
            ok += 1
        else:
            print("FAILED")
            fail += 1

    print(f"\n  Done! {ok} tracks exported to {cue_dir}" + (f"  ({fail} failed)" if fail else ""))
    try:
        ans = input("  Delete original MP3 + cue file? [y/N]: ").strip().lower()
    except EOFError:
        return
    if ans == "y":
        mp3_path.unlink()
        cue_file.unlink()
        print("  Originals deleted.")


def purge_mac_garbage(path: Path):
    """Delete .DS_Store, .AppleDouble, ._*, __MACOSX and similar macOS junk."""
    JUNK_NAMES = {".DS_Store",".AppleDouble","__MACOSX",".Spotlight-V100",".Trashes"}
    items = []
    for root, dirs, files in os.walk(str(path), topdown=False):
        rp = Path(root)
        for f in files:
            if f in JUNK_NAMES or f.startswith("._"):
                items.append(str(rp / f))
        for d in dirs:
            if d in JUNK_NAMES:
                items.append(str(rp / d) + "/")
    if not dry_run_confirm(f"Delete {len(items)} macOS junk items", items):
        return
    deleted = 0
    for item in items:
        p = Path(item.rstrip("/"))
        try:
            if p.is_dir():
                shutil.rmtree(p)
            else:
                p.unlink()
            deleted += 1
        except Exception as e:
            print(f"  [!] {p}: {e}")
    print(f"  Deleted: {deleted} items")


def run_section_utilities():
    while True:
        print("""
  F. Utilities
  ─────────────────────────────────────────────────────────
  1  Split MP3 by cue / timestamp file  (requires ffmpeg)
  2  Purge macOS metadata garbage  (.DS_Store, ._, .AppleDouble…)
  0  Back""")
        choice = input("\n  Choice: ").strip()
        if choice in ("0", "q"):
            return
        if choice == "1":
            setup_readline()
            try:
                raw = input("  Path to cue/txt file: ").strip().strip("'\"")
            except EOFError:
                continue
            cue = Path(raw).expanduser()
            if cue.is_file():
                split_mp3_by_cue(cue)
            else:
                print("  File not found.")
        elif choice == "2":
            path = prompt_path("Library path")
            if path:
                purge_mac_garbage(path)


# ════════════════════════════════════════════════════════════════════════════
# G. Configuration
# ════════════════════════════════════════════════════════════════════════════

def run_section_config():
    while True:
        lastfm_status = "set" if CFG.get("lastfm_key") else "NOT SET"
        fanart_preview = (CFG.get("fanart_key","")[:8] + "…") if CFG.get("fanart_key") else "NOT SET"
        print(f"""
  G. Configuration
  ─────────────────────────────────────────────────────────
  1  Last.fm API key       [{lastfm_status}]
  2  Fanart.tv API key     [{fanart_preview}]
  3  MusicBrainz email     [{CFG.get('mb_email','')}]
  4  Default library path  [{CFG.get('default_library_path','') or 'not set'}]
  5  Show full config
  0  Back""")
        choice = input("\n  Choice: ").strip()
        if choice in ("0", "q"):
            return
        try:
            if choice == "1":
                v = input("  Last.fm API key (https://www.last.fm/api/account/create): ").strip()
                if v:
                    CFG["lastfm_key"] = v
                    save_config()
            elif choice == "2":
                v = input("  Fanart.tv API key: ").strip()
                if v:
                    CFG["fanart_key"] = v
                    save_config()
            elif choice == "3":
                v = input("  MusicBrainz contact email: ").strip()
                if v:
                    CFG["mb_email"] = v
                    _mb_init()
                    save_config()
            elif choice == "4":
                p = prompt_path("Default library path")
                if p:
                    CFG["default_library_path"] = str(p)
                    save_config()
            elif choice == "5":
                print()
                for k, v in CFG.items():
                    masked = v[:4] + "…" if (k.endswith("_key") and len(v) > 4) else v
                    print(f"    {k:<25} {masked}")
        except EOFError:
            return


# ════════════════════════════════════════════════════════════════════════════
# H. Workflows
# ════════════════════════════════════════════════════════════════════════════

def _check_one_album(album: Path, log) -> bool:
    """
    Interactive per-album consistency check.
    Prompts only when values are missing or conflict across tracks.
    Returns True if any tags or folder were changed.
    """
    mp3s = _audio_files(album, ".mp3")
    if not mp3s:
        return False

    raw_vals: dict = {"TPE1": [], "TPE2": [], "TALB": [], "TDRC": []}
    for mp3 in mp3s:
        try:
            audio = ID3(mp3)
            for tag in raw_vals:
                v = audio.get(tag)
                val = str(v.text[0]).strip() if (v and hasattr(v, "text") and v.text) else ""
                raw_vals[tag].append(val)
        except Exception:
            pass

    def majority(vals):
        non_empty = [v for v in vals if v]
        return Counter(non_empty).most_common(1)[0][0] if non_empty else ""

    def distinct(vals):
        return [v for v, _ in Counter(v for v in vals if v).most_common()]

    tpe1 = majority(raw_vals["TPE1"])
    tpe2 = majority(raw_vals["TPE2"])
    talb = majority(raw_vals["TALB"])
    tdrc = majority(raw_vals["TDRC"])
    year = _parse_year(tdrc)

    tpe1_vals = distinct(raw_vals["TPE1"])
    tpe2_vals = distinct(raw_vals["TPE2"])
    talb_vals = distinct(raw_vals["TALB"])

    # Compilation: TPE1 varies but TPE2 is consistent → don't flag TPE1
    is_compilation = (len(tpe1_vals) > 1 and len(tpe2_vals) <= 1)

    changed = False
    n = len(mp3s)

    def _write_tag(tag_id, frame_cls, value):
        for mp3 in mp3s:
            try:
                audio = ID3(mp3)
                audio.add(frame_cls(encoding=3, text=value))
                audio.save(v2_version=3)
            except Exception as e:
                log.write(f"ERR_{tag_id} {mp3}: {e}\n")
        log.write(f"SET {tag_id}='{value}' in {album}\n")

    def _prompt_choices(label, tag_id, found_vals):
        print(f"  [!] {label} conflict:")
        for i, v in enumerate(found_vals, 1):
            count = raw_vals[tag_id].count(v)
            print(f"      {i}. '{v}'  ({count}/{n} files)")
        print(f"      c. Enter custom value    s. Skip album")
        try:
            sel = input("  Choice: ").strip().lower()
        except EOFError:
            return None
        if sel == "s":
            return None
        if sel == "c":
            try:
                return input("  Value: ").strip() or None
            except EOFError:
                return None
        if sel.isdigit() and 1 <= int(sel) <= len(found_vals):
            return found_vals[int(sel) - 1]
        return found_vals[0]

    # ── TALB ─────────────────────────────────────────────────────────────────
    if len(talb_vals) > 1:
        chosen = _prompt_choices("TALB (album name)", "TALB", talb_vals)
        if chosen is None:
            return changed
        talb = chosen
        _write_tag("TALB", TALB, chosen)
        changed = True

    # ── TPE2 (album artist) ──────────────────────────────────────────────────
    if not tpe2:
        print(f"  [!] TPE2 (album artist) missing")
        if tpe1:
            print(f"      TPE1 = '{tpe1}'")
            try:
                ans = input("  Apply as album artist? [Y/n]: ").strip().lower()
            except EOFError:
                ans = ""
            val = tpe1 if ans != "n" else ""
        else:
            try:
                val = input("  Enter album artist (or s to skip): ").strip()
            except EOFError:
                val = "s"
            if val == "s":
                val = ""
        if val:
            tpe2 = val
            _write_tag("TPE2", TPE2, val)
            changed = True
    elif len(tpe2_vals) > 1:
        chosen = _prompt_choices("TPE2 (album artist)", "TPE2", tpe2_vals)
        if chosen is None:
            return changed
        tpe2 = chosen
        _write_tag("TPE2", TPE2, chosen)
        changed = True

    # ── TPE1 (track artist) — skip for compilations ──────────────────────────
    if not is_compilation and len(tpe1_vals) > 1:
        chosen = _prompt_choices("TPE1 (artist)", "TPE1", tpe1_vals)
        if chosen is None:
            return changed
        _write_tag("TPE1", TPE1, chosen)
        changed = True

    # ── TDRC (year) ──────────────────────────────────────────────────────────
    if not year:
        print(f"  [!] TDRC (year) missing or invalid: '{tdrc}'")
        try:
            raw = input("  Release year (or s to skip): ").strip().lower()
        except EOFError:
            raw = "s"
        if raw == "s":
            return changed
        year = _parse_year(raw)
        if year:
            _write_tag("TDRC", TDRC, str(year))
            changed = True
        else:
            print(f"  [!] Invalid year, skipping folder rename.")
            return changed

    # ── Folder name ──────────────────────────────────────────────────────────
    if talb and year:
        expected = f"{year}-{_sanitize_slug(talb)}"
        if album.name != expected:
            new_path = album.parent / expected
            if new_path.exists():
                print(f"  [!] Cannot rename to {expected} — already exists")
            else:
                album.rename(new_path)
                log.write(f"RENAMED {album.name} → {expected}\n")
                print(f"  Renamed → {expected}")
                changed = True

    return changed


def _cross_album_check(albums: list, log) -> bool:
    """
    Check TPE1 and TPE2 consistency across all albums in the list.
    Prompts user to pick a canonical value if multiple are found.
    Returns True if any tags were changed.
    """
    if len(albums) < 2:
        return False

    def _read_tag(album, tag_id):
        mp3s = _audio_files(album, ".mp3")
        if not mp3s:
            return ""
        try:
            v = ID3(mp3s[0]).get(tag_id)
            return str(v.text[0]).strip() if (v and hasattr(v, "text") and v.text) else ""
        except Exception:
            return ""

    def _apply_tag(albums, tag_id, frame_cls, value, log):
        for album in albums:
            for mp3 in _audio_files(album, ".mp3"):
                try:
                    audio = ID3(mp3)
                    audio.add(frame_cls(encoding=3, text=value))
                    audio.save(v2_version=3)
                except Exception as e:
                    log.write(f"ERR_{tag_id} {mp3}: {e}\n")
        log.write(f"CROSS_ALBUM {tag_id}='{value}'\n")

    def _prompt_cross(label, vals_by_album):
        distinct = list(dict.fromkeys(v for v in vals_by_album.values() if v))
        if len(distinct) <= 1:
            return None
        counts = Counter(vals_by_album.values())
        print(f"\n  [!] {label} differs across albums:")
        for i, v in enumerate(distinct, 1):
            print(f"      {i}. '{v}'  ({counts[v]} album{'s' if counts[v] != 1 else ''})")
        print(f"      c. Enter custom value    s. Skip")
        try:
            sel = input("  Choice: ").strip().lower()
        except EOFError:
            return None
        if sel == "s":
            return None
        if sel == "c":
            try:
                return input("  Value: ").strip() or None
            except EOFError:
                return None
        if sel.isdigit() and 1 <= int(sel) <= len(distinct):
            return distinct[int(sel) - 1]
        return None

    changed = False

    tpe2_vals = {a: _read_tag(a, "TPE2") for a in albums}
    chosen = _prompt_cross("TPE2 (album artist)", tpe2_vals)
    if chosen:
        _apply_tag(albums, "TPE2", TPE2, chosen, log)
        print(f"  TPE2 set to '{chosen}' across {len(albums)} albums")
        changed = True

    tpe1_vals = {a: _read_tag(a, "TPE1") for a in albums}
    chosen = _prompt_cross("TPE1 (artist)", tpe1_vals)
    if chosen:
        _apply_tag(albums, "TPE1", TPE1, chosen, log)
        print(f"  TPE1 set to '{chosen}' across {len(albums)} albums")
        changed = True

    return changed


def run_workflow_tags(path: Path, level: str = None):
    """Interactive tag consistency check for every album, then golden-set sanitize."""
    albums = list(iter_albums(path, level))
    if not albums:
        print("  No album folders found.")
        return
    print(f"  {len(albums)} albums found. Checking consistency…")
    log_path = setup_logging("workflow_tags")
    updated  = 0
    with open(log_path, "w") as log:
        for i, album in enumerate(albums, 1):
            if _exit_flag:
                break
            print(f"\n  [{i}/{len(albums)}] {album.parent.name}/{album.name}")
            if _check_one_album(album, log):
                updated += 1
        if not _exit_flag:
            if level in ("artist", "album"):
                albums = list(iter_albums(path, level))
                if _cross_album_check(albums, log):
                    updated += 1
            else:
                for artist in iter_artists(path, level):
                    if _exit_flag:
                        break
                    artist_albums = list(iter_albums(artist, "artist"))
                    if len(artist_albums) >= 2:
                        if _cross_album_check(artist_albums, log):
                            updated += 1
    print(f"\n  Consistency pass: {updated}/{len(albums)} albums updated  |  Log: {log_path}")
    print("\n  Running golden-set sanitize…")
    sanitize_to_golden_set(path, auto=True, level=level)


def run_workflow_artwork(path: Path, level: str = None):
    """Artist thumbnails (Deezer) → normalize album artwork per album."""
    print("\n  Step 1/2 — Artist thumbnails (Deezer)…")
    _run_fetch_artist_thumbs(path, level)
    if _exit_flag:
        return
    print("\n  Step 2/2 — Normalize album artwork…")
    normalize_album_artwork(path, level)


def run_section_workflows():
    while True:
        print("""
  H. Workflows
  ─────────────────────────────────────────────────────────
  1  Tag consistency + folder rename   (interactive per album)
  2  Sanitize to golden set            (batch)
  3  Fetch & embed artwork             (thumb → cover → embed)
  4  Full onboarding                   (1 → 2 → 3)
  0  Back""")
        choice = input("\n  Choice: ").strip()
        if choice in ("0", "q"):
            return
        path = prompt_path("Library path")
        if not path:
            continue
        level = prompt_level(path)
        if choice == "1":
            run_workflow_tags(path, level)
        elif choice == "2":
            sanitize_to_golden_set(path, level=level)
        elif choice == "3":
            run_workflow_artwork(path, level)
        elif choice == "4":
            run_workflow_tags(path, level)
            if not _exit_flag:
                run_workflow_artwork(path, level)
            if not _exit_flag:
                print("\n  Running lowercase tags…")
                lowercase_all_text_frames(path, auto=True)


# ════════════════════════════════════════════════════════════════════════════
# Main
# ════════════════════════════════════════════════════════════════════════════

def main():
    global _last_path
    load_config()
    _mb_init()

    # Restore default library path as the prompt default
    if CFG.get("default_library_path"):
        p = Path(CFG["default_library_path"])
        if p.is_dir():
            _last_path = p

    print(f"""
  ═══════════════════════════════════════════════════════
    musiclib v{VERSION}  —  Navidrome Music Library Manager
  ═══════════════════════════════════════════════════════
    Config : {CONFIG_FILE}
    Logs   : {LOG_DIR}""")

    MENU = """
  A  Cover Art
  B  Tags — Cleanup
  C  Tags — Enrich
  D  Audit
  E  Convert
  F  Utilities
  G  Configuration
  H  Workflows  (onboarding pipeline)
  Q  Quit
"""
    DISPATCH = {
        "a": run_section_cover_art,
        "b": run_section_tag_cleanup,
        "c": run_section_tag_enrich,
        "d": run_section_audit,
        "e": run_section_convert,
        "f": run_section_utilities,
        "g": run_section_config,
        "h": run_section_workflows,
    }

    while True:
        print(MENU)
        try:
            choice = input("  Choice: ").strip().lower()
        except (EOFError, KeyboardInterrupt):
            print("\n  Goodbye.")
            break

        if choice == "q":
            print("  Goodbye.")
            break
        elif choice in DISPATCH:
            DISPATCH[choice]()
        elif choice:
            print("  Unknown choice.")


if __name__ == "__main__":
    main()
