package inventory_v1

import (
	"context"
	"fmt"
	"strings"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// CustomShipmentPricesSet is the owning SELLING team re-pricing an INBOUND parcel's lines until Terima — on its way or at
// the door (a-suppliers-reshipping-comes-in-as-a-custom-shipment, 🔄 A: *the price is editable until Terima*). A price
// values the stock its Terima mints and moves NO money (🔄 A). Each line named once; a line not named keeps its price.
// The parcel's total follows. One trail row of its own kind naming the seller's prices — blank for the warehouse
// (a-warehouse-sees-no-seller-money). Nothing changed writes nothing.
func (s *Service) CustomShipmentPricesSet(
	ctx context.Context,
	req *connect.Request[inventoryv1.CustomShipmentPricesSetRequest],
) (*connect.Response[inventoryv1.CustomShipmentPricesSetResponse], error) {
	msg := req.Msg

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		cs, lockErr := lockInboundParcel(tx, msg.GetId(), msg.GetTeamId(), customShipmentOwner)
		if lockErr != nil {
			return lockErr
		}

		statusErr := requireCustomShipmentStatus(cs, "re-priced", models.CustomShipmentOnTheWay,
			models.CustomShipmentArrived)
		if statusErr != nil {
			return statusErr
		}

		var items []models.CustomShipmentItem

		loadErr := tx.
			Where("custom_shipment_id = ?", cs.ID).
			Order("id ASC").
			Find(&items).
			Error
		if loadErr != nil {
			return loadErr
		}

		wanted := make(map[uint64]float64, len(msg.GetLines()))
		for _, line := range msg.GetLines() {
			if _, dup := wanted[line.GetItemId()]; dup {
				return errInboundLineTwice
			}

			wanted[line.GetItemId()] = line.GetPriceUnit()
		}

		var (
			changes []string
			total   float64
			moved   int
		)

		for i := range items {
			item := &items[i]

			price, named := wanted[item.ID]
			if named {
				moved++
			}

			if named && !san_money.Equal(price, item.PriceUnit) {
				changes = append(changes, fmt.Sprintf("%s %s → %s", item.ProductCode, san_money.Text(item.PriceUnit),
					san_money.Text(price)))

				item.PriceUnit = price
				item.Total = float64(item.Quantity) * price

				updateErr := tx.
					Model(item).
					Updates(map[string]any{"price_unit": item.PriceUnit, "total": item.Total}).
					Error
				if updateErr != nil {
					return updateErr
				}
			}

			total += item.Total
		}

		if moved != len(wanted) {
			return errInboundLineUnknown
		}

		if len(changes) == 0 {
			return nil
		}

		updateErr := tx.
			Model(cs).
			Updates(map[string]any{"total": total, "updated_at": inventoryNow()}).
			Error
		if updateErr != nil {
			return updateErr
		}

		return writeCustomShipmentLog(tx, &models.CustomShipmentLog{
			CustomShipmentID: cs.ID,
			Kind:             models.CustomShipmentLogPriceEdit,
			FromStatus:       cs.Status,
			ToStatus:         cs.Status,
			ActorUserID:      actorFrom(ctx),
			IsOverride:       overrideFrom(ctx),
			Description:      strings.Join(changes, "; "),
		})
	})
	if err != nil {
		return nil, inboundErr(err)
	}

	wire, err := customShipmentForWire(s.db.WithContext(ctx), msg.GetId(), msg.GetTeamId())
	if err != nil {
		return nil, inboundErr(err)
	}

	return connect.NewResponse(&inventoryv1.CustomShipmentPricesSetResponse{CustomShipment: wire}), nil
}
