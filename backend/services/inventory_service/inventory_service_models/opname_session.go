package inventory_service_models

import "time"

// OpnameStatus is opname_sessions.status — the owner's words (opname.md §Table That Must have in Stock Opname).
type OpnameStatus string

const (
	// Counting. At most one per warehouse (one-active-count-per-warehouse).
	OpnameActive OpnameStatus = "active"
	// Finalized: posted and released.
	OpnameFinish OpnameStatus = "finish"
	// Called off: released, nothing posted (an-abandoned-count-waits-for-the-admin).
	OpnameCancel OpnameStatus = "cancel"
)

// OpnamePlan is opname_sessions.plan — the KIND of plan; its target was only a filter (the-plan-target-is-only-a-filter).
type OpnamePlan string

const (
	OpnamePlanAll       OpnamePlan = "all"
	OpnamePlanTeam      OpnamePlan = "team"
	OpnamePlanProduct   OpnamePlan = "product"
	OpnamePlanPlacement OpnamePlan = "placement"
)

// OpnameSession is a row of `opname_sessions` — one stock count of one warehouse (an-opname-is-a-locked-session). Schema
// owned by goose (00035); GORM only reads and writes rows.
type OpnameSession struct {
	ID          uint64 `gorm:"primaryKey"`
	WarehouseID uint64
	Status      OpnameStatus
	Plan        OpnamePlan
	CreatedByID uint64
	// Set together at finalize — finalizing is the agreement, with no override flag (finalizing-is-the-agreement).
	FinalizedByID *uint64
	FinalizedAt   *time.Time
	CreatedAt     time.Time
}

func (OpnameSession) TableName() string {
	return "opname_sessions"
}
