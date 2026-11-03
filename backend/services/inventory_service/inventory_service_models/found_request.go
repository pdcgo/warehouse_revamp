package inventory_service_models

import "time"

// FoundRequestStatus is found_requests.status.
type FoundRequestStatus string

const (
	// Reported at the shelf; nothing posted (an-adjust-found-waits-for-the-owner-or-admin).
	FoundWaiting FoundRequestStatus = "waiting"
	// Approved: its `found` transaction is posted.
	FoundApproved FoundRequestStatus = "approved"
	// Rejected, with a reason: nothing posted.
	FoundRejected FoundRequestStatus = "rejected"
	// Closed by a stock count's finalize over its product on its rack: the count posted the units it found
	// (a-count-settles-the-found-it-counted).
	FoundSettled FoundRequestStatus = "settled"
)

// FoundRequest is a row of `found_requests` — units found on a rack outside a stock count, waiting for (or decided by)
// the warehouse Owner or Admin. Schema owned by goose (00036); GORM only reads and writes rows.
type FoundRequest struct {
	ID          uint64 `gorm:"primaryKey"`
	WarehouseID uint64
	// The product's owner, whose loss is claimed and whose batch is minted.
	TeamID       uint64
	ProductID    uint64
	ProductCode  string
	ProductName  string
	PlacementID  uint64
	StockCount   int64
	Note         string
	ReportedByID uint64
	ReportedAt   time.Time
	Status       FoundRequestStatus
	DecidedByID  *uint64
	DecidedAt    *time.Time
	RejectReason string
	// APPROVED: the `found` transaction and the batch it minted (nil when the claims took every unit).
	TransactionID *uint64
	MintedBatchID *uint64
	// SETTLED: the count whose finalize closed it.
	SettledByCountingSessionID *uint64
}

func (FoundRequest) TableName() string {
	return "found_requests"
}
