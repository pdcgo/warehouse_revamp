package supplier_service_models

import "time"

// SupplierServiceMetadata is a row of `supplier_service_metadata` (00002) — the service's configuration, human-set or
// fold-set and service-read. Each key defines its own encoding of Value.
type SupplierServiceMetadata struct {
	ID        uint64 `gorm:"primaryKey"`
	Key       string
	Value     string
	UpdatedAt time.Time
}

func (SupplierServiceMetadata) TableName() string {
	return "supplier_service_metadata"
}

const (
	// MetadataProcessEventLock is the developer's maintenance switch — `{"lock":true|false}`. While true, the webhook
	// refuses every event so Pub/Sub redelivers it later. Seeded by the migration.
	MetadataProcessEventLock = "process_event_lock"

	// MetadataFiguresLiveSince is the EARLIEST accept day the webhook has folded, YYYY-MM-DD — written by the live fold
	// only, never by the backfill. The backfill folds only what was accepted before it
	// (past-accepts-are-backfilled-once): the dedup rows are pruned after 45 days, this is not.
	MetadataFiguresLiveSince = "figures_live_since"

	// MetadataFiguresBackfilled marks the one-shot backfill as run — its RFC 3339 instant. A second run folds nothing.
	MetadataFiguresBackfilled = "figures_backfilled"
)
