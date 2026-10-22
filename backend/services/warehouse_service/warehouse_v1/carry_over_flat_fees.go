package warehouse_v1

import (
	"context"
	"fmt"
	"time"

	"gorm.io/gorm/clause"

	"github.com/pdcgo/warehouse_revamp/backend/services/warehouse_service/warehouse_service_models"
)

// FlatFee is a warehouse's DEFAULT flat fee as it stands before the switch-over day — liability's handling_fee, whole
// rupiah, the one every seller without a row of its own pays.
type FlatFee struct {
	WarehouseID uint64
	Fee         float64
}

// CarryOverResult is what one carry-over did.
type CarryOverResult struct {
	// Warehouses given their flat fee as their rate by this run.
	Carried int
	// Warehouses that already had a rate — one they set, or an earlier carry-over's — left exactly as they were.
	Skipped int
}

// CarryOverFlatFees is step 2 of the-flat-rate-is-dropped-last: each warehouse's default flat fee becomes its rate,
// EXACTLY — fee_percent 0, min_fee = max_fee = the flat fee ("today's flat fee" in the-fee-has-a-floor-and-a-cap). A
// floor equal to the cap is a flat fee, so a seller on the default pays the same on the switch-over day.
//
// A flat fee of 0 becomes 0% with no floor and NO cap. It charges nothing today and still charges nothing, and a cap of
// 0 would be refused by the table (an-empty-cap-means-no-cap). 0% is a rate, so that warehouse keeps taking orders when
// the refusal goes on (a-warehouse-with-no-rate-takes-no-orders).
//
// IT NEVER REPLACES A RATE. A warehouse that already has one keeps it: the rate it set itself wins, and a second run
// carries nothing. One INSERT … ON CONFLICT (warehouse_id) DO NOTHING on the unique index, so a manager saving at the
// same moment is not overwritten either — whichever lands first is the rate.
func (s *Service) CarryOverFlatFees(ctx context.Context, fees []FlatFee) (CarryOverResult, error) {
	now := time.Now()
	rows := make([]warehouse_service_models.WarehouseFee, 0, len(fees))

	for _, flat := range fees {
		// Liability's CHECK keeps handling_fee >= 0, so either is a caller's bug — refused before anything is written.
		if flat.WarehouseID == 0 || flat.Fee < 0 {
			return CarryOverResult{}, fmt.Errorf("carry-over: warehouse %d's flat fee %v is not a fee", flat.WarehouseID,
				flat.Fee)
		}

		row := warehouse_service_models.WarehouseFee{
			WarehouseID: flat.WarehouseID,
			FeePercent:  0,
			MinFee:      flat.Fee,
			CreatedAt:   now,
			UpdatedAt:   now,
		}

		if flat.Fee > 0 {
			flatCap := flat.Fee
			row.MaxFee = &flatCap
		}

		rows = append(rows, row)
	}

	carried, err := s.insertUnlessSet(ctx, rows)
	if err != nil {
		return CarryOverResult{}, err
	}

	return CarryOverResult{Carried: carried, Skipped: len(rows) - carried}, nil
}

// insertUnlessSet writes each row only where its warehouse has no rate yet, in ONE statement — INSERT … ON CONFLICT
// (warehouse_id) DO NOTHING — and returns how many it wrote. The table's CHECKs refuse a bad row, and then nothing is
// written at all.
func (s *Service) insertUnlessSet(ctx context.Context, rows []warehouse_service_models.WarehouseFee) (int, error) {
	if len(rows) == 0 {
		return 0, nil
	}

	// RowsAffected counts the rows the INSERT returned, which under DO NOTHING are only the ones it wrote.
	result := s.db.
		WithContext(ctx).
		Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "warehouse_id"}},
			DoNothing: true,
		}).
		Create(&rows)
	if result.Error != nil {
		return 0, result.Error
	}

	return int(result.RowsAffected), nil
}
