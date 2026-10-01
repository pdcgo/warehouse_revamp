package shipment_v1

import (
	"context"

	"gorm.io/gorm/clause"

	"github.com/pdcgo/warehouse_revamp/backend/services/shipment_service/shipment_service_models"
)

// updateReturning applies `updates` to one channel in a SINGLE statement and reads the row back from
// RETURNING — no read-then-write, so no window for a concurrent write to slip between them. Postgres
// counts every MATCHED row for an UPDATE, identical values included, so zero rows means no such id.
func (s *Service) updateReturning(
	ctx context.Context,
	channelID uint64,
	updates map[string]any,
) (*shipment_service_models.ShipmentChannel, error) {
	var rows []shipment_service_models.ShipmentChannel

	updates["updated_at"] = clause.Expr{SQL: "NOW()"}

	res := s.db.
		WithContext(ctx).
		Model(&rows).
		Clauses(clause.Returning{}).
		Where("id = ?", channelID).
		Updates(updates)
	if res.Error != nil {
		return nil, dbError(res.Error)
	}

	if res.RowsAffected == 0 || len(rows) == 0 {
		return nil, notFound()
	}

	return &rows[0], nil
}
