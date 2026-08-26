package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"image"
	"image/jpeg"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
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
// It returns (done, failed) counts so synchronous callers (e.g. the musiclib
// re-embed endpoint) can report progress.
// ponytail: fire-and-forget — no retry, no progress reporting, and a restart
// mid-run leaves the remaining tracks un-embedded. Add a status endpoint keyed
// by album dir if that ever needs to be observable.
func embedCover(dir string, img []byte) (int, int) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		log.Printf("embed: cannot read %s: %v", dir, err)
		return 0, 0
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
	return done, failed
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

// ════════════════════════════════════════════════════════════════════════════
// musiclib fold — the CLI's audit / cleanup / artwork / convert / enrich
// capabilities (scripts/musiclib.py sections D, B, A, E, C) exposed as HTTP
// endpoints. Same preview-then-apply contract as the CLI's dry_run_confirm():
// call an endpoint without `apply=1` to get the plan, then again with it to
// commit.
// ════════════════════════════════════════════════════════════════════════════

var goldenTags = map[string]bool{
	"TIT2": true, "TALB": true, "TPE1": true, "TPE2": true, "TRCK": true,
	"TDRC": true, "TPOS": true, "TCOM": true, "TPE3": true, "APIC": true, "TCMP": true,
}
var sortTagIDs  = []string{"TSOP", "TSO2", "TSOA", "TSOT", "TSOS", "TSOC", "TSOO", "XSOP"}
var groupTagIDs = []string{"TALB", "TPE2", "TDRC", "TPOS", "TCMP"}
var coverNames  = []string{"cover.jpg", "cover.jpeg", "cover.png", "folder.jpg", "folder.jpeg", "front.jpg"}

var criticalTags = map[string]string{"TALB": "Album", "TPE2": "Album Artist", "TDRC": "Date"}

type change struct {
	File   string `json:"file"`
	Detail string `json:"detail"`
}

func albumDirOf(artist, album string) (string, bool) {
	key := normalize(artist) + "|" + normalize(album)
	dir, ok := albumDirMap[key]
	return dir, ok
}

func mp3Names(dir string) []string {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	var out []string
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(strings.ToLower(e.Name()), ".mp3") {
			out = append(out, e.Name())
		}
	}
	sort.Strings(out)
	return out
}

// textValue returns the first text-frame value for id ("" if the frame is
// absent or not a text frame). Type-asserts against id3v2.TextFrame directly
// so we never depend on GetTextFrame's handling of non-text frames (APIC, …).
func textValue(tag *id3v2.Tag, id string) string {
	for _, f := range tag.AllFrames()[id] {
		if tf, ok := f.(id3v2.TextFrame); ok {
			return tf.Text
		}
	}
	return ""
}

// readTags returns (text-value per frame id, sorted base frame ids) for an mp3.
func readTags(path string) (map[string]string, []string) {
	tag, err := id3v2.Open(path, id3v2.Options{Parse: true})
	if err != nil {
		return nil, nil
	}
	defer tag.Close()
	frames := map[string]string{}
	seen   := map[string]bool{}
	var ids []string
	for id, list := range tag.AllFrames() {
		if !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
		for _, f := range list {
			if tf, ok := f.(id3v2.TextFrame); ok && tf.Text != "" {
				frames[id] = tf.Text
			}
		}
	}
	sort.Strings(ids)
	return frames, ids
}

type albumAudit struct {
	Folder     string                         `json:"folder"`
	TrackCount int                            `json:"trackCount"`
	Conflicts  map[string]map[string][]string `json:"conflicts"`
	JunkTags   []string                       `json:"junkTags"`
	Missing    []string                       `json:"missing"`
}

// auditDir is a read-only golden-tag compliance report for one album folder:
// cross-track conflicts on the critical frames (TALB/TPE2/TDRC), frame ids
// outside the golden set, and critical tags absent from every track.
func auditDir(dir string) albumAudit {
	mp3s := mp3Names(dir)
	res := albumAudit{
		Folder:     filepath.Base(filepath.Dir(dir)) + "/" + filepath.Base(dir),
		TrackCount: len(mp3s),
		Conflicts:  map[string]map[string][]string{},
	}
	junk  := map[string]bool{}
	seen  := map[string]bool{}
	group := map[string]map[string][]string{}
	for _, name := range mp3s {
		frames, ids := readTags(filepath.Join(dir, name))
		for _, id := range ids {
			if !goldenTags[id] && id != "APIC" {
				junk[id] = true
			}
		}
		for id, label := range criticalTags {
			v := strings.ToLower(strings.TrimSpace(frames[id]))
			if v == "" {
				continue
			}
			seen[id] = true
			if group[label] == nil {
				group[label] = map[string][]string{}
			}
			group[label][v] = append(group[label][v], name)
		}
	}
	for id := range junk {
		res.JunkTags = append(res.JunkTags, id)
	}
	sort.Strings(res.JunkTags)
	for id, label := range criticalTags {
		if !seen[id] {
			res.Missing = append(res.Missing, label)
		}
	}
	sort.Strings(res.Missing)
	for label, vmap := range group {
		if len(vmap) > 1 {
			res.Conflicts[label] = vmap
		}
	}
	return res
}

func auditIsProblem(a albumAudit) bool {
	return len(a.Conflicts) > 0 || len(a.JunkTags) > 0 || len(a.Missing) > 0
}

// writeJSON is a tiny helper for the JSON endpoints below.
func writeJSON(w http.ResponseWriter, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("writeJSON: %v", err)
	}
}

// ════════════════════════════════════════════════════════════════════════════
// async jobs — every maintenance operation runs as a background job. The POST
// that starts one returns 202 + {"id": …} immediately and the frontend polls
// GET /job?id= for progress/result. Jobs touching the same album directory are
// serialized by a per-directory lock so concurrent tag writes can't clash;
// different albums run in parallel.
// ════════════════════════════════════════════════════════════════════════════

type job struct {
	ID       string      `json:"id"`
	Op       string      `json:"op"`
	Applied  bool        `json:"applied"`
	Status   string      `json:"status"` // running | done | error
	Message  string      `json:"message"`
	Progress int         `json:"progress"`
	Total    int         `json:"total"`
	Error    string      `json:"error,omitempty"`
	Changes  []change    `json:"changes,omitempty"`
	Data     interface{} `json:"data,omitempty"`
	Started  time.Time   `json:"startedAt"`
	Finished time.Time   `json:"finishedAt,omitempty"`
}

var (
	jobsMu     sync.Mutex
	jobs       = map[string]*job{}
	jobIDs     []string
	jobSeq     int64
	dirLocksMu sync.Mutex
	dirLocks   = map[string]*sync.Mutex{}
)

func (j *job) setMessage(m string) {
	jobsMu.Lock()
	j.Message = m
	jobsMu.Unlock()
}

func (j *job) setProgress(p, t int) {
	jobsMu.Lock()
	j.Progress, j.Total = p, t
	jobsMu.Unlock()
}

func (j *job) done(changes []change, data interface{}) {
	jobsMu.Lock()
	j.Status = "done"
	j.Changes = changes
	j.Data = data
	j.Finished = time.Now()
	jobsMu.Unlock()
}

func (j *job) fail(err error) {
	jobsMu.Lock()
	j.Status = "error"
	j.Error = err.Error()
	j.Finished = time.Now()
	jobsMu.Unlock()
}

func lockDir(dir string) func() {
	dirLocksMu.Lock()
	l := dirLocks[dir]
	if l == nil {
		l = &sync.Mutex{}
		dirLocks[dir] = l
	}
	dirLocksMu.Unlock()
	l.Lock()
	return l.Unlock
}

// startJob launches fn in a goroutine (under the per-directory lock when dir
// is non-empty) and returns the job id. The last 50 jobs are kept in memory.
func startJob(op string, applied bool, dir string, fn func(j *job)) string {
	jobsMu.Lock()
	jobSeq++
	id := fmt.Sprintf("j%d", jobSeq)
	j := &job{ID: id, Op: op, Applied: applied, Status: "running", Started: time.Now()}
	jobs[id] = j
	jobIDs = append(jobIDs, id)
	if len(jobIDs) > 50 {
		old := jobIDs[0]
		jobIDs = jobIDs[1:]
		delete(jobs, old)
	}
	jobsMu.Unlock()
	go func() {
		defer func() {
			if r := recover(); r != nil {
				j.fail(fmt.Errorf("panic: %v", r))
			}
		}()
		if dir != "" {
			unlock := lockDir(dir)
			defer unlock()
		}
		fn(j)
	}()
	return id
}

func writeJobAccepted(w http.ResponseWriter, id string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	if err := json.NewEncoder(w).Encode(map[string]string{"id": id}); err != nil {
		log.Printf("writeJobAccepted: %v", err)
	}
}

// ── tag cleanup ──────────────────────────────────────────────────────────────

func cleanupSortTags(dir string, apply bool, j *job) ([]change, error) {
	var changes []change
	names := mp3Names(dir)
	for i, name := range names {
		j.setProgress(i+1, len(names))
		j.setMessage("removing sort tags in " + name)
		path := filepath.Join(dir, name)
		tag, err := id3v2.Open(path, id3v2.Options{Parse: true})
		if err != nil {
			return changes, err
		}
		var removed []string
		for _, id := range sortTagIDs {
			if _, ok := tag.AllFrames()[id]; ok {
				removed = append(removed, id)
				tag.DeleteFrames(id)
			}
		}
		if len(removed) > 0 {
			changes = append(changes, change{File: name, Detail: "removed " + strings.Join(removed, ", ")})
			if apply {
				if err := tag.Save(); err != nil {
					tag.Close()
					return changes, err
				}
			}
		}
		tag.Close()
	}
	return changes, nil
}

func cleanupGoldenSet(dir string, apply bool, j *job) ([]change, error) {
	mp3s := mp3Names(dir)
	if len(mp3s) == 0 {
		return nil, nil
	}
	firstFrames, _ := readTags(filepath.Join(dir, mp3s[0]))
	var changes []change
	for i, name := range mp3s {
		j.setProgress(i+1, len(mp3s))
		j.setMessage("sanitizing " + name)
		path := filepath.Join(dir, name)
		tag, err := id3v2.Open(path, id3v2.Options{Parse: true})
		if err != nil {
			return changes, err
		}
		var details []string
		// Pass 1: wipe every frame outside the golden set (pictures are kept).
		var wipe []string
		for id := range tag.AllFrames() {
			if !goldenTags[id] && id != "APIC" {
				wipe = append(wipe, id)
				tag.DeleteFrames(id)
			}
		}
		if len(wipe) > 0 {
			sort.Strings(wipe)
			details = append(details, "wiped "+strings.Join(wipe, ", "))
		}
		// Pass 2: align grouping tags to the first file's values.
		for _, id := range groupTagIDs {
			want := strings.TrimSpace(firstFrames[id])
			if want == "" {
				continue
			}
			if got := strings.TrimSpace(textValue(tag, id)); got != want {
				tag.DeleteFrames(id)
				tag.AddTextFrame(id, id3v2.EncodingUTF8, want)
				details = append(details, id+" → "+want)
			}
		}
		if len(details) > 0 {
			changes = append(changes, change{File: name, Detail: strings.Join(details, "; ")})
			if apply {
				if err := tag.Save(); err != nil {
					tag.Close()
					return changes, err
				}
			}
		}
		tag.Close()
	}
	return changes, nil
}

func cleanupLowercase(dir string, apply bool, j *job) ([]change, error) {
	var changes []change
	names := mp3Names(dir)
	for i, name := range names {
		j.setProgress(i+1, len(names))
		j.setMessage("lowercasing " + name)
		path := filepath.Join(dir, name)
		tag, err := id3v2.Open(path, id3v2.Options{Parse: true})
		if err != nil {
			return changes, err
		}
		var lowered []string
		for id := range tag.AllFrames() {
			cur := textValue(tag, id)
			if cur == "" {
				continue
			}
			low := strings.ToLower(cur)
			if low != cur {
				tag.DeleteFrames(id)
				tag.AddTextFrame(id, id3v2.EncodingUTF8, low)
				lowered = append(lowered, id)
			}
		}
		if len(lowered) > 0 {
			sort.Strings(lowered)
			changes = append(changes, change{File: name, Detail: "lowercased " + strings.Join(lowered, ", ")})
			if apply {
				if err := tag.Save(); err != nil {
					tag.Close()
					return changes, err
				}
			}
		}
		tag.Close()
	}
	return changes, nil
}

var trackSepRe = regexp.MustCompile(`^(\d+)\s*[-_.]\s*(.+)$`)

// cleanupTagFromFilename parses "Artist - Title" / "NN - Title" out of the
// filename and writes TIT2/TPE1 (mirrors musiclib's tag_from_filename).
func cleanupTagFromFilename(dir string, apply bool, j *job) ([]change, error) {
	var changes []change
	names := mp3Names(dir)
	for i, name := range names {
		j.setProgress(i+1, len(names))
		j.setMessage("parsing " + name)
		base := name
		if len(base) > 4 && strings.EqualFold(base[len(base)-4:], ".mp3") {
			base = base[:len(base)-4]
		}
		var title, artist string
		if m := trackSepRe.FindStringSubmatch(base); m != nil {
			title = strings.ReplaceAll(strings.TrimSpace(m[2]), "_", " ")
		} else if i := strings.Index(base, "-"); i >= 0 {
			artist = strings.ReplaceAll(strings.TrimSpace(base[:i]), "_", " ")
			title  = strings.ReplaceAll(strings.TrimSpace(base[i+1:]), "_", " ")
		} else {
			continue
		}
		if title == "" {
			continue
		}
		path := filepath.Join(dir, name)
		tag, err := id3v2.Open(path, id3v2.Options{Parse: true})
		if err != nil {
			return changes, err
		}
		tag.AddTextFrame("TIT2", id3v2.EncodingUTF8, title)
		detail := "TIT2 = " + title
		if artist != "" {
			tag.AddTextFrame("TPE1", id3v2.EncodingUTF8, artist)
			detail = "TPE1 = " + artist + ", " + detail
		}
		changes = append(changes, change{File: name, Detail: detail})
		if apply {
			if err := tag.Save(); err != nil {
				tag.Close()
				return changes, err
			}
		}
		tag.Close()
	}
	return changes, nil
}

// ── artwork ──────────────────────────────────────────────────────────────────

func findCover(dir string) string {
	for _, n := range coverNames {
		p := filepath.Join(dir, n)
		if fi, err := os.Stat(p); err == nil && !fi.IsDir() {
			return p
		}
	}
	return ""
}

// normalizeCover re-encodes the album's cover file through toJPEG, guaranteeing
// a gonic-readable JPEG at cover.jpg (a WebP served under a .jpg name fails on
// every gonic request — mirrors musiclib's _ensure_real_jpeg).
func normalizeCover(dir string, j *job) ([]change, error) {
	src := findCover(dir)
	if src == "" {
		return nil, fmt.Errorf("no cover file in album folder")
	}
	img, err := os.ReadFile(src)
	if err != nil {
		return nil, err
	}
	j.setMessage("re-encoding " + filepath.Base(src))
	jpg, err := toJPEG(img)
	if err != nil {
		return nil, fmt.Errorf("cannot decode cover: %v", err)
	}
	if bytes.Equal(jpg, img) && filepath.Base(src) == "cover.jpg" {
		return nil, nil
	}
	dst := filepath.Join(dir, "cover.jpg")
	if err := os.WriteFile(dst, jpg, 0644); err != nil {
		return nil, err
	}
	return []change{{File: "cover.jpg", Detail: "re-encoded from " + filepath.Base(src)}}, nil
}

// reEmbedCover embeds the folder's cover.jpg into every track's APIC frame
// (synchronous — unlike the fire-and-forget embed behind /upload).
func reEmbedCover(dir string, j *job) ([]change, error) {
	src := findCover(dir)
	if src == "" {
		return nil, fmt.Errorf("no cover file in album folder")
	}
	img, err := os.ReadFile(src)
	if err != nil {
		return nil, err
	}
	j.setMessage("embedding " + filepath.Base(src) + " into tracks")
	done, failed := embedCover(dir, img)
	if failed > 0 {
		return nil, fmt.Errorf("%d of %d tracks failed", failed, done+failed)
	}
	return []change{{File: "album", Detail: fmt.Sprintf("embedded %s into %d mp3s", filepath.Base(src), done)}}, nil
}

// ── convert (ffmpeg) ─────────────────────────────────────────────────────────

func convertAlbum(dir, to, bitrate string, deleteOriginal, apply bool, j *job) ([]change, error) {
	srcExts := map[string]bool{}
	switch to {
	case "mp3":
		srcExts = map[string]bool{".flac": true, ".m4a": true, ".mp4": true}
	case "flac":
		srcExts = map[string]bool{".wav": true}
	default:
		return nil, fmt.Errorf("unsupported target format %q", to)
	}
	if bitrate == "" {
		bitrate = "320k"
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	var sources []string
	for _, e := range entries {
		if !e.IsDir() && srcExts[strings.ToLower(filepath.Ext(e.Name()))] {
			sources = append(sources, e.Name())
		}
	}
	var changes []change
	for i, name := range sources {
		j.setProgress(i+1, len(sources))
		j.setMessage("converting " + name)
		src := filepath.Join(dir, name)
		dst := strings.TrimSuffix(src, filepath.Ext(src)) + "." + to
		ch := change{File: name, Detail: "→ " + filepath.Base(dst)}
		if apply {
			args := []string{"-y", "-i", src}
			if to == "mp3" {
				args = append(args, "-vn", "-ab", bitrate, "-map_metadata", "0", "-id3v2_version", "3")
			} else {
				args = append(args, "-compression_level", "8")
			}
			args = append(args, dst)
			out, err := exec.Command("ffmpeg", args...).CombinedOutput()
			if err != nil {
				log.Printf("convert: %s: %v\n%s", src, err, out)
				ch.Detail += " — FAILED"
				changes = append(changes, ch)
				continue
			}
			if deleteOriginal {
				if err := os.Remove(src); err != nil {
					log.Printf("convert: delete %s: %v", src, err)
				} else {
					ch.Detail += " (original deleted)"
				}
			}
		}
		changes = append(changes, ch)
	}
	return changes, nil
}

// ── enrich (genre/year via MusicBrainz + Last.fm, lyrics via LRCLIB) ────────

const mbAPI = "https://musicbrainz.org/ws/2"

var httpClient = &http.Client{Timeout: 15 * time.Second}

func getJSON(url string, out interface{}) error {
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "attic-music/1.0 (ekskog@gmail.com)")
	resp, err := httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("HTTP %d from %s", resp.StatusCode, url)
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

func humanAlbumName(dir string) (artist, album string) {
	artist = strings.ReplaceAll(filepath.Base(filepath.Dir(dir)), "_", " ")
	album  = yearPrefix.ReplaceAllString(filepath.Base(dir), "")
	album  = strings.ReplaceAll(album, "_", " ")
	return
}

func parseYear(s string) int {
	m := regexp.MustCompile(`^(\d{4})`).FindStringSubmatch(strings.TrimSpace(s))
	if m == nil {
		return 0
	}
	y, _ := strconv.Atoi(m[1])
	if y < 1900 || y > 2100 {
		return 0
	}
	return y
}

var genericGenres = map[string]bool{
	"rock": true, "pop": true, "jazz": true, "blues": true, "folk": true, "classical": true,
	"country": true, "metal": true, "electronic": true, "dance": true, "hip hop": true,
	"hip-hop": true, "rap": true, "soul": true, "funk": true, "reggae": true, "punk": true,
	"alternative": true, "indie": true, "r&b": true, "rnb": true, "ambient": true,
	"world": true, "latin": true, "gospel": true, "ska": true, "grunge": true,
	"experimental": true, "noise": true, "hardcore": true, "emo": true, "acoustic": true,
	"instrumental": true, "soundtrack": true,
}

func itemCount(m map[string]interface{}) int {
	if c, ok := m["count"].(float64); ok {
		return int(c)
	}
	return 0
}

func titleCase(s string) string {
	words := strings.Fields(s)
	for i, w := range words {
		if w == "" {
			continue
		}
		words[i] = strings.ToUpper(w[:1]) + w[1:]
	}
	return strings.Join(words, " ")
}

func pickGenre(items []map[string]interface{}) string {
	if len(items) == 0 {
		return ""
	}
	sort.SliceStable(items, func(i, j int) bool { return itemCount(items[i]) > itemCount(items[j]) })
	top := strings.TrimSpace(fmt.Sprintf("%v", items[0]["name"]))
	if top != "" && !genericGenres[strings.ToLower(top)] {
		return titleCase(top)
	}
	for _, it := range items[1:] {
		n := strings.TrimSpace(fmt.Sprintf("%v", it["name"]))
		if n != "" && !genericGenres[strings.ToLower(n)] {
			return titleCase(n)
		}
	}
	return titleCase(top)
}

func mbSearchReleases(artist, album string) []map[string]interface{} {
	q := `artist:"` + artist + `" AND release:"` + album + `"`
	var body struct {
		Releases []map[string]interface{} `json:"releases"`
	}
	if err := getJSON(mbAPI+"/release?query="+url.QueryEscape(q)+"&fmt=json&limit=25", &body); err != nil {
		log.Printf("mbSearchReleases: %v", err)
		return nil
	}
	return body.Releases
}

func mbGenre(releases []map[string]interface{}) string {
	for _, rel := range releases {
		rid, _ := rel["id"].(string)
		if rid == "" {
			continue
		}
		time.Sleep(time.Second) // MusicBrainz rate limit: 1 req/s
		var d map[string]interface{}
		if err := getJSON(mbAPI+"/release/"+rid+"?inc=genres+tags&fmt=json", &d); err != nil {
			continue
		}
		for _, field := range []string{"genres", "tags"} {
			raw, ok := d[field].([]interface{})
			if !ok {
				continue
			}
			var items []map[string]interface{}
			for _, x := range raw {
				if m, ok := x.(map[string]interface{}); ok {
					items = append(items, m)
				}
			}
			if g := pickGenre(items); g != "" {
				return g
			}
		}
	}
	return ""
}

func mbYear(releases []map[string]interface{}) string {
	var years []int
	for _, r := range releases {
		if d, ok := r["date"].(string); ok {
			if y := parseYear(d); y != 0 {
				years = append(years, y)
			}
		}
		if rg, ok := r["release-group"].(map[string]interface{}); ok {
			if d, ok := rg["first-release-date"].(string); ok {
				if y := parseYear(d); y != 0 {
					years = append(years, y)
				}
			}
		}
	}
	if len(years) == 0 {
		return ""
	}
	min := years[0]
	for _, y := range years[1:] {
		if y < min {
			min = y
		}
	}
	return strconv.Itoa(min)
}

func lastfmGenre(key, artist, album string) string {
	base := "https://ws.audioscrobbler.com/2.0/?api_key=" + key + "&format=json"
	for _, method := range []string{
		"album.getTopTags&artist=" + url.QueryEscape(artist) + "&album=" + url.QueryEscape(album) + "&autocorrect=1",
		"artist.getTopTags&artist=" + url.QueryEscape(artist) + "&autocorrect=1",
	} {
		var d struct {
			Album  struct {
				Toptags struct {
					Tag []map[string]interface{} `json:"tag"`
				} `json:"toptags"`
			} `json:"album"`
			Artist struct {
				Toptags struct {
					Tag []map[string]interface{} `json:"tag"`
				} `json:"toptags"`
			} `json:"artist"`
			Error *struct{ Message string `json:"message"` } `json:"error"`
		}
		if err := getJSON(base+"&method="+method, &d); err != nil {
			continue
		}
		if d.Error != nil {
			continue
		}
		var items []map[string]interface{}
		if strings.HasPrefix(method, "album.") {
			items = d.Album.Toptags.Tag
		} else {
			items = d.Artist.Toptags.Tag
		}
		if g := pickGenre(items); g != "" {
			return g
		}
		time.Sleep(300 * time.Millisecond)
	}
	return ""
}

func enrichGenreYear(dir, lastfmKey string, doGenre, doYear, overwriteYear, apply bool, j *job) ([]change, error) {
	mp3s := mp3Names(dir)
	if len(mp3s) == 0 {
		return nil, nil
	}
	needGenre, needYear := doGenre, doYear
	existingYear := ""
	for _, name := range mp3s {
		frames, _ := readTags(filepath.Join(dir, name))
		if doGenre && strings.TrimSpace(frames["TCON"]) != "" {
			needGenre = false
		}
		if y := strings.TrimSpace(frames["TDRC"]); doYear && y != "" {
			existingYear = y
			if !overwriteYear {
				needYear = false
			}
		}
	}
	if !needGenre && !needYear {
		return []change{{File: "album", Detail: "already complete"}}, nil
	}
	artist, album := humanAlbumName(dir)
	j.setMessage("searching MusicBrainz for " + artist + " / " + album)
	rel := mbSearchReleases(artist, album)
	var genre, year string
	if needGenre {
		genre = mbGenre(rel)
		if genre == "" && lastfmKey != "" {
			j.setMessage("searching Last.fm")
			genre = lastfmGenre(lastfmKey, artist, album)
		}
	}
	yearConfirmed := false
	if needYear {
		year = mbYear(rel)
		if year != "" && year == existingYear {
			year = ""            // already correct — nothing to overwrite
			yearConfirmed = true // …but MusicBrainz *was* found, so this isn't a miss
		}
	}
	if genre == "" && year == "" {
		if yearConfirmed {
			return []change{{File: "album", Detail: "year already correct (" + existingYear + ")"}}, nil
		}
		return []change{{File: "album", Detail: "no genre/year found (search: " + artist + " / " + album + ")"}}, nil
	}
	detail := ""
	if genre != "" {
		detail = "genre = " + genre
	}
	if year != "" {
		if detail != "" {
			detail += ", "
		}
		if existingYear != "" && existingYear != year {
			detail += "year " + existingYear + " → " + year
		} else {
			detail += "year = " + year
		}
	}
	changes := []change{{File: "album", Detail: detail}}
	if apply {
		j.setMessage("writing tags")
		frames := map[string]string{}
		if genre != "" {
			frames["TCON"] = genre
		}
		if year != "" {
			frames["TDRC"] = year
		}
		for _, name := range mp3s {
			if err := writeFrames(filepath.Join(dir, name), frames); err != nil {
				log.Printf("enrich: write %s: %v", name, err)
			}
		}
	}
	return changes, nil
}

func enrichLyrics(dir string, apply bool, j *job) ([]change, error) {
	var changes []change
	names := mp3Names(dir)
	for i, name := range names {
		j.setProgress(i+1, len(names))
		j.setMessage("searching lyrics for " + name)
		path := filepath.Join(dir, name)
		tag, err := id3v2.Open(path, id3v2.Options{Parse: true})
		if err != nil {
			return changes, err
		}
		artist := textValue(tag, "TPE1")
		title  := textValue(tag, "TIT2")
		album  := textValue(tag, "TALB")
		tag.Close()
		if title == "" {
			continue
		}
		var d struct {
			PlainLyrics  string `json:"plainLyrics"`
			SyncedLyrics string `json:"syncedLyrics"`
		}
		u := "https://lrclib.net/api/get?artist_name=" + url.QueryEscape(artist) +
			"&track_name=" + url.QueryEscape(title) +
			"&album_name=" + url.QueryEscape(album)
		if err := getJSON(u, &d); err != nil || d.PlainLyrics == "" {
			continue
		}
		tag, err = id3v2.Open(path, id3v2.Options{Parse: true})
		if err != nil {
			return changes, err
		}
		tag.DeleteFrames(tag.CommonID("Unsynchronised lyrics/text transcription"))
		tag.AddUnsynchronisedLyricsFrame(id3v2.UnsynchronisedLyricsFrame{
			Encoding: id3v2.EncodingUTF8,
			Language: "eng",
			Lyrics:   d.PlainLyrics,
		})
		if apply {
			if err := tag.Save(); err != nil {
				tag.Close()
				return changes, err
			}
		}
		tag.Close()
		detail := "USLT added"
		if d.SyncedLyrics != "" {
			if apply {
				os.WriteFile(strings.TrimSuffix(path, filepath.Ext(path))+".lrc", []byte(d.SyncedLyrics), 0644)
			}
			detail += " + .lrc sidecar"
		}
		changes = append(changes, change{File: name, Detail: detail})
	}
	return changes, nil
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

	// ── musiclib fold: async jobs ────────────────────────────────────────
	// Every maintenance POST below starts a job and returns 202 + {"id": …};
	// poll GET /job?id= for progress and result. Previews (no apply=1) are
	// jobs too, so the network-bound ones (MusicBrainz, LRCLIB) don't block
	// the request, and slow ones report per-item progress.
	http.HandleFunc("/audit", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		artist := r.FormValue("artist")
		album  := r.FormValue("album")
		if r.FormValue("scope") != "all" {
			dir, ok := albumDirOf(artist, album)
			if !ok {
				http.Error(w, "album directory not found (or use scope=all)", http.StatusNotFound)
				return
			}
			id := startJob("audit", false, "", func(j *job) {
				j.setMessage("auditing " + filepath.Base(filepath.Dir(dir)) + "/" + filepath.Base(dir))
				j.done(nil, map[string]interface{}{"album": auditDir(dir)})
			})
			writeJobAccepted(w, id)
			return
		}
		id := startJob("audit", false, "", func(j *job) {
			dirs    := map[string]bool{}
			dirList := []string{}
			for _, d := range albumDirMap {
				if !dirs[d] {
					dirs[d] = true
					dirList = append(dirList, d)
				}
			}
			problems := []albumAudit{}
			for i, d := range dirList {
				j.setProgress(i+1, len(dirList))
				j.setMessage("auditing " + filepath.Base(filepath.Dir(d)) + "/" + filepath.Base(d))
				a := auditDir(d)
				if auditIsProblem(a) {
					problems = append(problems, a)
				}
			}
			sort.Slice(problems, func(i, k int) bool { return problems[i].Folder < problems[k].Folder })
			j.done(nil, map[string]interface{}{"scanned": len(dirList), "problems": problems})
		})
		writeJobAccepted(w, id)
	})

	// ── musiclib fold: tag cleanup ───────────────────────────────────────
	// POST /cleanup?artist=&album=&op=sort-tags|golden-set|lowercase|from-filename
	http.HandleFunc("/cleanup", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		artist := r.FormValue("artist")
		album  := r.FormValue("album")
		op     := r.FormValue("op")
		apply  := r.FormValue("apply") == "1"
		dir, ok := albumDirOf(artist, album)
		if !ok {
			http.Error(w, "album directory not found", http.StatusNotFound)
			return
		}
		var run func(j *job) ([]change, error)
		switch op {
		case "sort-tags":
			run = func(j *job) ([]change, error) { return cleanupSortTags(dir, apply, j) }
		case "golden-set":
			run = func(j *job) ([]change, error) { return cleanupGoldenSet(dir, apply, j) }
		case "lowercase":
			run = func(j *job) ([]change, error) { return cleanupLowercase(dir, apply, j) }
		case "from-filename":
			run = func(j *job) ([]change, error) { return cleanupTagFromFilename(dir, apply, j) }
		default:
			http.Error(w, "unknown op", http.StatusBadRequest)
			return
		}
		id := startJob("cleanup:"+op, apply, dir, func(j *job) {
			changes, err := run(j)
			if err != nil {
				j.fail(err)
				return
			}
			j.done(changes, nil)
		})
		writeJobAccepted(w, id)
	})

	// ── musiclib fold: artwork ───────────────────────────────────────────
	http.HandleFunc("/normalize-cover", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		dir, ok := albumDirOf(r.FormValue("artist"), r.FormValue("album"))
		if !ok {
			http.Error(w, "album directory not found", http.StatusNotFound)
			return
		}
		id := startJob("normalize-cover", true, dir, func(j *job) {
			changes, err := normalizeCover(dir, j)
			if err != nil {
				j.fail(err)
				return
			}
			j.done(changes, nil)
		})
		writeJobAccepted(w, id)
	})

	http.HandleFunc("/re-embed-cover", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		dir, ok := albumDirOf(r.FormValue("artist"), r.FormValue("album"))
		if !ok {
			http.Error(w, "album directory not found", http.StatusNotFound)
			return
		}
		id := startJob("re-embed-cover", true, dir, func(j *job) {
			changes, err := reEmbedCover(dir, j)
			if err != nil {
				j.fail(err)
				return
			}
			j.done(changes, nil)
		})
		writeJobAccepted(w, id)
	})

	// ── musiclib fold: convert ───────────────────────────────────────────
	// POST /convert?artist=&album=&to=mp3|flac&bitrate=320k&deleteOriginal=1
	http.HandleFunc("/convert", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		dir, ok := albumDirOf(r.FormValue("artist"), r.FormValue("album"))
		if !ok {
			http.Error(w, "album directory not found", http.StatusNotFound)
			return
		}
		to      := r.FormValue("to")
		bitrate := r.FormValue("bitrate")
		del     := r.FormValue("deleteOriginal") == "1"
		apply   := r.FormValue("apply") == "1"
		id := startJob("convert:"+to, apply, dir, func(j *job) {
			changes, err := convertAlbum(dir, to, bitrate, del, apply, j)
			if err != nil {
				j.fail(err)
				return
			}
			j.done(changes, nil)
		})
		writeJobAccepted(w, id)
	})

	// ── musiclib fold: enrich ────────────────────────────────────────────
	// POST /enrich?artist=&album=&fields=genre,year&lastfmKey=...&overwriteYear=1&apply=1
	// overwriteYear=1 re-fetches the oldest MusicBrainz release year and replaces
	// TDRC even when the album already has one (normal runs only fill blanks).
	http.HandleFunc("/enrich", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		dir, ok := albumDirOf(r.FormValue("artist"), r.FormValue("album"))
		if !ok {
			http.Error(w, "album directory not found", http.StatusNotFound)
			return
		}
		fields        := r.FormValue("fields")
		apply         := r.FormValue("apply") == "1"
		overwriteYear := r.FormValue("overwriteYear") == "1"
		id := startJob("enrich", apply, dir, func(j *job) {
			changes, err := enrichGenreYear(dir, r.FormValue("lastfmKey"),
				strings.Contains(fields, "genre"), strings.Contains(fields, "year"), overwriteYear, apply, j)
			if err != nil {
				j.fail(err)
				return
			}
			j.done(changes, nil)
		})
		writeJobAccepted(w, id)
	})

	// POST /enrich-lyrics?artist=&album=&apply=1  (LRCLIB → USLT + .lrc)
	http.HandleFunc("/enrich-lyrics", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		dir, ok := albumDirOf(r.FormValue("artist"), r.FormValue("album"))
		if !ok {
			http.Error(w, "album directory not found", http.StatusNotFound)
			return
		}
		apply := r.FormValue("apply") == "1"
		id := startJob("enrich-lyrics", apply, dir, func(j *job) {
			changes, err := enrichLyrics(dir, apply, j)
			if err != nil {
				j.fail(err)
				return
			}
			j.done(changes, nil)
		})
		writeJobAccepted(w, id)
	})

	// ── job status ───────────────────────────────────────────────────────
	// GET /job?id= → one job's state; GET /jobs → recent jobs (newest first).
	http.HandleFunc("/job", func(w http.ResponseWriter, r *http.Request) {
		id := r.URL.Query().Get("id")
		jobsMu.Lock()
		j := jobs[id]
		var out *job
		if j != nil {
			c := *j
			out = &c
		}
		jobsMu.Unlock()
		if out == nil {
			http.Error(w, "job not found", http.StatusNotFound)
			return
		}
		writeJSON(w, out)
	})

	http.HandleFunc("/jobs", func(w http.ResponseWriter, r *http.Request) {
		jobsMu.Lock()
		out := make([]*job, 0, len(jobIDs))
		for i := len(jobIDs) - 1; i >= 0; i-- {
			if j, ok := jobs[jobIDs[i]]; ok {
				c := *j
				out = append(out, &c)
			}
		}
		jobsMu.Unlock()
		writeJSON(w, out)
	})

	log.Printf("listening on :8080 (LOG_REQUESTS=%v)", logRequests)
	log.Fatal(http.ListenAndServe(":8080", nil))
}
