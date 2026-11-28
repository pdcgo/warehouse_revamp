package product_v1

import (
	"strconv"

	"gorm.io/gorm"
)

// lockTeamProductCodes takes the team's PRODUCT-CODE lock for the rest of the transaction (backlog #149): a
// `pg_advisory_xact_lock` keyed on the team, held by every write that reads the team's code and stores a product code
// composed from it — ProductCreate, a correction in ProductUpdate — and by the team code change's recompose
// (RecomposeTeamCodes). So a create that read ABC commits ABC-… BEFORE the recompose reads the team's rows (and is
// recomposed with them), or waits for the change to commit and then reads XYZ: a create racing the change never lands
// the old prefix (a-team-code-change-recomposes-its-product-codes). Taken FIRST in each of them, before any row lock, so
// two of them never wait on each other in opposite orders.
func lockTeamProductCodes(tx *gorm.DB, teamID uint64) error {
	return tx.
		Exec("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))", productCodeLockKey(teamID)).
		Error
}

// productCodeLockKey is the lock's key — this service's name, what it guards, the team.
func productCodeLockKey(teamID uint64) string {
	return "product_service:product-code:" + strconv.FormatUint(teamID, 10)
}
