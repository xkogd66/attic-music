#!/usr/bin/env python3
"""Library cover check. Run from the library root (e.g. /var/lib/media/music/mp3).

Layout expected: <letter>/<artist>/<year>-<album_with_underscores>/
Reports, one at a time with a fix and a pause:
  1. artist folders without cover.jpg
  2. album folders without cover.jpg
  3. album folders whose name won't match their tags the way the cover
     sidecar matches them (same normalization as artist-images/main.go).
Read-only: it never changes anything. Needs mutagen (pip install mutagen).
"""
import os
import re
import sys
import unicodedata

try:
    from mutagen.id3 import ID3
except ImportError:
    sys.exit("Missing dep: mutagen  →  pip install mutagen")

# Same article list as the sidecar's normalize(), plus 'o'.
ARTICLES = {"the", "los", "las", "le", "les", "el", "la", "die", "das", "der", "gli", "il", "o"}
YEAR_DIR = re.compile(r"^(\d{4})-(.+)$")


def normalize(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    s = s.replace("&", "and")
    words = [w for w in re.split(r"[^a-z0-9]+", s) if w]
    if len(words) > 1 and words[0] in ARTICLES:
        words = words[1:]
    return "".join(words)


def folder_name(s):
    """A tag value as a folder name: lowercase, & → and, punctuation dropped, spaces → _."""
    s = s.lower().replace("&", " and ")
    s = re.sub(r"[^\w\s-]", "", s)  # drop : , . ' ! ? etc.; keeps letters (incl. accented), digits, _ and -
    return re.sub(r"\s+", "_", s.strip())


def first_mp3_tags(album_dir):
    mp3s = sorted(f for f in os.listdir(album_dir) if f.lower().endswith(".mp3"))
    if not mp3s:
        return None
    try:
        t = ID3(os.path.join(album_dir, mp3s[0]))
    except Exception:
        return {"file": mp3s[0], "album": "", "artist": "", "year": ""}
    text = lambda k: str(t[k].text[0]) if k in t and t[k].text else ""
    return {
        "file": mp3s[0],
        "album": text("TALB"),
        "artist": text("TPE2") or text("TPE1"),
        "year": text("TDRC")[:4],
    }


def pause(n, kind, path, diagnosis, fix):
    print(f"\n[{n}] {kind}\n    {path}\n    problem: {diagnosis}\n    fix:     {fix}")
    try:
        if input("    Enter = next, q = quit: ").strip().lower() == "q":
            sys.exit(0)
    except (EOFError, KeyboardInterrupt):
        print()
        sys.exit(0)


def subdirs(path):
    return sorted(d for d in os.listdir(path) if os.path.isdir(os.path.join(path, d)) and not d.startswith("."))


def main():
    root = os.getcwd()
    n = 0
    for letter in subdirs(root):
        for artist in subdirs(os.path.join(root, letter)):
            artist_dir = os.path.join(letter, artist)

            if not os.path.isfile(os.path.join(root, artist_dir, "cover.jpg")):
                n += 1
                pause(n, "ARTIST WITHOUT cover.jpg", artist_dir,
                      "no artist avatar on disk",
                      f"open the artist in the app and pick/upload an image, "
                      f"or copy one to '{artist_dir}/cover.jpg'")

            for album in subdirs(os.path.join(root, artist_dir)):
                album_dir = os.path.join(artist_dir, album)
                full = os.path.join(root, album_dir)

                if not os.path.isfile(os.path.join(full, "cover.jpg")):
                    n += 1
                    pause(n, "ALBUM WITHOUT cover.jpg", album_dir,
                          "no album cover on disk",
                          f"open the album in the app and upload a cover, "
                          f"or copy one to '{album_dir}/cover.jpg'")

                tags = first_mp3_tags(full)
                if tags is None:
                    continue  # no mp3s: not an album folder
                m = YEAR_DIR.match(album)
                problems = []
                if not m:
                    problems.append("folder name is not <year>-<album>")
                elif normalize(m.group(2)) != normalize(tags["album"]):
                    problems.append(f"album tag '{tags['album']}' ≠ folder '{m.group(2)}'")
                if normalize(artist) != normalize(tags["artist"]):
                    problems.append(f"album artist tag '{tags['artist']}' ≠ artist folder '{artist}'")
                if not problems:
                    continue

                year = tags["year"] or (m.group(1) if m else "YYYY")
                want = f"{year}-{folder_name(tags['album'])}"
                fix = (f"either fix the tags in the app (Edit on the album page), "
                       f"or rename the folder to match the tags:\n"
                       f"             mv '{full}' '{os.path.join(root, artist_dir, want)}'")
                if any("artist" in p for p in problems):
                    fix += "\n             (artist mismatch: fix the album artist tag, or the artist folder name)"
                n += 1
                pause(n, "ALBUM NAME WON'T MATCH TAGS", album_dir,
                      "; ".join(problems) + f"  [read from {tags['file']}]", fix)

    print(f"\ndone: {n} issue(s).")


if __name__ == "__main__":
    main()
