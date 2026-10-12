package settlement_service_models

import "time"

// SettlementServiceMetadata is a row of `settlement_service_metadata` (00005) — the service's
// configuration, human-set and service-read (meta_context.md).
//
// Each key defines its own encoding of Value. See MetadataProcessEventLock.
type SettlementServiceMetadata struct {
	ID        uint64 `gorm:"primaryKey"`
	Key       string
	Value     string
	UpdatedAt time.Time
}

func (SettlementServiceMetadata) TableName() string {
	return "settlement_service_metadata"
}

// MetadataProcessEventLock is the developer's maintenance switch — `{"lock":true|false}`. While true, the
// webhook refuses every event so Pub/Sub redelivers it later.
const MetadataProcessEventLock = "process_event_lock"
