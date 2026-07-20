package inventory_v1

import (
	"errors"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

var (
	// A warehouse granting ITSELF access is meaningless — it already has full access through its own
	// roles — so the row would be a no-op that reads like a permission. The DB has a CHECK as a
	// backstop; this is the message a person actually sees.
	errStockAccessSelf = errors.New("a warehouse already has access to its own stock")
	// Revoking something that was never granted (or is already revoked) is NotFound rather than a
	// silent success: "we stopped that team drawing from us" must not be true when it never could.
	errStockAccessMissing = errors.New("this team does not have access to draw from this warehouse")
)

func stockAccessGrantToProto(g *inventory_service_models.StockAccessGrant) *inventoryv1.StockAccessGrant {
	return &inventoryv1.StockAccessGrant{
		Id:            g.ID,
		WarehouseId:   g.WarehouseID,
		SellingTeamId: g.SellingTeamID,
		CreatedAtUnix: g.CreatedAt.Unix(),
	}
}

// stockAccessErr maps the internal errors to Connect codes. A duplicate grant is AlreadyExists rather
// than an error the caller has to parse — granting twice is a harmless mistake with an obvious meaning.
func stockAccessErr(err error) error {
	switch {
	case errors.Is(err, errStockAccessSelf):
		return connect.NewError(connect.CodeInvalidArgument, errStockAccessSelf)
	case errors.Is(err, errStockAccessMissing):
		return connect.NewError(connect.CodeNotFound, errStockAccessMissing)
	case errors.Is(err, gorm.ErrDuplicatedKey):
		return connect.NewError(connect.CodeAlreadyExists,
			errors.New("this team can already draw from this warehouse"))
	default:
		return connect.NewError(connect.CodeInternal, err)
	}
}
