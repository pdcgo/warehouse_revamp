package inventory_v1

import (
	"errors"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

func rackToProto(r *inventory_service_models.Rack) *inventoryv1.Rack {
	return &inventoryv1.Rack{
		Id:          r.ID,
		WarehouseId: r.WarehouseID,
		Code:        r.Code,
		Name:        r.Name,
		Description: r.Description,
		Deleted:     r.Deleted,
	}
}

var errRackMissing = errors.New("rack not found")

// #138: a shelf with goods on it cannot be deleted — empty it first. The FK cannot enforce this
// because RackDelete is a SOFT delete, so the constraint never fires and the stock would be stranded
// at a location that no longer appears in any list.
var errRackHoldsStock = errors.New("this rack still holds stock — move it off the rack first")

func rackNotFound() error {
	return connect.NewError(connect.CodeNotFound, errRackMissing)
}

// rackDBError maps a duplicate label to AlreadyExists (a client error — someone already painted that
// code on a shelf) and everything else to Internal.
func rackDBError(err error) error {
	if errors.Is(err, gorm.ErrDuplicatedKey) {
		return connect.NewError(connect.CodeAlreadyExists,
			errors.New("a rack with this code already exists in this warehouse"))
	}

	return connect.NewError(connect.CodeInternal, err)
}

// rackExists reports whether an ACTIVE rack with this id exists IN THIS WAREHOUSE. The warehouse_id
// clause is the scope check — it is what stops one warehouse touching another's racks by id.
func rackExists(tx *gorm.DB, warehouseID, rackID uint64) (bool, error) {
	var count int64

	err := tx.
		Model(&inventory_service_models.Rack{}).
		Where("id = ? AND warehouse_id = ? AND deleted = ?", rackID, warehouseID, false).
		Count(&count).
		Error

	return count > 0, err
}
