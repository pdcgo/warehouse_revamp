package inventory_v1

import (
	"errors"
	"strings"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

func supplierToProto(s *inventory_service_models.Supplier) *inventoryv1.Supplier {
	return &inventoryv1.Supplier{
		Id:          s.ID,
		TeamId:      s.TeamID,
		Code:        s.Code,
		Name:        s.Name,
		Contact:     s.Contact,
		Province:    s.Province,
		City:        s.City,
		Address:     s.Address,
		Description: s.Description,
		Deleted:     s.Deleted,
	}
}

var errSupplierMissing = errors.New("supplier not found")

func supplierNotFound() error {
	return connect.NewError(connect.CodeNotFound, errSupplierMissing)
}

// supplierDBError maps a duplicate supplier code to AlreadyExists (a client error) and everything
// else to Internal.
func supplierDBError(err error) error {
	if errors.Is(err, gorm.ErrDuplicatedKey) {
		return connect.NewError(connect.CodeAlreadyExists,
			errors.New("a supplier with this code already exists in the team"))
	}

	return connect.NewError(connect.CodeInternal, err)
}

// supplierExists reports whether an ACTIVE supplier with this id exists IN THIS TEAM. The team_id
// clause is the scope check — it is what stops one team touching another's supplier by id.
func supplierExists(tx *gorm.DB, teamID, supplierID uint64) (bool, error) {
	var count int64

	err := tx.
		Model(&inventory_service_models.Supplier{}).
		Where("id = ? AND team_id = ? AND deleted = ?", supplierID, teamID, false).
		Count(&count).
		Error

	return count > 0, err
}

func withUpdatedAt(updates map[string]any) map[string]any {
	updates["updated_at"] = time.Now()

	return updates
}

// escapeLike neutralises LIKE wildcards so a search for "%" doesn't match everything.
func escapeLike(q string) string {
	return strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(q)
}
