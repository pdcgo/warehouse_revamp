package supplier_v1_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_service_models"
	supplier_v1 "github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_v1"
)

// The teams the tests stand in. Selling teams keep suppliers; the warehouse team must be refused one.
const (
	sellingA  uint64 = 12
	sellingB  uint64 = 13
	warehouse uint64 = 20
)

// sellingTeams is the SellingTeams fake — a set of selling team ids, or an error to return for every ask.
type sellingTeams struct {
	selling map[uint64]bool
	err     error
}

func (f sellingTeams) IsSelling(_ context.Context, teamID uint64) (bool, error) {
	if f.err != nil {
		return false, f.err
	}

	return f.selling[teamID], nil
}

var errTeamServiceDown = errors.New("team_service unreachable")

func newService(t *testing.T, db *gorm.DB) *supplier_v1.Service {
	t.Helper()

	return supplier_v1.NewService(db, sellingTeams{selling: map[uint64]bool{sellingA: true, sellingB: true}}, nil)
}

func page(n, limit uint32) *commonv1.CommonPagination {
	return &commonv1.CommonPagination{Page: n, Limit: limit}
}

// insertSupplier seeds a live supplier of a team directly and returns it.
func insertSupplier(t *testing.T, db *gorm.DB, teamID uint64, name string) supplier_service_models.Supplier {
	t.Helper()

	s := supplier_service_models.Supplier{TeamID: teamID, Name: name}

	err := db.Create(&s).Error
	if err != nil {
		t.Fatalf("insert supplier: %v", err)
	}

	return s
}

// insertChannel seeds a live store of a supplier directly and returns it. channelType is the stored code.
func insertChannel(
	t *testing.T,
	db *gorm.DB,
	supplierID uint64,
	channelType, name string,
) supplier_service_models.SupplierChannel {
	t.Helper()

	c := supplier_service_models.SupplierChannel{SupplierID: supplierID, ChannelType: channelType, Name: name}

	err := db.Create(&c).Error
	if err != nil {
		t.Fatalf("insert channel: %v", err)
	}

	return c
}

// softDelete marks a row deleted directly — the state a delete leaves, without going through the handler.
func softDelete(t *testing.T, db *gorm.DB, model any, id uint64) {
	t.Helper()

	err := db.Model(model).Where("id = ?", id).Update("deleted_at", time.Now()).Error
	if err != nil {
		t.Fatalf("soft delete: %v", err)
	}
}

func loadSupplier(t *testing.T, db *gorm.DB, id uint64) supplier_service_models.Supplier {
	t.Helper()

	var s supplier_service_models.Supplier

	err := db.Where("id = ?", id).Take(&s).Error
	if err != nil {
		t.Fatalf("load supplier %d: %v", id, err)
	}

	return s
}

// countRows counts every row of a model's table, deleted ones included.
func countRows(t *testing.T, db *gorm.DB, model any) int64 {
	t.Helper()

	var n int64

	err := db.Model(model).Count(&n).Error
	if err != nil {
		t.Fatalf("count: %v", err)
	}

	return n
}

func loadChannel(t *testing.T, db *gorm.DB, id uint64) supplier_service_models.SupplierChannel {
	t.Helper()

	var c supplier_service_models.SupplierChannel

	err := db.Where("id = ?", id).Take(&c).Error
	if err != nil {
		t.Fatalf("load channel %d: %v", id, err)
	}

	return c
}
