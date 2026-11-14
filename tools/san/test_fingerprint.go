package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// The FINGERPRINT of a checkout: every source file the tests exercise, and a hash of its content
// (the-full-e2e-waits-for-a-measured-yes). Two fingerprints compared say which files changed —
// with no git, no commit and no clock involved, so a file edited and edited back reads unchanged,
// and a branch switch reads as exactly the files it swapped.

// fingerprintRoots are the trees whose files are tested. Paths are from the repository root.
var fingerprintRoots = []string{
	"backend",
	"proto",
	"tools",
	"frontend/src",
	"frontend/e2e",
	"frontend/.storybook",
}

// fingerprintFiles are single files outside those trees that every test run depends on — the
// module and package manifests and the frontend's build and test configuration.
var fingerprintFiles = []string{
	"go.mod",
	"go.sum",
	"frontend/package.json",
	"frontend/package-lock.json",
	"frontend/playwright.config.ts",
	"frontend/vite.config.ts",
	"frontend/vitest.config.ts",
	"frontend/vitest.unit.config.ts",
	"frontend/tsconfig.json",
	"frontend/index.html",
}

// skippedDirs are never walked: generated code (regenerated from the .proto files, which ARE
// fingerprinted), installed packages, build output, and the report folder itself.
var skippedDirs = map[string]bool{
	"gen":                true,
	"node_modules":       true,
	"dist":               true,
	"bin":                true,
	"e2e_report":         true,
	"storybook-static":   true,
	"test-results":       true,
	"playwright-report":  true,
	"graphify-out":       true,
	".git":               true,
	".vite":              true,
	"__screenshots__":    true,
	".san":               true,
	"development_data":   true,
	"coverage":           true,
	".turbo":             true,
	".cache":             true,
	".vitest":            true,
	".vitest-attachment": true,
	".auth":              true, // frontend/e2e/.auth — the e2e setup's saved sign-ins, rewritten every run
}

// skippedFile says whether a file inside a fingerprinted tree is build output or a run's leftover.
func skippedFile(name string) bool {
	switch {
	case name == ".e2e-lock", strings.HasPrefix(name, ".e2e-lock."),
		strings.HasSuffix(name, ".exe"),
		strings.HasSuffix(name, ".tsbuildinfo"),
		strings.HasSuffix(name, ".log"),
		strings.HasSuffix(name, ".test"),
		strings.HasPrefix(name, "~"),
		name == ".DS_Store":
		return true
	}

	return false
}

// Fingerprint is what one checkout held at one moment.
type Fingerprint struct {
	Version int               `json:"version"`
	TakenAt time.Time         `json:"taken_at"`
	Files   map[string]string `json:"files"` // repo-relative path, forward slashes → sha256 of the content
	// Set on last_green.json only: the run that tested it.
	Run string `json:"run,omitempty"`
}

// takeFingerprint walks root's source trees and hashes every file.
func takeFingerprint(root string) (*Fingerprint, error) {
	fp := &Fingerprint{Version: 1, TakenAt: time.Now(), Files: map[string]string{}}

	for _, tree := range fingerprintRoots {
		dir := filepath.Join(root, filepath.FromSlash(tree))

		_, err := os.Stat(dir)
		if errors.Is(err, fs.ErrNotExist) {
			continue
		}

		if err != nil {
			return nil, err
		}

		err = filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
			if err != nil {
				return err
			}

			if d.IsDir() {
				if path != dir && skippedDirs[d.Name()] {
					return filepath.SkipDir
				}

				return nil
			}

			// A junction or symlink is not a source file — and following one could leave the tree.
			if !d.Type().IsRegular() {
				return nil
			}

			if skippedFile(d.Name()) {
				return nil
			}

			return fp.add(root, path)
		})
		if err != nil {
			return nil, err
		}
	}

	for _, file := range fingerprintFiles {
		path := filepath.Join(root, filepath.FromSlash(file))

		_, err := os.Stat(path)
		if errors.Is(err, fs.ErrNotExist) {
			continue
		}

		if err != nil {
			return nil, err
		}

		err = fp.add(root, path)
		if err != nil {
			return nil, err
		}
	}

	return fp, nil
}

func (fp *Fingerprint) add(root, path string) error {
	rel, err := filepath.Rel(root, path)
	if err != nil {
		return err
	}

	sum, err := hashFile(path)
	if err != nil {
		return err
	}

	fp.Files[filepath.ToSlash(rel)] = sum

	return nil
}

// hashFile hashes a file's content with CRLF read as LF, so a checkout's line-ending setting is not
// a change: the same file checked out on Windows and on Linux has one fingerprint.
func hashFile(path string) (string, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}

	b = bytes.ReplaceAll(b, []byte("\r\n"), []byte("\n"))
	sum := sha256.Sum256(b)

	return hex.EncodeToString(sum[:]), nil
}

// Sum is one hash over the whole fingerprint — what a run report names as "the fingerprint tested".
func (fp *Fingerprint) Sum() string {
	paths := fp.paths()
	h := sha256.New()

	for _, p := range paths {
		fmt.Fprintf(h, "%s %s\n", p, fp.Files[p])
	}

	return hex.EncodeToString(h.Sum(nil))[:12]
}

func (fp *Fingerprint) paths() []string {
	paths := make([]string, 0, len(fp.Files))
	for p := range fp.Files {
		paths = append(paths, p)
	}

	sort.Strings(paths)

	return paths
}

// FileDiff is what changed between two fingerprints.
type FileDiff struct {
	Changed []string
	Added   []string
	Deleted []string
}

func (d FileDiff) Empty() bool {
	return len(d.Changed)+len(d.Added)+len(d.Deleted) == 0
}

func (d FileDiff) Count() int {
	return len(d.Changed) + len(d.Added) + len(d.Deleted)
}

// All is every path the diff names, sorted.
func (d FileDiff) All() []string {
	all := make([]string, 0, d.Count())
	all = append(all, d.Changed...)
	all = append(all, d.Added...)
	all = append(all, d.Deleted...)
	sort.Strings(all)

	return all
}

// diffFingerprints compares an older fingerprint with a newer one.
func diffFingerprints(old, cur *Fingerprint) FileDiff {
	var d FileDiff

	for _, p := range cur.paths() {
		was, ok := old.Files[p]

		switch {
		case !ok:
			d.Added = append(d.Added, p)
		case was != cur.Files[p]:
			d.Changed = append(d.Changed, p)
		}
	}

	for _, p := range old.paths() {
		_, ok := cur.Files[p]
		if !ok {
			d.Deleted = append(d.Deleted, p)
		}
	}

	return d
}

// diffSince lists the files whose modification time is after since — the stand-in for a missing
// baseline (--since): no hash to compare, so a deleted file cannot be seen.
func diffSince(root string, cur *Fingerprint, since time.Time) (FileDiff, error) {
	var d FileDiff

	for _, p := range cur.paths() {
		info, err := os.Stat(filepath.Join(root, filepath.FromSlash(p)))
		if err != nil {
			return d, err
		}

		if info.ModTime().After(since) {
			d.Changed = append(d.Changed, p)
		}
	}

	return d, nil
}

func readFingerprint(path string) (*Fingerprint, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	var fp Fingerprint

	err = json.Unmarshal(b, &fp)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}

	if fp.Files == nil {
		fp.Files = map[string]string{}
	}

	return &fp, nil
}

func writeJSON(path string, v any) error {
	err := os.MkdirAll(filepath.Dir(path), 0o755)
	if err != nil {
		return err
	}

	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}

	tmp := path + ".tmp"

	err = os.WriteFile(tmp, append(b, '\n'), 0o644)
	if err != nil {
		return err
	}

	return os.Rename(tmp, path)
}
