package team_service_models

import "time"

// TeamFormerCode is a row of `team_former_codes` — a code a team HELD once and has moved on from (backlog #149,
// a-team-code-change-recomposes-its-product-codes, its Q1 "A"): a team code once used is never given to another team, so
// an old sticker's ABC-… can only ever mean this team's product. The code is the key — it is a former code of ONE team —
// and the team may take its own former code back (the row is then removed: the code is current again).
type TeamFormerCode struct {
	TeamCode string `gorm:"primaryKey"`
	TeamID   uint64
	// When the team moved on from it — the TeamCodeUpdate that replaced it.
	RetiredAt time.Time
}

func (TeamFormerCode) TableName() string {
	return "team_former_codes"
}
