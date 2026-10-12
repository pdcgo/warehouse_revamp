package remote

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// errBadPath marks "the CALLER gave a bad path", as opposed to "the filesystem said no".
//
// The two must not collapse into one code: a path outside the root is the caller's mistake to fix
// and a failing disk is not, and an agent that cannot tell them apart will retry the wrong one.
var errBadPath = errors.New("remote: bad path")

// contain turns a caller's relative path into an absolute one inside the workspace root, without
// caring whether anything is there yet.
//
// ⚠ This is a GUARD RAIL, not a boundary. Exec's command can `cd /` on its own, so nothing here
// contains a caller who wants out — what it contains is a path built by string concatenation
// somewhere in an agent's prompt, which is the failure that actually happens. Refusing it here
// means the agent gets a clear error instead of writing over a file two directories above the
// checkout.
//
// It is shared by every RPC that takes a path, so a rule tightened for one cannot be looser for
// another — the version of this that had resolveDir checking and FileWrite not is exactly the bug
// this shape prevents.
func (s *Service) contain(rel string) (string, error) {
	rel = strings.TrimSpace(rel)
	if rel == "" {
		return s.root, nil
	}

	// filepath.IsAbs is platform-aware and says NO to "/etc" on Windows, so the explicit
	// separator check is not redundant — it is the Windows half of the same question. The volume
	// check catches "C:build", which is drive-relative and neither absolute nor safe to join.
	if filepath.IsAbs(rel) ||
		strings.HasPrefix(rel, "/") ||
		strings.HasPrefix(rel, `\`) ||
		filepath.VolumeName(rel) != "" {
		return "", fmt.Errorf("%w: must be relative to the workspace root, got %q", errBadPath, rel)
	}

	joined := filepath.Join(s.root, filepath.FromSlash(rel))

	// Ask filepath, not strings: a HasPrefix check on the root would accept a sibling directory
	// whose name merely starts with it (…/warehouse_revamp_old next to …/warehouse_revamp).
	inside, err := filepath.Rel(s.root, joined)
	if err != nil || inside == ".." || strings.HasPrefix(inside, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("%w: escapes the workspace root: %q", errBadPath, rel)
	}

	return joined, nil
}

// resolveDir is contain plus "and it must already be a directory" — what Exec needs, because a
// command cannot run somewhere that does not exist.
func (s *Service) resolveDir(rel string) (string, error) {
	joined, err := s.contain(rel)
	if err != nil {
		return "", err
	}

	info, err := os.Stat(joined)
	if err != nil {
		return "", fmt.Errorf("working_dir %q: %w", rel, err)
	}

	if !info.IsDir() {
		return "", fmt.Errorf("%w: working_dir %q is not a directory", errBadPath, rel)
	}

	return joined, nil
}

// resolveFile is contain plus "and it is not the root and not a directory".
//
// mustExist separates the two callers: FileRead needs the file to be there, FileWrite is often
// creating it. Both refuse a directory — writing bytes over a directory is never what was meant,
// and reading one would hand back an error from deep in os.ReadFile instead of a clear message.
func (s *Service) resolveFile(rel string, mustExist bool) (string, error) {
	joined, err := s.contain(rel)
	if err != nil {
		return "", err
	}

	if joined == s.root {
		return "", fmt.Errorf("%w: %q is the workspace root, not a file", errBadPath, rel)
	}

	info, err := os.Stat(joined)
	if err != nil {
		if mustExist || !os.IsNotExist(err) {
			return "", fmt.Errorf("path %q: %w", rel, err)
		}

		return joined, nil
	}

	if info.IsDir() {
		return "", fmt.Errorf("%w: %q is a directory", errBadPath, rel)
	}

	return joined, nil
}
