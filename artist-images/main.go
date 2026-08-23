package main

import (
	"bytes"
	"image"
	"image/jpeg"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/bogem/id3v2/v2"
	_ "golang.org/x/image/webp"
)

var coverMap      = map[string]string{}
var albumCoverMap = map[string]string{}
var albumDirMap   = map[string]string{}
var artistDirMap  = map[string]string{}
var nonAlnum   = regexp.MustCompile(`[^a-z0-9]+`)
var yearPrefix = regexp.MustCompile(`^\d{4}-`)
var logRequests bool

var articles = map[string]bool{
	"the": true, "los": true, "las": true,
	"le": true, "les": true, "el": true, "la": true,
	"die": true, "das": true, "der": true, "gli": true, "il": true,
}

var accentMap = strings.NewReplacer(
	"à", "a", "á", "a", "â", "a", "ã", "a", "ä", "a", "å", "a",
	"è", "e", "é", "e", "ê", "e", "ë", "e",
	"ì", "i", "í", "i", "î", "i", "ï", "i",
	"ò", "o", "ó", "o", "ô", "o", "õ", "o", "ö", "o", "ø", "o",
	"ù", "u", "ú", "u", "û", "u", "ü", "u",
	"ý", "y", "ÿ", "y",
	"ñ", "n", "ç", "c", "ß", "ss",
	"À", "a", "Á", "a", "Â", "a", "Ã", "a", "Ä", "a", "Å", "a",
	"È", "e", "É", "e", "Ê", "e", "Ë", "e",
	"Ì", "i", "Í", "i", "Î", "i", "Ï", "i",
	"Ò", "o", "Ó", "o", "Ô", "o", "Õ", "o", "Ö", "o", "Ø", "o",
	"Ù", "u", "Ú", "u", "Û", "u", "Ü", "u",
	"Ý", "y", "Ñ", "n", "Ç", "c",
)

func normalize(s string) string {
	s = accentMap.Replace(s)
	s = strings.ToLower(s)
	s = strings.ReplaceAll(s, "&", "and")
	// split on non-alnum so we can detect article boundaries
	parts := nonAlnum.Split(s, -1)
	filtered := parts[:0]
	for _, p := range parts {
		if p != "" {
			filtered = append(filtered, p)
		}
	}
	// strip leading article only when more words follow
	if len(filtered) > 1 && articles[filtered[0]] {
		filtered = filtered[1:]
	}
	return strings.Join(filtered, "")
}


func buildMap(root string) {
	freshArtist     := map[string]string{}
	freshAlbum      := map[string]string{}
	freshAlbumDirs  := map[string]string{}
	freshArtistDirs := map[string]string{}
	letters, err := os.ReadDir(root)
	if err != nil {
		log.Printf("cannot read root %q: %v", root, err)
		coverMap = freshArtist
		albumCoverMap = freshAlbum
		return
	}
	for _, letter := range letters {
		if !letter.IsDir() {
			continue
		}
		artists, err := os.ReadDir(filepath.Join(root, letter.Name()))
		if err != nil {
			log.Printf("cannot read %q: %v", letter.Name(), err)
			continue
		}
		for _, artist := range artists {
			if !artist.IsDir() {
				continue
			}
			artistDir := filepath.Join(root, letter.Name(), artist.Name())
			freshArtistDirs[normalize(artist.Name())] = artistDir
			artistCover := filepath.Join(artistDir, "cover.jpg")
			if _, err := os.Stat(artistCover); err == nil {
				freshArtist[normalize(artist.Name())] = artistCover
			}
			albums, err := os.ReadDir(artistDir)
			if err != nil {
				continue
			}
			for _, album := range albums {
				if !album.IsDir() {
					continue
				}
				albumName := yearPrefix.ReplaceAllString(album.Name(), "")
				key := normalize(artist.Name()) + "|" + normalize(albumName)
				albumDir := filepath.Join(artistDir, album.Name())
				freshAlbumDirs[key] = albumDir
				albumCover := filepath.Join(albumDir, "cover.jpg")
				if _, err := os.Stat(albumCover); err == nil {
					freshAlbum[key] = albumCover
				}
			}
		}
	}
	coverMap     = freshArtist
	albumCoverMap = freshAlbum
	albumDirMap  = freshAlbumDirs
	artistDirMap = freshArtistDirs
	log.Printf("indexed %d artist covers, %d album covers (%d dirs), %d artist dirs from %s", len(coverMap), len(albumCoverMap), len(albumDirMap), len(artistDirMap), root)
}

// toJPEG re-encodes an image gonic cannot read. Gonic decodes only what Go's
// stdlib registers (JPEG/PNG/GIF), so a WebP written as cover.jpg fails on every
// request with "image: unknown format" — and Last.fm's CDN serves WebP by
// default. Formats gonic already handles are passed through untouched.
func toJPEG(img []byte) ([]byte, error) {
	switch http.DetectContentType(img) {
	case "image/jpeg", "image/png", "image/gif":
		return img, nil
	}
	m, _, err := image.Decode(bytes.NewReader(img))
	if err != nil {
		return nil, err
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, m, &jpeg.Options{Quality: 90}); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// embedCover writes img as the front-cover APIC frame of every .mp3 in dir,
// replacing any picture already attached. It rewrites whole files, so callers
// run it in its own goroutine and never block an HTTP response on it.
// ponytail: fire-and-forget — no retry, no progress reporting, and a restart
// mid-run leaves the remaining tracks un-embedded. Add a status endpoint keyed
// by album dir if that ever needs to be observable.
func embedCover(dir string, img []byte) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		log.Printf("embed: cannot read %s: %v", dir, err)
		return
	}
	mime := http.DetectContentType(img)
	start := time.Now()
	done, failed := 0, 0
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(strings.ToLower(e.Name()), ".mp3") {
			continue
		}
		file := filepath.Join(dir, e.Name())
		tag, err := id3v2.Open(file, id3v2.Options{Parse: true})
		if err != nil {
			log.Printf("embed: open %s: %v", file, err)
			failed++
			continue
		}
		tag.DeleteFrames(tag.CommonID("Attached picture"))
		tag.AddAttachedPicture(id3v2.PictureFrame{
			Encoding:    id3v2.EncodingUTF8,
			MimeType:    mime,
			PictureType: id3v2.PTFrontCover,
			Description: "Front cover",
			Picture:     img,
		})
		if err := tag.Save(); err != nil {
			log.Printf("embed: save %s: %v", file, err)
			failed++
		} else {
			done++
		}
		tag.Close()
	}
	log.Printf("embedded cover into %d mp3s (%d failed) in %s (%.1fs)", done, failed, dir, time.Since(start).Seconds())
}

// writeFrames opens an mp3 and overwrites the given ID3v2 text frames.
// Keys are raw frame IDs (TALB, TPE1, TPE2, TIT2, TCON, TRCK, TDRC, TYER).
// Empty values are skipped; existing frames of the same ID are replaced.
func writeFrames(path string, frames map[string]string) error {
	tag, err := id3v2.Open(path, id3v2.Options{Parse: true})
	if err != nil {
		return err
	}
	defer tag.Close()
	for id, val := range frames {
		if val == "" {
			continue
		}
		tag.DeleteFrames(id)
		tag.AddTextFrame(id, id3v2.EncodingUTF8, val)
	}
	return tag.Save()
}

func main() {
	root := os.Getenv("MUSIC_ROOT")
	if root == "" {
		root = "/media/music"
	}
	logRequests = strings.ToLower(os.Getenv("LOG_REQUESTS")) == "true"
	buildMap(root)
	if len(coverMap) == 0 {
		log.Fatalf("no artist covers found in %s — NFS not ready?", root)
	}

	go func() {
		for range time.Tick(5 * time.Minute) {
			log.Printf("rescanning %s", root)
			buildMap(root)
		}
	}()

	http.HandleFunc("/album", func(w http.ResponseWriter, r *http.Request) {
		start  := time.Now()
		artist := r.URL.Query().Get("artist")
		album  := r.URL.Query().Get("album")
		if artist == "" || album == "" {
			http.Error(w, "missing artist or album param", http.StatusBadRequest)
			return
		}
		key  := normalize(artist) + "|" + normalize(album)
		path, ok := albumCoverMap[key]
		if !ok {
			if logRequests {
				log.Printf("MISS  album %q / %q (%.0fms)", artist, album, float64(time.Since(start).Microseconds())/1000)
			}
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Cache-Control", "public, max-age=86400")
		http.ServeFile(w, r, path)
		if logRequests {
			log.Printf("HIT   album %q / %q (%.0fms)", artist, album, float64(time.Since(start).Microseconds())/1000)
		}
	})

	http.HandleFunc("/avatar", func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		name := r.URL.Query().Get("name")
		if name == "" {
			http.Error(w, "missing name param", http.StatusBadRequest)
			return
		}
		path, ok := coverMap[normalize(name)]
		if !ok {
			if logRequests {
				log.Printf("MISS  %q (%.0fms)", name, float64(time.Since(start).Microseconds())/1000)
			}
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Cache-Control", "public, max-age=86400")
		http.ServeFile(w, r, path)
		if logRequests {
			log.Printf("HIT   %q (%.0fms)", name, float64(time.Since(start).Microseconds())/1000)
		}
	})

	http.HandleFunc("/upload", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		artist := r.URL.Query().Get("artist")
		album  := r.URL.Query().Get("album")
		if artist == "" || album == "" {
			http.Error(w, "missing artist or album param", http.StatusBadRequest)
			return
		}
		key := normalize(artist) + "|" + normalize(album)
		dir, ok := albumDirMap[key]
		if !ok {
			http.Error(w, "album directory not found", http.StatusNotFound)
			return
		}
		if err := r.ParseMultipartForm(10 << 20); err != nil {
			http.Error(w, "invalid multipart form", http.StatusBadRequest)
			return
		}
		file, _, err := r.FormFile("cover")
		if err != nil {
			http.Error(w, "missing cover file", http.StatusBadRequest)
			return
		}
		defer file.Close()
		img, err := io.ReadAll(file)
		if err != nil {
			log.Printf("upload: failed to read upload: %v", err)
			http.Error(w, "failed to read file", http.StatusBadRequest)
			return
		}
		img, err = toJPEG(img)
		if err != nil {
			log.Printf("upload: cannot decode image for %q / %q: %v", artist, album, err)
			http.Error(w, "unsupported image format", http.StatusBadRequest)
			return
		}
		dst := filepath.Join(dir, "cover.jpg")
		if err := os.WriteFile(dst, img, 0644); err != nil {
			log.Printf("upload: failed to write %s: %v", dst, err)
			http.Error(w, "failed to write file", http.StatusInternalServerError)
			return
		}
		albumCoverMap[key] = dst
		log.Printf("uploaded cover for %q / %q → %s", artist, album, dst)
		// Embedding rewrites every track in the album, so it runs detached and
		// the client gets 202 as soon as cover.jpg is on disk.
		go embedCover(dir, img)
		w.WriteHeader(http.StatusAccepted)
	})

	// /upload-avatar writes a cover.jpg into the artist directory, serving as the
	// artist avatar (mirrors /upload for albums).
	http.HandleFunc("/upload-avatar", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		name := r.URL.Query().Get("name")
		if name == "" {
			http.Error(w, "missing name param", http.StatusBadRequest)
			return
		}
		dir, ok := artistDirMap[normalize(name)]
		if !ok {
			http.Error(w, "artist directory not found", http.StatusNotFound)
			return
		}
		if err := r.ParseMultipartForm(10 << 20); err != nil {
			http.Error(w, "invalid multipart form", http.StatusBadRequest)
			return
		}
		file, _, err := r.FormFile("cover")
		if err != nil {
			http.Error(w, "missing cover file", http.StatusBadRequest)
			return
		}
		defer file.Close()
		img, err := io.ReadAll(file)
		if err != nil {
			log.Printf("upload-avatar: failed to read upload: %v", err)
			http.Error(w, "failed to read file", http.StatusBadRequest)
			return
		}
		img, err = toJPEG(img)
		if err != nil {
			log.Printf("upload-avatar: cannot decode image for %q: %v", name, err)
			http.Error(w, "unsupported image format", http.StatusBadRequest)
			return
		}
		dst := filepath.Join(dir, "cover.jpg")
		if err := os.WriteFile(dst, img, 0644); err != nil {
			log.Printf("upload-avatar: failed to write %s: %v", dst, err)
			http.Error(w, "failed to write file", http.StatusInternalServerError)
			return
		}
		coverMap[normalize(name)] = dst
		log.Printf("uploaded avatar for %q → %s", name, dst)
		w.WriteHeader(http.StatusOK)
	})

	// /album-tags writes album-level ID3 frames (album title, artist, album artist,
	// year, genre) to every .mp3 in the album directory. Per-track title/track-number
	// (TIT2/TRCK) are untouched; artist here means the bulk TPE1 for all tracks.
	http.HandleFunc("/album-tags", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		artist := r.URL.Query().Get("artist")
		album  := r.URL.Query().Get("album")
		if artist == "" || album == "" {
			http.Error(w, "missing artist or album param", http.StatusBadRequest)
			return
		}
		key := normalize(artist) + "|" + normalize(album)
		dir, ok := albumDirMap[key]
		if !ok {
			log.Printf("album-tags: no dir for key %q (artist=%q album=%q)", key, artist, album)
			http.Error(w, "album directory not found", http.StatusNotFound)
			return
		}
		if err := r.ParseMultipartForm(1 << 20); err != nil {
			http.Error(w, "invalid multipart form", http.StatusBadRequest)
			return
		}
		frames := map[string]string{}
		if v := r.FormValue("title"); v != "" {
			frames["TALB"] = v
		}
		if v := r.FormValue("artist"); v != "" {
			frames["TPE1"] = v
		}
		if v := r.FormValue("albumArtist"); v != "" {
			frames["TPE2"] = v
		}
		if v := r.FormValue("genre"); v != "" {
			frames["TCON"] = v
		}
		if v := r.FormValue("year"); v != "" {
			frames["TDRC"] = v
			frames["TYER"] = v
		}
		if len(frames) == 0 {
			http.Error(w, "no tags to write", http.StatusBadRequest)
			return
		}
		entries, err := os.ReadDir(dir)
		if err != nil {
			http.Error(w, "cannot read album directory", http.StatusInternalServerError)
			return
		}
		count := 0
		for _, e := range entries {
			if e.IsDir() || !strings.HasSuffix(strings.ToLower(e.Name()), ".mp3") {
				continue
			}
			file := filepath.Join(dir, e.Name())
			if err := writeFrames(file, frames); err != nil {
				log.Printf("album-tags: failed to write %s: %v", file, err)
				continue
			}
			count++
		}
		if count == 0 {
			http.Error(w, "no tracks written", http.StatusInternalServerError)
			return
		}
		log.Printf("wrote album tags for %q / %q → %d tracks", artist, album, count)
		w.WriteHeader(http.StatusOK)
	})

	// /track-tags writes track-level ID3 frames (title, artist, track number) to a
	// single .mp3 within the album directory, identified by its filename.
	http.HandleFunc("/track-tags", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		artist := r.URL.Query().Get("artist")
		album  := r.URL.Query().Get("album")
		if artist == "" || album == "" {
			http.Error(w, "missing artist or album param", http.StatusBadRequest)
			return
		}
		key := normalize(artist) + "|" + normalize(album)
		dir, ok := albumDirMap[key]
		if !ok {
			log.Printf("track-tags: no dir for key %q (artist=%q album=%q)", key, artist, album)
			http.Error(w, "album directory not found", http.StatusNotFound)
			return
		}
		if err := r.ParseMultipartForm(1 << 20); err != nil {
			http.Error(w, "invalid multipart form", http.StatusBadRequest)
			return
		}
		name := r.FormValue("file")
		if name == "" {
			http.Error(w, "missing file param", http.StatusBadRequest)
			return
		}
		// filepath.Base guards against path traversal — the target is always inside dir.
		target := filepath.Join(dir, filepath.Base(name))
		if fi, err := os.Stat(target); err != nil || fi.IsDir() {
			http.Error(w, "track file not found", http.StatusNotFound)
			return
		}
		frames := map[string]string{}
		if v := r.FormValue("title"); v != "" {
			frames["TIT2"] = v
		}
		if v := r.FormValue("artist"); v != "" {
			frames["TPE1"] = v
		}
		if v := r.FormValue("track"); v != "" {
			frames["TRCK"] = v
		}
		if len(frames) == 0 {
			http.Error(w, "no tags to write", http.StatusBadRequest)
			return
		}
		if err := writeFrames(target, frames); err != nil {
			log.Printf("track-tags: failed to write %s: %v", target, err)
			http.Error(w, "failed to write tags", http.StatusInternalServerError)
			return
		}
		log.Printf("wrote track tags for %q / %q → %s", artist, album, filepath.Base(target))
		w.WriteHeader(http.StatusOK)
	})

	log.Printf("listening on :8080 (LOG_REQUESTS=%v)", logRequests)
	log.Fatal(http.ListenAndServe(":8080", nil))
}
