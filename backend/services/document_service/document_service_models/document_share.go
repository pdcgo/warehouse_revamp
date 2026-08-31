package document_service_models

import "time"

// DocumentShare is a row of `document_shares` — one team, other than the owner, that may read one
// document (a-payment-must-carry-proof).
//
// ⚠ IT IS THE ONLY WAY OUT OF THE OWNING TEAM, and it is a ROW rather than a rule. `GetDownloadUrl`
// scopes every read to the document's team on purpose; the alternative to this table was an internal
// signing path that skipped that check and let another service decide who may read, which makes one
// bug in one service's relation check a leak of every private file in the system.
//
// The invariant this preserves: THERE IS NO READ WITHOUT A ROW SAYING YOU MAY. The grant is made by
// the document's OWNER in their own scope, so no service asks another for permission, and this
// service learns "shared with team X" and never "this is a payment proof".
//
// ⚠ THERE IS NO UNSHARE. A creditor accepted or rejected a payment by looking at the file, and
// evidence for a decision somebody may be asked about later cannot be withdrawn by the party who
// supplied it. `documents.id` is referenced ON DELETE RESTRICT for the same reason.
//
// Schema owned by goose; GORM only reads and writes rows.
type DocumentShare struct {
	ID uint64 `gorm:"primaryKey"`

	DocumentID string
	// Opaque team_service id; no FK, like `documents.team_id`.
	TeamID uint64

	// Opaque user id. A share is somebody's act, and the file it opens is evidence in an argument
	// about money — "who let them see this" has to be answerable.
	GrantedBy uint64

	CreatedAt time.Time
}

func (DocumentShare) TableName() string {
	return "document_shares"
}
