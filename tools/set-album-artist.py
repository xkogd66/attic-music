#!/usr/bin/env python3
"""
Set the Album Artist tag on every MP3 in an artist folder and rename the
folder to match the sidecar's naming convention (lowercase, spaces/special
chars → underscores).

Artist level (default):
    set-album-artist.py /mp3/b/bob_seger

Letter level — iterates every artist sub-folder under the given directory:
    set-album-artist.py --letter /mp3/b

Current directory is used when no path is given:
    cd /mp3/b && set-album-artist.py --letter
    cd /mp3/b/bob_seger && set-album-artist.py
"""

import argparse
import os
import re
import sys

try:
    from mutagen.id3 import ID3, TPE2, ID3NoHeaderError
except ImportError:
    sys.exit("mutagen not found — install with: pip install mutagen")


def to_folder_name(artist: str) -> str:
    name = artist.lower()
    name = re.sub(r'[^a-z0-9]+', '_', name)
    return name.strip('_')


def sample_album_artist(folder: str) -> str:
    for root, _, files in os.walk(folder):
        for f in files:
            if f.lower().endswith('.mp3'):
                try:
                    tags = ID3(os.path.join(root, f))
                    val = tags.get('TPE2')
                    if val:
                        return str(val)
                except ID3NoHeaderError:
                    pass
    return ''


def process_artist(folder: str) -> None:
    print(f"\n{'─' * 60}")
    print(f"Artist folder : {os.path.basename(folder)}")
    current = sample_album_artist(folder)
    if current:
        print(f"Current album artist: {current}")

    album_artist = input("New album artist (blank = keep current, 's' = skip): ").strip()
    if album_artist.lower() == 's':
        print("Skipped.")
        return
    if not album_artist:
        if not current:
            print("No album artist provided and none found in tags — skipping.")
            return
        album_artist = current

    # Update TPE2 on every MP3
    updated = 0
    errors  = 0
    for root, _, files in os.walk(folder):
        for f in sorted(files):
            if not f.lower().endswith('.mp3'):
                continue
            path = os.path.join(root, f)
            try:
                try:
                    tags = ID3(path)
                except ID3NoHeaderError:
                    tags = ID3()
                tags['TPE2'] = TPE2(encoding=3, text=album_artist)
                tags.save(path)
                updated += 1
            except Exception as e:
                print(f"  ERROR {path}: {e}")
                errors += 1

    print(f"Updated {updated} file(s){f', {errors} error(s)' if errors else ''}.")

    # Offer folder rename
    new_name = to_folder_name(album_artist)
    parent   = os.path.dirname(folder)
    new_path = os.path.join(parent, new_name)

    if new_path == folder:
        print("Folder name already matches — done.")
        return

    print(f"Rename: {os.path.basename(folder)}  →  {new_name}")
    confirm = input("Confirm rename? [y/N] ").strip().lower()
    if confirm == 'y':
        os.rename(folder, new_path)
        print(f"Renamed.")
    else:
        print("Skipped rename.")


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('path', nargs='?', default='.',
                        help='Artist folder (default) or letter folder with --letter')
    parser.add_argument('--letter', action='store_true',
                        help='Treat path as a letter directory and iterate all artist sub-folders')
    args = parser.parse_args()

    root = os.path.abspath(args.path)

    if args.letter:
        artists = sorted(
            d for d in os.listdir(root)
            if os.path.isdir(os.path.join(root, d))
        )
        if not artists:
            sys.exit(f"No sub-folders found in {root}")
        print(f"Letter folder : {root}")
        print(f"Found {len(artists)} artist folder(s).")
        for name in artists:
            process_artist(os.path.join(root, name))
        print("\nAll done.")
    else:
        process_artist(root)


if __name__ == '__main__':
    main()
