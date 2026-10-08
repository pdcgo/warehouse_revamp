package inventory_v1

import (
	"strings"
	"time"
)

// withUpdatedAt stamps an update map — the racks' edits use it.
func withUpdatedAt(updates map[string]any) map[string]any {
	updates["updated_at"] = time.Now()

	return updates
}

// escapeLike neutralises LIKE wildcards so a search for "%" doesn't match everything.
func escapeLike(q string) string {
	return strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(q)
}
