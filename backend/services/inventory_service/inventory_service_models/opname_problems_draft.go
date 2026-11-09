package inventory_service_models

import "time"

// ProblemType is the reason a unit left in the warehouse's custody: broken or lost (a-loss-in-custody-is-a-stock-problem).
// The same two words are a `problem` transaction's ledger change types (problem-and-found-replace-opname).
type ProblemType string

const (
	ProblemBroken ProblemType = "broken"
	ProblemLost   ProblemType = "lost"
)

// OpnameProblemsDraft is a row of `opname_problems_drafts` — broken or lost on one rack in one session, with its reason,
// until finalize turns it into stock problems (the-difference-is-a-draft-until-finalize). Lost is the system's number,
// broken the counter's (a-short-rack-gets-a-lost-draft-from-the-system).
type OpnameProblemsDraft struct {
	ID                uint64 `gorm:"primaryKey"`
	WarehouseID       uint64
	TeamID            uint64
	ProductID         uint64
	PlacementID       uint64
	OpnameSessionID   uint64
	Note              string
	ProblemType       ProblemType
	ProblemStockCount int64
	CreatedAt         time.Time
}

func (OpnameProblemsDraft) TableName() string {
	return "opname_problems_drafts"
}
