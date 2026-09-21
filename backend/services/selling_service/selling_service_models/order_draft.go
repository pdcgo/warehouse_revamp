package selling_service_models

import "time"

// OrderDraft is a row of `order_drafts` (#190) — an INCOMPLETE order pushed in by a third-party app,
// which a person finishes and promotes into a real `orders` row. It lives in its own table so that
// `orders` keeps every constraint it has; here almost nothing is required, because incompleteness is
// what a draft is. Schema owned by goose; GORM only reads/writes rows.
//
// A draft is PERSONAL to its author and never publishes OrderCreatedEvent — placement does, and a
// draft was never placed by anybody.
type OrderDraft struct {
	ID     uint64 `gorm:"primaryKey"`
	TeamID uint64
	// Whoever's login the pushing app runs under — there is no machine identity here, so every draft
	// has a human accountable on it. The list handler narrows to this in addition to the team scope.
	AuthorUserID uint64

	// The external reference: which app pushed this, and the marketplace's own id for it. UNIQUE
	// together with TeamID, which is what makes OrderDraftPush idempotent — a retry updates the draft
	// in place rather than adding another.
	Source     string
	ExternalID string `gorm:"column:external_id"`

	// A JSON array of field names a human has edited. Held as a string: the pgx driver sends a string
	// to a jsonb column as text, which jsonb parses, and reads it back the same way — the same shape
	// team_service's warehouse schedules use. OrderDraftPush writes only fields NOT listed here.
	TouchedFields string `gorm:"type:jsonb"`

	// 0 until known. Opaque cross-service ids; no FK, so both can be deleted underneath a draft —
	// promote re-checks them and names which reference died.
	ShopID      uint64
	WarehouseID uint64

	CustomerName  string
	CustomerPhone string

	// The same frozen-address shape an order carries (#118), so promote copies rather than translates.
	ProvinsiCode  string
	ProvinsiName  string
	KabupatenCode string
	KabupatenName string
	KecamatanCode string
	KecamatanName string
	DesaCode      string
	DesaName      string
	KodePos       string
	AddressLine   string
	ShippingCode  string

	// As scraped, whole rupiah. Nothing here is authoritative — promote recomputes the order's money
	// from the mapped lines, and COGS has no meaning until the lines name real products.
	ShippingCost int64

	// The lines; loaded on demand (OrderDraftDetail).
	Items []OrderDraftItem `gorm:"foreignKey:DraftID"`

	CreatedAt time.Time
	UpdatedAt time.Time
}

func (OrderDraft) TableName() string {
	return "order_drafts"
}
