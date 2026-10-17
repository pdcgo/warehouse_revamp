package inventory_v1

import (
	"strconv"
	"strings"
)

// int64Array is a Postgres array literal bound as ONE parameter — GORM expands a Go slice into a list, which a set-based
// `UPDATE … FROM unnest(CAST(? AS bigint[]), …)` cannot take (ledger-writes-are-set-based).
func int64Array(values []int64) string {
	parts := make([]string, 0, len(values))
	for _, v := range values {
		parts = append(parts, strconv.FormatInt(v, 10))
	}

	return "{" + strings.Join(parts, ",") + "}"
}
