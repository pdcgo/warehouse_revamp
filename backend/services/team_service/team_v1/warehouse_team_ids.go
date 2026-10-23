package team_v1

import (
	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/services/team_service/team_service_models"
)

// WarehouseTeamIDs answers which of `ids` are WAREHOUSE teams, ascending. An id that is no team, or a team of another
// type, is left out. Exported for the fee carry-over (`san warehouse carry-over-fees`, step 2 of
// the-flat-rate-is-dropped-last): liability holds team ids opaque, and a selling team's default terms row must not
// become a warehouse fee.
//
// ⚠ A SOFT-DELETED warehouse is still a warehouse here, unlike TeamByIds, which omits it. The carry-over translates the
// rate that exists today, and dropping a deleted warehouse's would be a second rule nobody decided. It takes no orders
// either way.
func WarehouseTeamIDs(db *gorm.DB, ids []uint64) ([]uint64, error) {
	if len(ids) == 0 {
		return nil, nil
	}

	var warehouses []uint64

	err := db.
		Model(&team_service_models.Team{}).
		Where("id IN ?", ids).
		Where("type = ?", typeWarehouse).
		Order("id").
		Pluck("id", &warehouses).
		Error
	if err != nil {
		return nil, err
	}

	return warehouses, nil
}
