package remote

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// resolveDir turns a request's working_dir into an absolute path inside the workspace root.
//
// ⚠ This is a GUARD RAIL, not a boundary. The command it is about to run can `cd /` on its own,
// so nothing here contains a caller who wants out — what it contains is a path built by string
// concatenation somewhere in an agent's prompt, which is the failure that actually happens.
// Refusing it here means the agent gets a clear error instead of running `rm -rf build` two
// directories above the checkout.
func (s *Service) resolveDir(rel string) (string, error) {
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
		return "", fmt.Errorf("working_dir must be relative to the workspace root, got %q", rel)
	}

	joined := filepath.Join(s.root, filepath.FromSlash(rel))

	// Ask filepath, not strings: a HasPrefix check on the root would accept a sibling directory
	// whose name merely starts with it (…/warehouse_revamp_old next to …/warehouse_revamp).
	inside, err := filepath.Rel(s.root, joined)
	if err != nil || inside == ".." || strings.HasPrefix(inside, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("working_dir escapes the workspace root: %q", rel)
	}

	info, err := os.Stat(joined)
	if err != nil {
		return "", fmt.Errorf("working_dir %q: %w", rel, err)
	}

	if !info.IsDir() {
		return "", fmt.Errorf("working_dir %q is not a directory", rel)
	}

	return joined, nil
}
