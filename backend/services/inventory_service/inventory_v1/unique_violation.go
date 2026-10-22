package inventory_v1

import (
	"errors"

	"github.com/jackc/pgx/v5/pgconn"
	"gorm.io/gorm"
)

// isUniqueViolation detects a duplicate key in BOTH forms — GORM opened with TranslateError turns the driver's 23505
// into gorm.ErrDuplicatedKey, a raw Exec may not.
func isUniqueViolation(err error) bool {
	if errors.Is(err, gorm.ErrDuplicatedKey) {
		return true
	}

	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code == "23505"
	}

	return false
}
