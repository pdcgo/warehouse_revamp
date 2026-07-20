package selling_v1

import (
	"context"
	"errors"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// OrderCreate records a new order (status PLACED) and its lines in one transaction. The shop must
// belong to the scoped team. It does NOT touch inventory — stock integration is #69.
func (s *Service) OrderCreate(
	ctx context.Context,
	req *connect.Request[sellingv1.OrderCreateRequest],
) (*connect.Response[sellingv1.OrderCreateResponse], error) {
	teamID := req.Msg.GetTeamId()
	shopID := req.Msg.GetShopId()

	// An order must say which warehouse fulfils it (#72). Proto validation requires it, but this
	// re-checks rather than trusting the zero value: unit tests bypass the validation interceptor, and
	// from #69 this id is what stock is deducted FROM — an order that reached the database saying
	// "warehouse 0" would be an order the system cannot honour, discovered only when someone tries to
	// ship it. 0 is reserved for rows that predate #72 and must never be written again.
	if req.Msg.GetWarehouseId() == 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, errOrderNoWarehouse)
	}

	var order selling_service_models.Order

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// The team_id clause is the scope check — you can only order through your own team's shop.
		exists, err := shopExists(tx, teamID, shopID)
		if err != nil {
			return err
		}

		if !exists {
			return errShopMissing
		}

		address := req.Msg.GetAddress()

		order = selling_service_models.Order{
			TeamID: teamID,
			ShopID: shopID,
			// The warehouse this order ships from (#72), as chosen by whoever typed it — copied onto
			// the order, never looked up later, so it reads the same forever.
			WarehouseID:   req.Msg.GetWarehouseId(),
			Status:        orderStatusPlaced,
			CustomerName:  req.Msg.GetCustomerName(),
			CustomerPhone: req.Msg.GetCustomerPhone(),
			// FROZEN at order time: the names are copied, not resolved later, so this order reads the
			// same forever even after region_service renames or merges the desa (#118).
			ProvinsiCode:  address.GetProvinsiCode(),
			ProvinsiName:  address.GetProvinsiName(),
			KabupatenCode: address.GetKabupatenCode(),
			KabupatenName: address.GetKabupatenName(),
			KecamatanCode: address.GetKecamatanCode(),
			KecamatanName: address.GetKecamatanName(),
			DesaCode:      address.GetDesaCode(),
			DesaName:      address.GetDesaName(),
			KodePos:       address.GetKodePos(),
			AddressLine:   address.GetAddressLine(),
			ShippingCode:  req.Msg.GetShippingCode(),
			Subtotal:      req.Msg.GetSubtotal(),
			ShippingCost:  req.Msg.GetShippingCost(),
			Total:         req.Msg.GetTotal(),
			Items:         orderItemModels(req.Msg.GetItems()),
		}

		// GORM inserts the order and its items in this transaction, stamping their OrderID.
		return tx.Create(&order).Error
	})
	if err != nil {
		if errors.Is(err, errShopMissing) {
			return nil, notFound()
		}

		return nil, dbError(err)
	}

	return connect.NewResponse(&sellingv1.OrderCreateResponse{Order: orderToProto(&order)}), nil
}
